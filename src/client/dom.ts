/**
 * DOM 層。マーカーの走査と差し替え（§3.3）。
 *
 * ここはモジュールのトップレベルで document / window に触れない。
 * zogan/client はサーババンドルでも評価可能でなければならない（§7.3.2）。
 */
import { findMarkers } from "../server/markers.ts";
import type { PartialMode } from "../server/partial.ts";

const MARKER_PREFIX = "p:";
const MARKER_END_PREFIX = "/p:";

const isElement = (node: Node): node is Element => node.nodeType === 1;
const isComment = (node: Node): node is Comment => node.nodeType === 8;

const markerName = (node: Node, closing: boolean): string | null => {
  if (!isComment(node)) return null;
  const data = node.data;
  const prefix = closing ? MARKER_END_PREFIX : MARKER_PREFIX;
  if (!data.startsWith(prefix)) return null;
  if (!closing && data.startsWith(MARKER_END_PREFIX)) return null;
  return data.slice(prefix.length);
};

/**
 * ノード自身とその子孫からセレクタに一致する要素を集める（§5.2.3 / §6.1.3）。
 *
 * querySelectorAll は呼び出し元の要素自身を含まない。マーカー直下に置かれた
 * <script data-store> はまさにその位置に来るので、node.matches を忘れると必ず取り逃がす。
 */
export const collect = (nodes: readonly Node[], selector: string): Element[] => {
  const found: Element[] = [];
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.matches(selector)) found.push(node);
    found.push(...node.querySelectorAll(selector));
  }
  return found;
};

/**
 * 挿入先の文脈ごとのラッパー。
 *
 * <tbody> 直下に入る <tr> は、素の <template> に食わせると落ちる。テキストや
 * コメントが先に現れた時点でパーサが in-body モードへ移り、以降の <tr> が
 * 無視されるため。マーカーはラッパー要素を挟まない位置に置ける（§3.3.3）ので、
 * 挿入先の親要素に合わせて文脈を作ってから解析する。
 */
const CONTEXT_WRAPPERS: Record<string, { open: string; close: string; depth: number }> = {
  TABLE: { open: "<table>", close: "</table>", depth: 1 },
  THEAD: { open: "<table><thead>", close: "</thead></table>", depth: 2 },
  TBODY: { open: "<table><tbody>", close: "</tbody></table>", depth: 2 },
  TFOOT: { open: "<table><tfoot>", close: "</tfoot></table>", depth: 2 },
  TR: { open: "<table><tbody><tr>", close: "</tr></tbody></table>", depth: 3 },
  COLGROUP: { open: "<table><colgroup>", close: "</colgroup></table>", depth: 2 },
  SELECT: { open: "<select>", close: "</select>", depth: 1 },
  OPTGROUP: { open: "<select><optgroup>", close: "</optgroup></select>", depth: 2 },
};

/** HTML 断片をノード列にする。<template> を使うのは <tr> / <option> を落とさないため */
export const parseHTMLFragment = (html: string, contextTag?: string): Node[] => {
  const template = document.createElement("template");
  const wrapper = contextTag === undefined ? undefined : CONTEXT_WRAPPERS[contextTag.toUpperCase()];

  if (wrapper === undefined) {
    template.innerHTML = html;
    return [...template.content.childNodes];
  }

  template.innerHTML = `${wrapper.open}${html}${wrapper.close}`;
  let node: Node = template.content;
  for (let depth = 0; depth < wrapper.depth; depth += 1) {
    const child = [...node.childNodes].find((n) => n.nodeType === 1);
    if (child === undefined) return [];
    node = child;
  }
  return [...node.childNodes];
};

export interface DomMarkerRange {
  readonly name: string;
  readonly start: Comment;
  readonly end: Comment;
  readonly parent: Node;
}

const commentWalker = (root: ParentNode): TreeWalker =>
  document.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);

/** 文書内の Partial 名を宣言順で返す。既定の X-Partial はこれを送る（§7.2.3） */
export const listMarkerNames = (root: ParentNode = document): string[] => {
  const names: string[] = [];
  const walker = commentWalker(root);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const name = markerName(node, false);
    if (name !== null) names.push(name);
  }
  return names;
};

/** 開始・終了マーカーを引く。同じ親の直接の子であること（§3.3.1）を確認する */
export const findMarkerRange = (root: ParentNode, name: string): DomMarkerRange | null => {
  const walker = commentWalker(root);
  let start: Comment | null = null;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (start === null) {
      if (markerName(node, false) === name) start = node as Comment;
      continue;
    }
    if (markerName(node, true) === name) {
      const end = node as Comment;
      if (end.parentNode !== start.parentNode || start.parentNode === null) {
        throw new Error(
          `zogan: partial "${name}" markers are not siblings under the same parent (§3.3.1)`,
        );
      }
      return { name, start, end, parent: start.parentNode };
    }
  }
  return null;
};

/** マーカー間の兄弟ノード列。差し替え前の後始末（Island の dispose・preserve）に使う */
export const rangeNodes = (range: DomMarkerRange): Node[] => {
  const nodes: Node[] = [];
  for (let node = range.start.nextSibling; node !== null && node !== range.end;) {
    nodes.push(node);
    node = node.nextSibling;
  }
  return nodes;
};

/**
 * マーカー範囲を差し替える（§3.3.2）。マーカー自身は削除しない。
 * 戻り値は今回挿入されたノード列。Store マージと hydrate の走査対象になる。
 */
export const replaceRange = (
  root: ParentNode,
  name: string,
  newNodes: readonly Node[],
  mode: PartialMode,
): Node[] | null => {
  const range = findMarkerRange(root, name);
  if (range === null) return null;

  const { start, end, parent } = range;
  const inserted = [...newNodes];
  const fragment = document.createDocumentFragment();
  for (const node of inserted) fragment.appendChild(node);

  if (mode === "replace") {
    let node = start.nextSibling;
    while (node !== null && node !== end) {
      const next = node.nextSibling;
      parent.removeChild(node);
      node = next;
    }
    parent.insertBefore(fragment, end);
  } else if (mode === "append") {
    parent.insertBefore(fragment, end);
  } else {
    parent.insertBefore(fragment, start.nextSibling);
  }

  return inserted;
};

/**
 * 部分応答を領域ごとの HTML 文字列に分解する（§3.2.2）。
 *
 * ここで返すのはマーカーの内側だけ。受け取ったマーカーを取り除いてから挿入するのは、
 * 二重にマーカーが積み重なるのを防ぐため（§3.3.2）。入れ子のマーカーは中身の一部
 * なのでそのまま残る。
 *
 * ノードではなく文字列で返すのは、解析を挿入先の文脈まで遅らせるため
 * （parseHTMLFragment の CONTEXT_WRAPPERS を参照）。
 */
export const splitPartials = (html: string): Map<string, string> => {
  const parts = new Map<string, string>();
  for (const range of findMarkers(html)) {
    if (range.parent !== null) continue;
    parts.set(range.name, html.slice(range.innerStart, range.innerEnd));
  }
  return parts;
};
