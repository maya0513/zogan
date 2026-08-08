/**
 * data-preserve（§7.3.4）。htmx の退避コンテナ方式をそのまま使う。
 *
 * これは逃げ道であり設計の主軸ではない。用途は動画・音声プレイヤー、
 * 埋め込み決済ウィジェット、入力途中のフォーム、地図の 4 つに限定する。
 */
import { collect } from "./dom.ts";

export type PreservedNodes = Map<string, Element>;

/** 挿入前：差し替え対象範囲の [data-preserve] を退避コンテナへ move */
export const savePreserved = (nodes: readonly Node[]): PreservedNodes => {
  const saved: PreservedNodes = new Map();
  const container = document.createElement("div");
  for (const el of collect(nodes, "[data-preserve]")) {
    const id = el.getAttribute("data-preserve") ?? "";
    if (id === "") continue;
    if (saved.has(id)) {
      console.warn(`zogan: duplicate data-preserve id ${JSON.stringify(id)}`);
      continue;
    }
    container.appendChild(el);
    saved.set(id, el);
  }
  return saved;
};

/** 挿入後：新 DOM 内の同じ ID を、退避しておいた古い要素で置き換える */
export const restorePreserved = (nodes: readonly Node[], saved: PreservedNodes): void => {
  if (saved.size === 0) return;
  for (const fresh of collect(nodes, "[data-preserve]")) {
    const id = fresh.getAttribute("data-preserve") ?? "";
    const old = saved.get(id);
    if (old === undefined) continue;
    fresh.replaceWith(old);
    saved.delete(id);
  }
  // 新 DOM に対応が無い要素は破棄される（退避コンテナごと参照を落とす）
  saved.clear();
};
