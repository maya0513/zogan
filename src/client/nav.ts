/**
 * ソフトナビゲーション（§7.1 / §7.2 / §7.3）。
 *
 * 原則は「疑わしきは通常遷移」。判定を間違えて通常遷移になっても遅いだけで壊れないが、
 * 傍受してはいけないものを傍受すると決済が止まる（§7.1.5）。
 */
import type { PartialMode } from "../server/partial.ts";
import { browser } from "./browser.ts";
import {
  findMarkerRange,
  listMarkerNames,
  parseHTMLFragment,
  rangeNodes,
  replaceRange,
  splitPartials,
} from "./dom.ts";
import { disposeIslandsIn, hydrateIslands } from "./islands.ts";
import { savePreserved, restorePreserved } from "./preserve.ts";
import { setNavigating, setPendingPartials } from "./signals.ts";
import { mergeSnapshots } from "./store.ts";
import {
  isHtmlContentType,
  isManualRedirect,
  sameOrderedNames,
  sameOriginUrl,
} from "./protocol.ts";

export const PARTIAL_HEADER = "X-Partial";
/**
 * mode は宣言（<Partial mode>）にあり、マーカーには出力しない（付録 A.1.5）。
 * クライアントは応答ヘッダから受け取る。既定は replace。
 */
export const PARTIAL_MODE_HEADER = "X-Partial-Mode";

/** Options controlling a soft navigation. */
export interface NavigateOptions {
  /** 要求する領域。省略時は現在の DOM のマーカー全部（§7.2.3） */
  partials?: string[];
  /** true なら pushState ではなく replaceState */
  replace?: boolean;
  /** data-view-transition（§7.3.6） */
  viewTransition?: boolean;
}

type InternalNavigateOptions = NavigateOptions & { history?: "push" | "replace" | "none" };

/** 進行中の fetch。最後のナビゲーションだけを適用する（§7.3.2） */
let controller: AbortController | null = null;

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

export const parseList = (raw: string | null | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");

export const parseModes = (raw: string | null): Map<string, PartialMode> => {
  const modes = new Map<string, PartialMode>();
  for (const entry of parseList(raw)) {
    const [name, mode] = entry.split("=");
    if (name === undefined || mode === undefined) continue;
    if (mode === "append" || mode === "prepend" || mode === "replace") modes.set(name, mode);
  }
  return modes;
};

/** §7.1.1 最も近い祖先が勝つ。属性が 1 つも無ければ無効 */
export const resolveClientNav = (el: Element | null): boolean => {
  for (let node = el; node !== null; node = node.parentElement) {
    if (node.hasAttribute("data-client-nav")) {
      return node.getAttribute("data-client-nav") !== "false";
    }
  }
  return false;
};

/** §7.1.2 すべて満たす場合のみソフトナビゲーションに入る */
export const shouldIntercept = (event: MouseEvent, a: HTMLAnchorElement): boolean => {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  const href = a.getAttribute("href");
  if (href === null || href === "") return false;
  if (a.hasAttribute("download")) return false;

  const target = a.getAttribute("target");
  if (target !== null && target !== "" && target !== "_self") return false;
  if (parseList((a.getAttribute("rel") ?? "").replaceAll(/\s+/g, ",")).includes("external")) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(a.href, location.href);
  } catch {
    return false;
  }
  // mailto: / tel: / javascript: と外部ドメインはここで弾かれる
  if (url.origin !== location.origin) return false;
  // 同一文書内アンカー（#foo）はブラウザに任せる。傍受するとアンカースクロールが失われる
  if (url.pathname === location.pathname && url.search === location.search) return false;

  return resolveClientNav(a);
};

export const handleClick = (event: MouseEvent, a: HTMLAnchorElement): void => {
  if (!shouldIntercept(event, a)) return;
  event.preventDefault();

  const partials = a.hasAttribute("data-partial")
    ? parseList(a.getAttribute("data-partial"))
    : undefined;
  void navigate(a.href, {
    ...(partials !== undefined ? { partials } : {}),
    viewTransition: a.hasAttribute("data-view-transition"),
  });
};

export const onDocumentClick = (event: MouseEvent): void => {
  const el = event.target as Element | null;
  const a = el?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (a === null || a === undefined) return;
  handleClick(event, a);
};

const fallback = (href: string): void => {
  // 壊れた画面を出さない。ユーザから見れば「少し遅い通常の遷移」（§7.3.1）
  browser.hardNavigate(href);
};

interface Applied {
  inserted: Node[];
  /** 最初に replace された領域のノード列。focus 移動の対象（§7.3.3） */
  firstReplaced: Node[] | null;
}

