import { h, hydrate, render, type ComponentType } from "preact";
import { collect, hasOnlyZoganAttributes, isHtmlElement } from "./dom.ts";
import { isActivationTrigger, scheduleTrigger } from "./triggers.ts";
import { isIslandId } from "../shared/island-id.ts";

/** A component loaded only when its matching Island activation trigger fires. */
// oxlint-disable-next-line no-explicit-any
export type IslandComponent = ComponentType<any>;

/** Shape returned by a lazy Island module import. */
export interface IslandModule {
  /** Preact component activated for the matching server descriptor. */
  readonly default: IslandComponent;
}

/** Lazy module loader invoked only when a matching Island activates. */
export type IslandLoader = () => Promise<IslandModule>;

const ISLAND_SELECTOR = "[data-zogan-island]";
const ISLAND_ATTRIBUTES = new Set([
  "data-zogan-island",
  "data-zogan-mode",
  "data-zogan-props",
  "data-zogan-trigger",
]);
const loaders = new Map<string, IslandLoader>();
const loaded = new Map<string, Promise<IslandComponent>>();
const claimed = new WeakSet<Element>();
const hydrated = new WeakSet<Element>();
const activations = new WeakMap<Element, symbol>();
const pendingTriggers = new Map<Element, () => void>();

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

/** Register lazy loaders. Calling a loader is always deferred until activation. */
export const registerIslands = (islands: Readonly<Record<string, IslandLoader>>): void => {
  for (const [id, loader] of Object.entries(islands)) loaders.set(id, loader);
};

const loadIsland = (id: string, loader: IslandLoader): Promise<IslandComponent> => {
  const existing = loaded.get(id);
  if (existing !== undefined) return existing;

  const promise = Promise.resolve()
    .then(loader)
    .then((module) => {
      if (typeof module.default !== "function") {
        throw new TypeError(`zogan: island ${JSON.stringify(id)} has no default component export`);
      }
      return module.default;
    });
  loaded.set(id, promise);
  void promise.catch(() => {
    if (loaded.get(id) === promise) loaded.delete(id);
  });
  return promise;
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

const snapshotChildren = (element: Element): Node[] =>
  [...element.childNodes].map((node) => node.cloneNode(true));

type ClientIslandMode = "hydrate" | "mount";

interface ClientIslandDescriptor {
  readonly id: string;
  readonly mode: ClientIslandMode;
  readonly props: string;
  readonly trigger: string;
}

const hasIslandOwner = (element: Element): boolean =>
  (element.parentElement?.closest(ISLAND_SELECTOR) ?? null) !== null;

const readIslandDescriptor = (element: Element): ClientIslandDescriptor | null => {
  if (!isHtmlElement(element) || element.localName !== "div") {
    console.warn("zogan: an Island marker requires an HTML div wrapper; keeping SSR fallback");
    return null;
  }
  if (!hasOnlyZoganAttributes(element, ISLAND_ATTRIBUTES)) {
    console.warn("zogan: island has an unknown or overlapping zogan marker; keeping SSR fallback");
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
  if (trigger === null) {
    console.warn(
      `zogan: island ${JSON.stringify(id)} is missing its activation trigger; keeping SSR fallback`,
    );
    return null;
  }
  if (!isActivationTrigger(trigger, false)) {
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

const activateIsland = async (
  element: Element,
  descriptor: ClientIslandDescriptor,
  loader: IslandLoader,
): Promise<void> => {
  if (hasIslandOwner(element)) {
    console.warn("zogan: nested islands are not supported; the outer island owns this subtree");
    return;
  }
  if (!matchesIslandDescriptor(element, descriptor)) return;

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

  if (activations.get(element) !== token || !element.isConnected) return;
  if (hasIslandOwner(element)) {
    console.warn("zogan: nested islands are not supported; the outer island owns this subtree");
    return;
  }
  if (!matchesIslandDescriptor(element, descriptor)) return;

  const fallback = snapshotChildren(element);
  try {
    if (descriptor.mode === "mount") {
      disposeIslandsIn([...element.childNodes]);
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
      // Best effort cleanup. The cloned fallback below is still authoritative.
    }
    element.replaceChildren(...fallback);
    console.warn(
      `zogan: failed to activate island ${JSON.stringify(descriptor.id)}; restored SSR fallback`,
      error,
    );
  }
};

/** Scan only supplied nodes for server-emitted Island descriptors. */
export const hydrateIslands = (nodes: readonly Node[]): void => {
  for (const element of collect(nodes, ISLAND_SELECTOR)) {
    if (claimed.has(element)) continue;
    if (hasIslandOwner(element)) {
      console.warn("zogan: nested islands are not supported; the outer island owns this subtree");
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
    const cleanup = scheduleTrigger(element, descriptor.trigger, false, () => {
      pendingTriggers.delete(element);
      void activateIsland(element, descriptor, loader);
    });
    if (cleanup !== null) pendingTriggers.set(element, cleanup);
  }
};

/** Dispose Preact roots and pending activation work below nodes that are about to be replaced. */
export const disposeIslandsIn = (nodes: readonly Node[]): void => {
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
    }
    claimed.delete(element);
  }
};

/** Reset module state between isolated tests. */
// oxlint-disable-next-line no-underscore-dangle -- deliberately recognizable test-only hook
export const __resetIslands = (): void => {
  for (const cleanup of pendingTriggers.values()) cleanup();
  pendingTriggers.clear();
  loaders.clear();
  loaded.clear();
};
