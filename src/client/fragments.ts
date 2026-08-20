import { collect, hasOnlyZoganAttributes, isHtmlElement, parseHTMLFragment } from "./dom.ts";
import { disposeIslandsIn, hydrateIslands } from "./islands.ts";
import { fragmentUrl, isHtmlContentType, isManualRedirect } from "./protocol.ts";
import { isActivationTrigger, scheduleTrigger } from "./triggers.ts";
import { isFragmentElement, type FragmentElement } from "../shared/fragment-elements.ts";

const FRAGMENT_SELECTOR = "[data-zogan-fragment]";
const ISLAND_SELECTOR = "[data-zogan-island]";
const FRAGMENT_ATTRIBUTES = new Set(["data-zogan-fragment", "data-zogan-trigger"]);

const inFlight = new Map<string, Promise<string | null>>();
const claimed = new WeakSet<Element>();
const generations = new WeakMap<Element, symbol>();
const pendingTriggers = new Map<Element, () => void>();

/** Fetch trusted same-origin HTML. Concurrent requests for the same URL share only in-flight work. */
export const fetchFragment = async (src: string): Promise<string | null> => {
  const target = fragmentUrl(src);
  if (target === null) {
    console.warn(
      `zogan: refusing fragment URL ${JSON.stringify(src)}; expected a root-relative same-origin URL without a hash`,
    );
    return null;
  }

  const existing = inFlight.get(target.href);
  if (existing !== undefined) return existing;

  const request = (async (): Promise<string | null> => {
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
        console.warn(
          `zogan: fragment ${JSON.stringify(src)} did not return HTML; keeping fallback`,
        );
        return null;
      }
      return await response.text();
    } catch (error) {
      console.warn(
        `zogan: fragment ${JSON.stringify(src)} failed to load; keeping fallback`,
        error,
      );
      return null;
    }
  })();

  inFlight.set(target.href, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(target.href) === request) inFlight.delete(target.href);
  }
};

const applyFragmentHtml = (element: Element, html: string, contextTag: FragmentElement): void => {
  const inserted = parseHTMLFragment(html, contextTag);
  const removed = [...element.childNodes];

  disposeFragmentsIn(removed);
  disposeIslandsIn(removed);
  element.replaceChildren(...inserted);

  scanFragments(inserted);
  hydrateIslands(inserted);
};

const updateOne = async (
  element: Element,
  descriptor: FragmentDescriptor,
  token: symbol,
): Promise<void> => {
  const html = await fetchFragment(descriptor.src);
  if (html === null) return;
  if (generations.get(element) !== token || !element.isConnected) return;
  if (hasIslandOwner(element)) {
    console.warn("zogan: FragmentSlot cannot be nested inside an Island; keeping fallback");
    return;
  }
  if (hasFragmentSourceAncestor(element, descriptor.src)) return;
  if (!matchesFragmentDescriptor(element, descriptor)) return;
  applyFragmentHtml(element, html, descriptor.contextTag);
};

const activateFragment = (element: Element, descriptor: FragmentDescriptor): Promise<void> => {
  if (hasIslandOwner(element)) {
    console.warn("zogan: FragmentSlot cannot be nested inside an Island; keeping fallback");
    return Promise.resolve();
  }
  if (hasFragmentSourceAncestor(element, descriptor.src)) return Promise.resolve();
  if (!matchesFragmentDescriptor(element, descriptor)) return Promise.resolve();
  const token = Symbol("zogan.fragment.activation");
  generations.set(element, token);
  return updateOne(element, descriptor, token);
};

