import { isFragmentElement, type FragmentElement } from "../shared/fragment-elements.ts";
import { ZOGAN_PROTOCOL_VERSION } from "../shared/protocol.ts";
import { collect, hasOnlyZoganAttributes, isHtmlElement, parseHTMLFragment } from "./dom.ts";
import { fragmentUrl, isHtmlContentType, isManualRedirect } from "./protocol.ts";
import { isActivationTrigger, scheduleTrigger } from "./triggers.ts";

const FRAGMENT_SELECTOR = "[data-zogan-fragment]";
const OWNED_SELECTOR = "[data-zogan-fragment], [data-zogan-island]";
const FRAGMENT_ATTRIBUTES = new Set([
  "data-zogan-fragment",
  "data-zogan-protocol",
  "data-zogan-trigger",
]);

/** Local lifecycle for one non-overlapping Fragment root. */
export interface FragmentRuntime {
  scan(nodes: readonly Node[]): void;
  dispose(nodes: readonly Node[], restoreFallback?: boolean): void;
  destroy(nodes?: readonly Node[]): void;
}

/** Browser options for the opt-in read-only Fragment runtime. */
export interface StartFragmentsOptions {
  /** Non-overlapping DOM root owned by this runtime. Defaults to the document element. */
  readonly root?: Element;
}

/** Handle for cancelling pending work and restoring initial server fallbacks. */
export interface FragmentClientRuntime {
  /** Stop this runtime and restore the DOM it owns. */
  dispose(): void;
}

interface FragmentDescriptor {
  readonly contextTag: FragmentElement;
  readonly src: string;
  readonly trigger: string;
  readonly url: string;
}

const fragmentContext = (element: Element): FragmentElement | null => {
  if (!isHtmlElement(element)) {
    console.warn("zogan: FragmentSlot requires an HTML element; keeping fallback");
    return null;
  }
  const tag = element.localName;
  if (isFragmentElement(tag)) return tag;
  console.warn(
    `zogan: FragmentSlot cannot use unsupported container ${JSON.stringify(tag)}; keeping fallback`,
  );
  return null;
};

const readFragmentDescriptor = (element: Element): FragmentDescriptor | null => {
  if (!hasOnlyZoganAttributes(element, FRAGMENT_ATTRIBUTES)) {
    console.warn("zogan: FragmentSlot has an unknown zogan marker; keeping fallback");
    return null;
  }
  const protocol = element.getAttribute("data-zogan-protocol");
  if (protocol !== ZOGAN_PROTOCOL_VERSION) {
    console.warn(
      `zogan: unsupported fragment protocol ${JSON.stringify(protocol)}; keeping fallback`,
    );
    return null;
  }
  const contextTag = fragmentContext(element);
  if (contextTag === null) return null;
  // The selector that reached this reader guarantees the attribute is present;
  // an empty value remains invalid through fragmentUrl().
  const src = element.getAttribute("data-zogan-fragment") ?? "";
  const url = fragmentUrl(src);
  if (url === null) {
    console.warn(
      `zogan: refusing fragment URL ${JSON.stringify(src)}; expected a root-relative same-origin URL without a hash`,
    );
    return null;
  }
  const trigger = element.getAttribute("data-zogan-trigger");
  if (trigger === null || !isActivationTrigger(trigger)) {
    console.warn(`zogan: invalid activation trigger ${JSON.stringify(trigger)}; keeping fallback`);
    return null;
  }
  return { contextTag, src, trigger, url: url.href };
};

const matchesFragmentDescriptor = (element: Element, expected: FragmentDescriptor): boolean => {
  const current = readFragmentDescriptor(element);
  if (
    current !== null &&
    current.contextTag === expected.contextTag &&
    current.src === expected.src &&
    current.trigger === expected.trigger
  ) {
    return true;
  }
  if (current !== null) {
    console.warn("zogan: FragmentSlot markers changed before activation; keeping fallback");
  }
  return false;
};

const containsReservedMarker = (nodes: readonly Node[]): boolean =>
  collect(nodes, "*").some((element) =>
    [...element.attributes].some((attribute) =>
      attribute.name.toLowerCase().startsWith("data-zogan-"),
    ),
  );

