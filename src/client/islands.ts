import { h, hydrate, render, type ComponentType } from "preact";
import { isIslandId } from "../shared/island-id.ts";
import { ZOGAN_PROTOCOL_VERSION } from "../shared/protocol.ts";
import { collect, hasOnlyZoganAttributes, isHtmlElement } from "./dom.ts";
import { isActivationTrigger, scheduleTrigger } from "./triggers.ts";

/** A component loaded only when its matching Island activation trigger fires. */
// oxlint-disable-next-line no-explicit-any -- lazy modules erase their application-owned props type.
export type IslandComponent = ComponentType<any>;

/** Shape returned by a lazy Island module import. */
export interface IslandModule {
  /** Default component rendered when the Island is activated. */
  readonly default: IslandComponent;
}

/** Lazy module loader invoked only when a matching Island activates. */
export type IslandLoader = () => Promise<IslandModule>;

/** Local lifecycle for one non-overlapping Island root. */
export interface IslandRuntime {
  scan(nodes: readonly Node[]): void;
  dispose(nodes: readonly Node[], restoreFallback?: boolean): void;
  destroy(nodes?: readonly Node[]): void;
}

const ISLAND_SELECTOR = "[data-zogan-island]";
const OWNED_SELECTOR = "[data-zogan-fragment], [data-zogan-island]";
const ISLAND_ATTRIBUTES = new Set([
  "data-zogan-island",
  "data-zogan-mode",
  "data-zogan-props",
  "data-zogan-protocol",
  "data-zogan-trigger",
]);

const isJsonValue = (value: unknown): boolean => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (typeof value !== "object") return false;
  return Object.values(value).every((item) => isJsonValue(item));
};

const isPropsObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => isJsonValue(item));

const snapshotChildren = (element: Element): Node[] =>
  [...element.childNodes].map((node) => node.cloneNode(true));

type ClientIslandMode = "hydrate" | "mount";

interface ClientIslandDescriptor {
  readonly id: string;
  readonly mode: ClientIslandMode;
  readonly props: string;
  readonly trigger: string;
}

const hasBoundaryOwner = (element: Element): boolean =>
  (element.parentElement?.closest(OWNED_SELECTOR) ?? null) !== null;

const readIslandDescriptor = (element: Element): ClientIslandDescriptor | null => {
  if (!isHtmlElement(element) || element.localName !== "div") {
    console.warn("zogan: an Island marker requires an HTML div wrapper; keeping SSR fallback");
    return null;
  }
  if (!hasOnlyZoganAttributes(element, ISLAND_ATTRIBUTES)) {
    console.warn("zogan: island has an unknown or overlapping zogan marker; keeping SSR fallback");
    return null;
  }
  const protocol = element.getAttribute("data-zogan-protocol");
  if (protocol !== ZOGAN_PROTOCOL_VERSION) {
    console.warn(
      `zogan: unsupported island protocol ${JSON.stringify(protocol)}; keeping SSR fallback`,
    );
    return null;
  }
  const id = element.getAttribute("data-zogan-island");
  if (id === null || !isIslandId(id)) {
    console.warn(`zogan: invalid island ID ${JSON.stringify(id)}; keeping SSR fallback`);
    return null;
  }
  const mode = element.getAttribute("data-zogan-mode");
  if (mode !== "hydrate" && mode !== "mount") {
    console.warn(
      `zogan: island ${JSON.stringify(id)} has invalid mode ${JSON.stringify(mode)}; keeping SSR fallback`,
    );
    return null;
  }
  const trigger = element.getAttribute("data-zogan-trigger");
  if (trigger === null || !isActivationTrigger(trigger)) {
    console.warn(`zogan: invalid activation trigger ${JSON.stringify(trigger)}; keeping fallback`);
    return null;
  }
  const props = element.getAttribute("data-zogan-props");
  if (props === null) {
    console.warn(`zogan: island ${JSON.stringify(id)} is missing JSON props; keeping SSR fallback`);
    return null;
  }
  return { id, mode, props, trigger };
};

const matchesIslandDescriptor = (element: Element, expected: ClientIslandDescriptor): boolean => {
  const current = readIslandDescriptor(element);
  if (
    current !== null &&
    current.id === expected.id &&
    current.mode === expected.mode &&
    current.props === expected.props &&
    current.trigger === expected.trigger
  ) {
    return true;
  }
  if (current !== null) {
    console.warn(
      `zogan: island ${JSON.stringify(expected.id)} markers changed before activation; keeping SSR fallback`,
    );
  }
  return false;
};

const parseProps = (id: string, raw: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isPropsObject(value)) throw new TypeError("island props must be a JSON object");
    return value;
  } catch (error) {
    console.warn(
      `zogan: island ${JSON.stringify(id)} has invalid JSON props; keeping SSR fallback`,
      error,
    );
    return null;
  }
};

