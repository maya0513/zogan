import { h, type ComponentChildren, type JSX } from "preact";
import { isFragmentElement, type FragmentElement } from "../shared/fragment-elements.ts";

export type { FragmentElement } from "../shared/fragment-elements.ts";

/** Browser trigger supported by a FragmentSlot. */
export type FragmentTrigger = "load" | "idle" | "visible" | "manual" | `media:${string}`;

/** Props for a typed, replaceable HTML Fragment container. */
export type FragmentSlotProps<Element extends FragmentElement = "div"> = {
  readonly as?: Element;
  readonly src: string;
  readonly trigger?: FragmentTrigger;
  readonly children?: ComponentChildren;
} & Omit<
  JSX.IntrinsicElements[Element],
  "as" | "src" | "trigger" | "children" | `data-zogan-${string}`
> & {
    readonly [Attribute in `data-zogan-${string}`]?: never;
  };

const assertFragmentTrigger = (trigger: string): void => {
  const valid =
    trigger === "load" ||
    trigger === "idle" ||
    trigger === "visible" ||
    trigger === "manual" ||
    (trigger.startsWith("media:") && trigger.slice("media:".length).trim() !== "");
  if (!valid) throw new TypeError(`zogan: invalid fragment trigger ${JSON.stringify(trigger)}`);
};

const assertFragmentSrc = (src: string): void => {
  if (src === "" || !src.startsWith("/") || src.startsWith("//") || /[#\\\r\n]/.test(src)) {
    throw new TypeError(
      `zogan: fragment src ${JSON.stringify(src)} must be a root-relative same-origin path without a hash`,
    );
  }

  const pathname = src.split("?", 1)[0] ?? "";
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    throw new TypeError(
      `zogan: fragment src ${JSON.stringify(src)} contains invalid percent encoding`,
    );
  }
  if (decodedPathname.includes("\\")) {
    throw new TypeError(`zogan: fragment src ${JSON.stringify(src)} must not contain a backslash`);
  }
  if (decodedPathname.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new TypeError(`zogan: fragment src ${JSON.stringify(src)} must not contain dot segments`);
  }
};

/**
 * Mark a server-rendered fallback whose wrapper may later receive fragment HTML.
 */
export function FragmentSlot<Element extends FragmentElement = "div">(
  props: FragmentSlotProps<Element>,
): ComponentChildren {
  const { as, src, trigger = "load", children, ...forwarded } = props;
  assertFragmentSrc(src);
  assertFragmentTrigger(trigger);

  for (const name of Object.keys(forwarded)) {
    if (name.toLowerCase().startsWith("data-zogan-")) {
      throw new TypeError(`zogan: ${name} is reserved and cannot override FragmentSlot markers`);
    }
  }

  const tag = as ?? "div";
  if (!isFragmentElement(tag)) {
    throw new TypeError(
      `zogan: FragmentSlot as=${JSON.stringify(tag)} is not a supported replaceable HTML container`,
    );
  }
  const attributes = {
    ...forwarded,
    "data-zogan-fragment": src,
    "data-zogan-trigger": trigger,
  };
  return h(tag, attributes, children);
}
