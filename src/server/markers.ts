/**
 * Partial マーカーの生成・走査・切り出し。
 *
 * ここは純粋な文字列処理に閉じている。DOM も Preact も知らない。
 * 規則は §3.1.1 / §3.3 / §3.2.2、一覧は 付録 B.2。
 */

/** 一般識別子（Partial 名・Store 名）。§5.2.1 の表 */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$/;

/** コンポーネント名（data-island の値）。JS 識別子として書けること */
const COMPONENT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

const MAX_IDENTIFIER_LENGTH = 64;

export const isValidIdentifier = (name: string): boolean =>
  name.length > 0 && name.length <= MAX_IDENTIFIER_LENGTH && IDENTIFIER.test(name);

export const isValidComponentName = (name: string): boolean =>
  name.length > 0 && name.length <= MAX_IDENTIFIER_LENGTH && COMPONENT_NAME.test(name);

export const startMarker = (name: string): string => `<!--p:${name}-->`;
export const endMarker = (name: string): string => `<!--/p:${name}-->`;

export interface MarkerRange {
  readonly name: string;
  /** 開始マーカーの先頭位置（マーカーを含む） */
  readonly start: number;
  /** 終了マーカーの末尾位置（マーカーを含む） */
  readonly end: number;
  /** 開始マーカーの直後（中身の先頭） */
  readonly innerStart: number;
  /** 終了マーカーの直前（中身の末尾） */
  readonly innerEnd: number;
  /** 直近の親 Partial の名前。トップレベルなら null */
  readonly parent: string | null;
}

const MARKER = /<!--(\/?)p:([A-Za-z][A-Za-z0-9_-]*)-->/g;

/**
 * HTML 文字列から Partial マーカーの範囲を宣言順で拾う。
 *
 * 開始と終了が同じ親ノードの直接の子であること（§3.3.1）は
 * 出力側（<Partial>）で保証されるため、ここでは検証しない。
 */
export const findMarkers = (html: string): MarkerRange[] => {
  const ranges: MarkerRange[] = [];
  const stack: { name: string; start: number; parent: string | null }[] = [];

  MARKER.lastIndex = 0;
  for (let m = MARKER.exec(html); m !== null; m = MARKER.exec(html)) {
    const [raw, closing, name] = m;
    if (name === undefined) continue;

    if (closing === "") {
      stack.push({
        name,
        start: m.index,
        parent: stack.length > 0 ? stack[stack.length - 1]!.name : null,
      });
      continue;
    }

    const open = stack.pop();
    if (open === undefined || open.name !== name) {
      throw new Error(
        `zogan: partial marker mismatch: <!--/p:${name}--> without a matching <!--p:${name}-->`,
      );
    }
    ranges.push({
      name,
      start: open.start,
      end: m.index + raw.length,
      innerStart: open.start + startMarker(name).length,
      innerEnd: m.index,
      parent: open.parent,
    });
  }

  if (stack.length > 0) {
    const names = stack.map((s) => s.name).join(", ");
    throw new Error(`zogan: unterminated partial marker: ${names}`);
  }

  // pop 順（終了順）なので、宣言順＝開始位置順に並べ直す
  return ranges.sort((a, b) => a.start - b.start);
};

export interface ExtractResult {
  /** 実際に返した領域を宣言順で列挙したもの。応答ヘッダ X-Partial に載る */
  readonly names: string[];
  /** マーカー込みで宣言順に連結した body */
  readonly body: string;
}

/**
 * 要求された領域を切り出す（§3.2.2）。
 *
 * - 順序は JSX 上の宣言順。リクエストの並び順ではない
 * - 開始・終了マーカーを含めて返す
 * - 親子が同時に要求されたら親だけを返す（§3.1.2）
 */
export const extractPartials = (
  html: string,
  requested: readonly string[],
  knownRanges?: readonly MarkerRange[],
): ExtractResult => {
  const wanted = new Set(requested);
  const ranges = knownRanges ?? findMarkers(html);
  const byName = new Map(ranges.map((r) => [r.name, r]));

  const isCoveredByRequestedAncestor = (range: MarkerRange): boolean => {
    for (let p = range.parent; p !== null; p = byName.get(p)?.parent ?? null) {
      if (wanted.has(p)) return true;
    }
    return false;
  };

  const selected = ranges.filter((r) => wanted.has(r.name) && !isCoveredByRequestedAncestor(r));

  return {
    names: selected.map((r) => r.name),
    body: selected.map((r) => html.slice(r.start, r.end)).join(""),
  };
};