/** Create an Island registry and lifecycle isolated from every other root. */
export const createIslandRuntime = (
  islands: Readonly<Record<string, IslandLoader>> = {},
): IslandRuntime => {
  const loaders = new Map(Object.entries(islands));
  const loaded = new Map<string, Promise<IslandComponent>>();
  const claimed = new WeakSet<Element>();
  const hydrated = new WeakSet<Element>();
  const activations = new WeakMap<Element, symbol>();
  const fallbacks = new WeakMap<Element, readonly Node[]>();
  const pendingTriggers = new Map<Element, () => void>();
  let destroyed = false;
  const isDestroyed = (): boolean => destroyed;

  const loadIsland = (id: string, loader: IslandLoader): Promise<IslandComponent> => {
    const existing = loaded.get(id);
    if (existing !== undefined) return existing;
    const promise = Promise.resolve()
      .then(loader)
      .then((module) => {
        if (typeof module.default !== "function") {
          throw new TypeError(
            `zogan: island ${JSON.stringify(id)} has no default component export`,
          );
        }
        return module.default;
      });
    loaded.set(id, promise);
    void promise.catch(() => {
      if (loaded.get(id) === promise) loaded.delete(id);
    });
    return promise;
  };

  const dispose = (nodes: readonly Node[], restoreFallback = false): void => {
    for (const element of collect(nodes, ISLAND_SELECTOR)) {
      activations.set(element, Symbol("zogan.island.disposed"));
      const cleanup = pendingTriggers.get(element);
      if (cleanup !== undefined) {
        pendingTriggers.delete(element);
        cleanup();
      }
      if (hydrated.has(element)) {
        try {
          render(null, element);
        } catch (error) {
          console.warn("zogan: failed to dispose an island", error);
        }
        hydrated.delete(element);
        const fallback = fallbacks.get(element);
        if (restoreFallback && fallback !== undefined) {
          element.replaceChildren(...fallback.map((node) => node.cloneNode(true)));
        }
      }
      fallbacks.delete(element);
      claimed.delete(element);
    }
  };

  const activate = async (
    element: Element,
    descriptor: ClientIslandDescriptor,
    loader: IslandLoader,
  ): Promise<void> => {
    if (destroyed) return;
    if (hasBoundaryOwner(element)) {
      console.warn("zogan: nested Fragment or Island ownership is not supported");
      return;
    }
    if (!matchesIslandDescriptor(element, descriptor)) {
      return;
    }
    const props = parseProps(descriptor.id, descriptor.props);
    if (props === null) return;
    const token = Symbol("zogan.island.activation");
    activations.set(element, token);
    let component: IslandComponent;
    try {
      component = await loadIsland(descriptor.id, loader);
    } catch (error) {
      console.warn(
        `zogan: failed to load island ${JSON.stringify(descriptor.id)}; keeping SSR fallback`,
        error,
      );
      return;
    }
    if (isDestroyed() || activations.get(element) !== token || !element.isConnected) return;
    if (hasBoundaryOwner(element)) {
      console.warn("zogan: nested Fragment or Island ownership is not supported");
      return;
    }
    if (!matchesIslandDescriptor(element, descriptor)) {
      return;
    }
    const fallback = snapshotChildren(element);
    fallbacks.set(element, fallback);
    try {
      if (descriptor.mode === "mount") {
        element.replaceChildren();
        render(h(component, props), element);
      } else {
        hydrate(h(component, props), element);
      }
      hydrated.add(element);
    } catch (error) {
      try {
        render(null, element);
      } catch {
        // Best-effort cleanup before restoring the authoritative server fallback.
      }
      element.replaceChildren(...fallback.map((node) => node.cloneNode(true)));
      fallbacks.delete(element);
      console.warn(
        `zogan: failed to activate island ${JSON.stringify(descriptor.id)}; restored SSR fallback`,
        error,
      );
    }
  };

  const scan = (nodes: readonly Node[]): void => {
    if (destroyed) return;
    for (const element of collect(nodes, ISLAND_SELECTOR)) {
      if (claimed.has(element)) continue;
      if (hasBoundaryOwner(element)) {
        console.warn("zogan: nested Fragment or Island ownership is not supported");
        continue;
      }
      const descriptor = readIslandDescriptor(element);
      if (descriptor === null) continue;
      const loader = loaders.get(descriptor.id);
      if (loader === undefined) {
        console.warn(
          `zogan: no lazy loader registered for island ${JSON.stringify(descriptor.id)}; keeping SSR fallback`,
        );
        continue;
      }
      claimed.add(element);
      const cleanup = scheduleTrigger(element, descriptor.trigger, () => {
        pendingTriggers.delete(element);
        void activate(element, descriptor, loader);
      });
      if (cleanup !== null) pendingTriggers.set(element, cleanup);
    }
  };

  const destroy = (nodes: readonly Node[] = []): void => {
    if (destroyed) return;
    destroyed = true;
    dispose(nodes, true);
    for (const cleanup of pendingTriggers.values()) cleanup();
    pendingTriggers.clear();
    loaders.clear();
    loaded.clear();
  };

  return Object.freeze({ destroy, dispose, scan });
};

// Compatibility helpers for internal tests and benchmarks. Public consumers use start().
let testRuntime = createIslandRuntime();

export const registerIslands = (islands: Readonly<Record<string, IslandLoader>>): void => {
  testRuntime.destroy();
  testRuntime = createIslandRuntime(islands);
};

export const hydrateIslands = (nodes: readonly Node[]): void => {
  testRuntime.scan(nodes);
};

export const disposeIslandsIn = (nodes: readonly Node[]): void => {
  testRuntime.dispose(nodes);
};

// oxlint-disable-next-line no-underscore-dangle -- deliberately recognizable test-only hook
export const __resetIslands = (): void => {
  testRuntime.destroy();
  testRuntime = createIslandRuntime();
};
