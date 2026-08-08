/**
 * Island のハイドレーション（§6.1.3）。
 *
 * Island は差し替えのたびに作り直されてよい。状態は Island の外にある（§2）。
 */
import { h, hydrate, render, type ComponentType } from "preact";
import { collect } from "./dom.ts";
import { applyFragmentHtml, fetchFragment } from "./fragments.ts";

/** A Preact component registered under an Island name. */
// oxlint-disable-next-line no-explicit-any
export type IslandComponent = ComponentType<any>;

const components = new Map<string, IslandComponent>();

/** data-island の名前からコンポーネントを引く registry。start({ islands }) が登録する */
export const registerIslands = (islands: Record<string, IslandComponent>): void => {
  for (const [name, component] of Object.entries(islands)) components.set(name, component);
};

/** テスト用 */
export const __resetIslands = (): void => {
  components.clear();
};

/** 走査済み（trigger 登録済み）と、実際にハイドレート済みを分けて持つ */
const claimed = new WeakSet<Element>();
const hydrated = new WeakSet<Element>();

/** 未発火の trigger の後始末。忘れると差し替えのたびにリスナが積み上がる（§6.1.3） */
const pendingTriggers = new Map<Element, () => void>();
const activations = new WeakMap<Element, symbol>();

const parseProps = (el: Element): Record<string, unknown> => {
  const raw = el.getAttribute("data-props");
  if (raw === null || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    console.warn(`zogan: island ${el.getAttribute("data-island") ?? ""} has invalid data-props`);
    return {};
  }
};

const clearTrigger = (el: Element): void => {
  const cleanup = pendingTriggers.get(el);
  if (cleanup !== undefined) {
    pendingTriggers.delete(el);
    cleanup();
  }
};

type IdleWindow = {
  requestIdleCallback?: (cb: () => void) => number;
  cancelIdleCallback?: (id: number) => void;
};

const scheduleTrigger = (el: Element, trigger: string, run: () => void): void => {
  const fire = () => {
    clearTrigger(el);
    run();
  };

  if (trigger === "none") return;
  if (trigger === "load") {
    run();
    return;
  }

  if (trigger === "idle") {
    const idle = globalThis as IdleWindow;
    if (typeof idle.requestIdleCallback === "function") {
      const id = idle.requestIdleCallback(fire);
      pendingTriggers.set(el, () => idle.cancelIdleCallback?.(id));
    } else {
      const id = setTimeout(fire, 1);
      pendingTriggers.set(el, () => clearTimeout(id));
    }
    return;
  }

  if (trigger === "visible") {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.target === el) {
            observer.disconnect();
            fire();
            return;
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    pendingTriggers.set(el, () => observer.disconnect());
    return;
  }

  if (trigger.startsWith("media:")) {
    const query = matchMedia(trigger.slice("media:".length));
    if (query.matches) {
      run();
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) fire();
    };
    query.addEventListener("change", onChange);
    pendingTriggers.set(el, () => query.removeEventListener("change", onChange));
    return;
  }

  console.warn(`zogan: unknown trigger ${JSON.stringify(trigger)}. island will not hydrate`);
};

const activate = async (el: Element, component: IslandComponent): Promise<void> => {
  const token = Symbol();
  activations.set(el, token);
  const fragmentUrl = el.getAttribute("data-fragment");
  if (fragmentUrl !== null && fragmentUrl !== "") {
    // 失敗しても SSR 済みの中身を残して継続する（§6.1.5）
    const html = await fetchFragment(fragmentUrl);
    if (activations.get(el) !== token || !el.isConnected) return;
    if (html !== null) applyFragmentHtml(el, html);
  }

  if (activations.get(el) !== token || !el.isConnected) return;
  hydrate(h(component, parseProps(el)), el);
  hydrated.add(el);
};

/**
 * 今回挿入された範囲の Island を trigger に従ってハイドレートする。
 * ページ全体を毎回走査しない（§6.1.3）。
 */
export const hydrateIslands = (nodes: readonly Node[]): void => {
  for (const el of collect(nodes, "[data-island]")) {
    activations.delete(el);
    if (claimed.has(el)) continue;
    const name = el.getAttribute("data-island") ?? "";
    const component = components.get(name);
    if (component === undefined) {
      // 未登録でも SSR 済みの中身は残る。登録漏れでページ全体が落ちるのは過剰
      console.warn(`zogan: island ${JSON.stringify(name)} is not registered. skipped`);
      continue;
    }
    claimed.add(el);
    scheduleTrigger(el, el.getAttribute("data-trigger") ?? "load", () => {
      void activate(el, component);
    });
  }
};

/** Fragment を取り直した Island を描き直す（§7.1.4） */
export const rehydrateIsland = (el: Element): void => {
  const name = el.getAttribute("data-island") ?? "";
  const component = components.get(name);
  if (component === undefined) return;
  hydrate(h(component, parseProps(el)), el);
  claimed.add(el);
  hydrated.add(el);
};

/**
 * 差し替えで消える Island の後始末。
 * IntersectionObserver / matchMedia のリスナと未発火の idle コールバックを解除する。
 */
export const disposeIslandsIn = (nodes: readonly Node[]): void => {
  for (const el of collect(nodes, "[data-island]")) {
    clearTrigger(el);
    if (hydrated.has(el)) {
      // effect のクリーンアップを走らせてから捨てる
      render(null, el);
      hydrated.delete(el);
    }
    claimed.delete(el);
  }
};