const requestFragment = async (src: string): Promise<string | null> => {
  const target = fragmentUrl(src);
  if (target === null) {
    console.warn(
      `zogan: refusing fragment URL ${JSON.stringify(src)}; expected a root-relative same-origin URL without a hash`,
    );
    return null;
  }
  try {
    const response = await fetch(target.href, {
      credentials: "same-origin",
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    if (isManualRedirect(response) || !response.ok) {
      console.warn(
        `zogan: fragment ${JSON.stringify(src)} responded with ${response.status}; keeping fallback`,
      );
      return null;
    }
    if (!isHtmlContentType(response.headers.get("Content-Type"))) {
      console.warn(`zogan: fragment ${JSON.stringify(src)} did not return HTML; keeping fallback`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.warn(`zogan: fragment ${JSON.stringify(src)} failed to load; keeping fallback`, error);
    return null;
  }
};

/** Fetch one trusted, same-origin Fragment response without retaining it. */
export const fetchFragment = (src: string): Promise<string | null> => requestFragment(src);

/** Create a one-shot Fragment loader isolated from every other root. */
export const createFragmentRuntime = (): FragmentRuntime => {
  const inFlight = new Map<string, Promise<string | null>>();
  const claimed = new WeakSet<Element>();
  const generations = new WeakMap<Element, symbol>();
  const fallbacks = new WeakMap<Element, readonly Node[]>();
  const pendingTriggers = new Map<Element, () => void>();
  let destroyed = false;
  const isDestroyed = (): boolean => destroyed;

  const fetchShared = (src: string, url: string): Promise<string | null> => {
    const existing = inFlight.get(url);
    if (existing !== undefined) return existing;
    const request = requestFragment(src);
    inFlight.set(url, request);
    void request.finally(() => {
      if (inFlight.get(url) === request) inFlight.delete(url);
    });
    return request;
  };

  const apply = (element: Element, html: string, contextTag: FragmentElement): boolean => {
    const inserted = parseHTMLFragment(html, contextTag);
    if (containsReservedMarker(inserted)) {
      console.warn("zogan: Fragment responses cannot contain reserved zogan markers");
      return false;
    }
    fallbacks.set(
      element,
      [...element.childNodes].map((node) => node.cloneNode(true)),
    );
    element.replaceChildren(...inserted);
    return true;
  };

  const activate = async (element: Element, descriptor: FragmentDescriptor): Promise<void> => {
    if (!matchesFragmentDescriptor(element, descriptor)) return;
    const token = Symbol("zogan.fragment.activation");
    generations.set(element, token);
    const html = await fetchShared(descriptor.src, descriptor.url);
    if (
      isDestroyed() ||
      html === null ||
      generations.get(element) !== token ||
      !element.isConnected ||
      !matchesFragmentDescriptor(element, descriptor)
    ) {
      return;
    }
    apply(element, html, descriptor.contextTag);
  };

  const scan = (nodes: readonly Node[]): void => {
    if (destroyed) return;
    for (const element of collect(nodes, FRAGMENT_SELECTOR)) {
      if (claimed.has(element)) continue;
      if ((element.parentElement?.closest(OWNED_SELECTOR) ?? null) !== null) {
        console.warn(
          "zogan: nested Fragment or Island ownership is not supported; keeping fallback",
        );
        continue;
      }
      const descriptor = readFragmentDescriptor(element);
      if (descriptor === null) continue;
      claimed.add(element);
      const cleanup = scheduleTrigger(element, descriptor.trigger, () => {
        pendingTriggers.delete(element);
        void activate(element, descriptor);
      });
      if (cleanup !== null) pendingTriggers.set(element, cleanup);
    }
  };

  const dispose = (nodes: readonly Node[], restoreFallback = false): void => {
    for (const element of collect(nodes, FRAGMENT_SELECTOR)) {
      generations.set(element, Symbol("zogan.fragment.disposed"));
      const cleanup = pendingTriggers.get(element);
      if (cleanup !== undefined) {
        pendingTriggers.delete(element);
        cleanup();
      }
      const fallback = fallbacks.get(element);
      if (restoreFallback && fallback !== undefined) {
        element.replaceChildren(...fallback.map((node) => node.cloneNode(true)));
      }
      fallbacks.delete(element);
      claimed.delete(element);
    }
  };

  const destroy = (nodes: readonly Node[] = []): void => {
    if (destroyed) return;
    destroyed = true;
    dispose(nodes, true);
    for (const cleanup of pendingTriggers.values()) cleanup();
    pendingTriggers.clear();
    inFlight.clear();
  };

  return Object.freeze({ destroy, dispose, scan });
};

/** Start the opt-in read-only Fragment runtime below one explicit root. */
export const startFragments = (options: StartFragmentsOptions = {}): FragmentClientRuntime => {
  const root = options.root ?? document.documentElement;
  const runtime = createFragmentRuntime();
  runtime.scan([root]);
  let active = true;
  return Object.freeze({
    dispose(): void {
      if (!active) return;
      active = false;
      runtime.destroy([root]);
    },
  });
};

// Compatibility helpers for internal tests and benchmarks. Public consumers use startFragments().
let testRuntime = createFragmentRuntime();

export const scanFragments = (nodes: readonly Node[]): void => {
  testRuntime.scan(nodes);
};

export const disposeFragmentsIn = (nodes: readonly Node[]): void => {
  testRuntime.dispose(nodes);
};

// oxlint-disable-next-line no-underscore-dangle -- deliberately recognizable test-only hook
export const __resetFragments = (): void => {
  testRuntime.destroy();
  testRuntime = createFragmentRuntime();
};
