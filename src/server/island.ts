import { h, type ComponentType, type VNode } from "preact";
import { useContext } from "preact/hooks";
import { ISLAND_ID_PATTERN, isIslandId } from "../shared/island-id.ts";
import { ZOGAN_PROTOCOL_VERSION } from "../shared/protocol.ts";
import { islandOwner, renderKind } from "./boundary-context.ts";

/** A recursively serializable, finite JSON value. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

/** A plain JSON object accepted as an Island props root. */
export type JsonObject = {
  readonly [key: string]: JsonValue;
};

/** Client activation behavior for a server-rendered Island boundary. */
export type IslandMode = "hydrate" | "mount";
/** Browser trigger supported by Island activation. */
export type IslandTrigger = "load" | "idle" | "visible" | `media:${string}`;

/** Internal type-only props carrier for an Island descriptor. */
const descriptorProps: unique symbol = Symbol("zogan.IslandDescriptor.props");
/** Internal component slot shared by descriptor construction and SSR. */
const descriptorComponent: unique symbol = Symbol("zogan.IslandDescriptor.component");

/** A server-side island declaration carrying its exact props type. */
export interface IslandDescriptor<Props extends JsonObject = JsonObject> {
  /** Stable public ID matched to the Vite Island filename. */
  readonly id: string;
  /** Whether the client hydrates SSR markup or mounts over a fallback. */
  readonly mode: IslandMode;
  /** Internal SSR component retained by the descriptor. */
  readonly [descriptorComponent]: ComponentType<Props>;
  /** Type-only invariant props carrier. */
  readonly [descriptorProps]?: Props;
}

/** Extract the Preact component type required by a descriptor. */
export type IslandComponentFor<Descriptor> =
  Descriptor extends IslandDescriptor<infer Props> ? ComponentType<Props> : never;

const assertIslandId = (id: string): void => {
  if (!isIslandId(id)) {
    throw new TypeError(`zogan: island id ${JSON.stringify(id)} must match ${ISLAND_ID_PATTERN}`);
  }
};

const makeDescriptor = <Props extends JsonObject>(
  id: string,
  mode: IslandMode,
  component: ComponentType<Props>,
): IslandDescriptor<Props> => {
  assertIslandId(id);
  if (typeof component !== "function") {
    throw new TypeError(`zogan: island ${JSON.stringify(id)} component must be a Preact component`);
  }
  return Object.freeze({
    [descriptorComponent]: component,
    id,
    mode,
  });
};

/** Options for an SSR-safe component hydrated in place. */
export interface DefineIslandOptions<Props extends JsonObject> {
  /** Stable ID, equal to the client module filename stem. */
  readonly id: string;
  /** Component used for both SSR and hydration. */
  readonly component: ComponentType<Props>;
}

/** Options for a client-only component with an explicit SSR fallback. */
export interface DefineClientIslandOptions<Props extends JsonObject> {
  /** Stable ID, equal to the client module filename stem. */
  readonly id: string;
  /** Server-safe fallback replaced when the client module mounts. */
  readonly fallback: ComponentType<Props>;
}

/** Declare an island whose server markup will be hydrated in place. */
export const defineIsland = <Props extends JsonObject>(
  options: DefineIslandOptions<Props>,
): IslandDescriptor<Props> => makeDescriptor(options.id, "hydrate", options.component);

/** Declare a client-only island whose server fallback will be replaced on mount. */
export const defineClientIsland = <Props extends JsonObject>(
  options: DefineClientIslandOptions<Props>,
): IslandDescriptor<Props> => makeDescriptor(options.id, "mount", options.fallback);

const isPlainObject = (value: object): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertJson = (value: unknown, path: string, stack: Set<object>): void => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`zogan: island props ${path} must be a finite JSON number`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`zogan: island props ${path} contains a non-JSON ${typeof value} value`);
  }
  if (stack.has(value)) {
    throw new TypeError(`zogan: island props ${path} contains a cyclic JSON value`);
  }

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
        throw new TypeError(`zogan: island props ${path} contains a symbol key`);
      }
      for (let index = 0; index < value.length; index += 1) {
        const property = Object.getOwnPropertyDescriptor(value, index);
        if (property === undefined) {
          throw new TypeError(`zogan: island props ${path}[${index}] is not a JSON value`);
        }
        if (
          property.enumerable !== true ||
          property.get !== undefined ||
          property.set !== undefined
        ) {
          throw new TypeError(
            `zogan: island props ${path}[${index}] must be a plain enumerable JSON property`,
          );
        }
        const item: unknown = property.value;
        assertJson(item, `${path}[${index}]`, stack);
      }
      const extraKeys = Object.getOwnPropertyNames(value).filter(
        (key) =>
          key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length),
      );
      if (extraKeys.length > 0) {
        throw new TypeError(`zogan: island props ${path} contains a non-JSON array property`);
      }
      return;
    }

    if (!isPlainObject(value)) {
      throw new TypeError(`zogan: island props ${path} must contain only plain JSON objects`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`zogan: island props ${path} contains a symbol key`);
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (
        property?.enumerable !== true ||
        property.get !== undefined ||
        property.set !== undefined
      ) {
        throw new TypeError(
          `zogan: island props ${path}.${key} must be a plain enumerable JSON property`,
        );
      }
      const propertyValue: unknown = property.value;
      assertJson(propertyValue, `${path}.${key}`, stack);
    }
  } finally {
    stack.delete(value);
  }
};

const serializeProps = (props: unknown): string => {
  if (
    props === null ||
    typeof props !== "object" ||
    Array.isArray(props) ||
    !isPlainObject(props)
  ) {
    throw new TypeError("zogan: island props must be a plain JSON object");
  }
  assertJson(props, "$", new Set());
  return JSON.stringify(props);
};

const assertTrigger = (trigger: string): void => {
  const valid =
    trigger === "load" ||
    trigger === "idle" ||
    trigger === "visible" ||
    (trigger.startsWith("media:") && trigger.slice("media:".length).trim() !== "");
  if (!valid) throw new TypeError(`zogan: invalid island trigger ${JSON.stringify(trigger)}`);
};

/** Props accepted by the server-rendered Island boundary component. */
export interface IslandProps<Props extends JsonObject> {
  /** Typed Island descriptor. */
  readonly of: IslandDescriptor<Props>;
  /** Strict JSON props serialized into the local marker. */
  readonly props: Props;
  /** Optional activation trigger. Defaults to load. */
  readonly trigger?: IslandTrigger;
}

/** Render the server-owned half of an island with a fixed, explicit marker. */
// oxlint-disable-next-line no-explicit-any -- Preact's VNode parameter is invariant.
export function Island<Props extends JsonObject>(props: IslandProps<Props>): VNode<any> {
  if (useContext(renderKind) === "fragment") {
    throw new TypeError("zogan: Island cannot be rendered inside a Fragment response");
  }
  if (useContext(islandOwner)) {
    throw new TypeError("zogan: nested Islands are not supported");
  }
  const trigger = props.trigger ?? "load";
  assertTrigger(trigger);
  const serialized = serializeProps(props.props);
  return h(
    "div",
    {
      "data-zogan-island": props.of.id,
      "data-zogan-mode": props.of.mode,
      "data-zogan-protocol": ZOGAN_PROTOCOL_VERSION,
      "data-zogan-trigger": trigger,
      "data-zogan-props": serialized,
    },
    h(islandOwner.Provider, { value: true }, h(props.of[descriptorComponent], props.props)),
  );
}