function hasIslandOwner(element: Element): boolean {
  return (
    element.matches(ISLAND_SELECTOR) ||
    (element.parentElement?.closest(ISLAND_SELECTOR) ?? null) !== null
  );
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

interface FragmentDescriptor {
  readonly contextTag: FragmentElement;
  readonly src: string;
  readonly trigger: string;
}

const readFragmentDescriptor = (element: Element): FragmentDescriptor | null => {
  if (!hasOnlyZoganAttributes(element, FRAGMENT_ATTRIBUTES)) {
    console.warn(
      "zogan: FragmentSlot has an unknown or overlapping zogan marker; keeping fallback",
    );
    return null;
  }
  const contextTag = fragmentContext(element);
  if (contextTag === null) return null;

  const src = element.getAttribute("data-zogan-fragment");
  if (src === null || fragmentUrl(src) === null) {
    console.warn(
      `zogan: refusing fragment URL ${JSON.stringify(src)}; expected a root-relative same-origin URL without a hash`,
    );
    return null;
  }
  const trigger = element.getAttribute("data-zogan-trigger");
  if (trigger === null) {
    console.warn("zogan: FragmentSlot is missing its activation trigger; keeping fallback");
    return null;
  }
  if (!isActivationTrigger(trigger, true)) {
    console.warn(`zogan: invalid activation trigger ${JSON.stringify(trigger)}; keeping fallback`);
    return null;
  }
  return { contextTag, src, trigger };
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

const hasFragmentSourceAncestor = (element: Element, src: string): boolean => {
  const target = fragmentUrl(src);
  /* v8 ignore next -- every caller passes a descriptor already validated by readFragmentDescriptor */
  if (target === null) return true;

  let ancestor = element.parentElement?.closest(FRAGMENT_SELECTOR) ?? null;
  while (ancestor !== null) {
    const ancestorSrc = ancestor.getAttribute("data-zogan-fragment");
    /* v8 ignore next -- closest(FRAGMENT_SELECTOR) guarantees the attribute during this sync turn */
    if (ancestorSrc === null) return false;
    const ancestorTarget = fragmentUrl(ancestorSrc);
    if (ancestorTarget?.href === target.href) {
      console.warn(
        `zogan: fragment ${JSON.stringify(src)} would create an ancestor source cycle; keeping fallback`,
      );
      return true;
    }
    ancestor = ancestor.parentElement?.closest(FRAGMENT_SELECTOR) ?? null;
  }
  return false;
};

/** Scan supplied nodes for FragmentSlot markers without observing unrelated DOM mutations. */
export const scanFragments = (nodes: readonly Node[]): void => {
  for (const element of collect(nodes, FRAGMENT_SELECTOR)) {
    if (claimed.has(element)) continue;
    if (hasIslandOwner(element)) {
      console.warn("zogan: FragmentSlot cannot be nested inside an Island; keeping fallback");
      continue;
    }
    const descriptor = readFragmentDescriptor(element);
    if (descriptor === null) continue;
    if (hasFragmentSourceAncestor(element, descriptor.src)) continue;
    claimed.add(element);
    const cleanup = scheduleTrigger(element, descriptor.trigger, true, () => {
      pendingTriggers.delete(element);
      void activateFragment(element, descriptor);
    });
    if (cleanup !== null) pendingTriggers.set(element, cleanup);
  }
};

/** Cancel pending work below nodes which are about to leave the document. */
export const disposeFragmentsIn = (nodes: readonly Node[]): void => {
  for (const element of collect(nodes, FRAGMENT_SELECTOR)) {
    generations.set(element, Symbol("zogan.fragment.disposed"));
    const cleanup = pendingTriggers.get(element);
    if (cleanup !== undefined) {
      pendingTriggers.delete(element);
      cleanup();
    }
    claimed.delete(element);
  }
};

const fragmentTargets = (src: string): Element[] =>
  [...document.querySelectorAll(FRAGMENT_SELECTOR)].filter(
    (element) => element.getAttribute("data-zogan-fragment") === src,
  );

/** Explicitly reload all connected FragmentSlots whose source exactly matches `src`. */
export const refreshFragment = async (src: string): Promise<void> => {
  const targets = fragmentTargets(src);
  if (targets.length === 0) {
    console.warn(`zogan: no FragmentSlot targets found for ${JSON.stringify(src)}; nothing to do`);
    return;
  }

  const work: { element: Element; token: symbol; descriptor: FragmentDescriptor }[] = [];
  for (const element of targets) {
    if (hasIslandOwner(element)) {
      console.warn("zogan: FragmentSlot cannot be nested inside an Island; keeping fallback");
      continue;
    }
    const descriptor = readFragmentDescriptor(element);
    if (descriptor === null || descriptor.src !== src) continue;
    if (hasFragmentSourceAncestor(element, descriptor.src)) continue;
    const token = Symbol("zogan.fragment.refresh");
    generations.set(element, token);
    work.push({ descriptor, element, token });
  }
  if (work.length === 0) return;
  const html = await fetchFragment(src);
  if (html === null) return;

  for (const { descriptor, element, token } of work) {
    if (generations.get(element) !== token || !element.isConnected) continue;
    if (hasIslandOwner(element)) {
      console.warn("zogan: FragmentSlot cannot be nested inside an Island; keeping fallback");
      continue;
    }
    if (hasFragmentSourceAncestor(element, descriptor.src)) continue;
    if (!matchesFragmentDescriptor(element, descriptor)) continue;
    applyFragmentHtml(element, html, descriptor.contextTag);
  }
};

/** Reset module state between isolated tests. */
// oxlint-disable-next-line no-underscore-dangle -- deliberately recognizable test-only hook
export const __resetFragments = (): void => {
  for (const cleanup of pendingTriggers.values()) cleanup();
  pendingTriggers.clear();
  inFlight.clear();
};