/** ステップ 5〜9。DOM 挿入・preserve・Store マージ・ハイドレート */
export const applyParts = (
  parts: Map<string, string>,
  modes: Map<string, PartialMode>,
): Applied => {
  const inserted: Node[] = [];
  let firstReplaced: Node[] | null = null;

  for (const [name, html] of parts) {
    const range = findMarkerRange(document, name);
    // 一部の領域だけ DOM に存在する場合は、存在する分だけ差し替える（§7.3.1 の 9）
    if (range === null) continue;

    // 解析は挿入先の文脈で行う。<tbody> 直下の <tr> を落とさないため（§3.3.3）
    const parent = range.parent as Element;
    const nodes = parseHTMLFragment(html, parent.tagName);
    const mode = modes.get(name) ?? "replace";
    const replaced = mode === "replace";
    const old = replaced ? rangeNodes(range) : [];
    if (replaced) disposeIslandsIn(old);
    const preserved = savePreserved(old);

    const added = replaceRange(document, name, nodes, mode) ?? [];
    restorePreserved(added, preserved);

    if (replaced && firstReplaced === null) firstReplaced = added;
    inserted.push(...added);
  }

  // 8 が 9 より先。逆順だと Island が古い値で一度描画されてから正しい値に飛ぶ（§7.2.2）
  mergeSnapshots(inserted);
  hydrateIslands(inserted);

  return { inserted, firstReplaced };
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * §7.3.3 focus は差し替え（replace）のときだけ動かす。
 * append / prepend は蓄積であってページ遷移ではないので、focus もスクロールも動かさない。
 */
export const focusAndScroll = (firstReplaced: Node[] | null, hash: string): void => {
  if (firstReplaced === null) return;

  const elements = firstReplaced.filter((n): n is Element => n.nodeType === 1);
  const head = elements[0];
  if (head !== undefined) {
    const focusable = head.matches(FOCUSABLE)
      ? head
      : (elements.map((el) => el.querySelector(FOCUSABLE)).find((el) => el !== null) ?? null);
    const target = (focusable ?? head) as HTMLElement;
    if (focusable === null || focusable === undefined) target.setAttribute("tabindex", "-1");
    // preventScroll を付けないと、直後のスクロール指定と競合する（§7.3.3）
    target.focus({ preventScroll: true });
  }

  if (hash !== "") {
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      id = hash.slice(1);
    }
    document.getElementById(id)?.scrollIntoView();
    return;
  }
  window.scrollTo(0, 0);
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

const withViewTransition = async (enabled: boolean, mutate: () => void): Promise<void> => {
  const start = (document as ViewTransitionDocument).startViewTransition;
  if (!enabled || typeof start !== "function") {
    mutate();
    return;
  }
  // コールバックが待つのは DOM の差し替えまで。Fragment 取得は待たない（§7.3.6）
  await start.call(document, mutate).finished.catch(() => undefined);
};

/** プログラムからソフトナビゲーションを起こす（付録 A.2.5） */
const navigateInternal = async (
  input: string | URL,
  options: InternalNavigateOptions = {},
): Promise<void> => {
  const url = sameOriginUrl(input);
  if (url === null) {
    fallback(String(input));
    return;
  }
  const href = `${url.pathname}${url.search}${url.hash}`;
  const targets = options.partials ?? listMarkerNames(document);

  controller?.abort();
  const local = new AbortController();
  controller = local;
  setNavigating(true);
  setPendingPartials(targets);

  try {
    let res: Response;
    try {
      res = await fetch(url.href, {
        headers: { [PARTIAL_HEADER]: targets.join(",") },
        // 追跡するとログイン画面の HTML を差し込む事故になる（§8.4.3）
        redirect: "manual",
        credentials: "same-origin",
        signal: local.signal,
      });
    } catch (error) {
      // 新しいナビゲーションが既に走っているのでフォールバックしない（§7.3.1 の 2）
      if (isAbortError(error)) return;
      fallback(href);
      return;
    }

    // ステータスでは判定できない。opaque redirect は status 0（§8.4.3）
    if (isManualRedirect(res)) {
      fallback(href);
      return;
    }
    if (res.status < 200 || res.status >= 300) {
      fallback(href);
      return;
    }
    if (!isHtmlContentType(res.headers.get("Content-Type"))) {
      fallback(href);
      return;
    }
    const returned = res.headers.get(PARTIAL_HEADER);
    if (returned === null) {
      fallback(href);
      return;
    }
    const names = parseList(returned);
    if (names.length === 0) {
      fallback(href);
      return;
    }

    const html = await res.text();
    if (local.signal.aborted) return;

    let parts: Map<string, string>;
    try {
      parts = splitPartials(html);
    } catch (error) {
      console.warn("zogan: failed to parse partial response", error);
      fallback(href);
      return;
    }

    if (!sameOrderedNames(names, parts.keys())) {
      fallback(href);
      return;
    }

    // 返された領域が現在の DOM に 1 つも存在しない → フォールバック（§7.3.1 の 8）
    const applicable = [...parts.keys()].filter((name) => findMarkerRange(document, name) !== null);
    if (applicable.length === 0) {
      fallback(href);
      return;
    }

    // ここから先は DOM を触る。検証はすべて挿入前に終わっている（§7.2.1）
    const modes = parseModes(res.headers.get(PARTIAL_MODE_HEADER));
    let applied: Applied = { inserted: [], firstReplaced: null };
    await withViewTransition(options.viewTransition === true, () => {
      applied = applyParts(parts, modes);
    });

    const historyMode = options.history ?? (options.replace === true ? "replace" : "push");
    if (historyMode === "push") history.pushState(null, "", href);
    else if (historyMode === "replace") history.replaceState(null, "", href);

    focusAndScroll(applied.firstReplaced, url.hash);
  } finally {
    if (controller === local) {
      controller = null;
      setNavigating(false);
      setPendingPartials([]);
    }
  }
};

/** プログラムからソフトナビゲーションを起こす（付録 A.2.5）。 */
export const navigate = (input: string | URL, options: NavigateOptions = {}): Promise<void> =>
  navigateInternal(input, options);

/** popstate 用。現在 URL を再取得し、履歴は書き換えない。 */
export const navigateFromHistory = (input: string | URL): Promise<void> =>
  navigateInternal(input, { history: "none" });
