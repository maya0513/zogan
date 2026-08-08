/**
 * Fragment の取得（§6.1.5 / §7.1.4）。
 *
 * 【不変条件・§4.3】クライアントは Fragment の URL を組み立てない。
 * 取得先は SSR 済みの HTML に書かれた data-fragment だけで、反映先も
 * その値が完全一致する Island に限られる。任意の URL を渡しても反映先が無い。
 */
import { getFragmentPrefix } from "./config.ts";
import { disposeIslandsIn, rehydrateIsland } from "./islands.ts";
import { parseHTMLFragment } from "./dom.ts";
import { mergeSnapshots } from "./store.ts";
import { isHtmlContentType, isManualRedirect, sameOriginUrl } from "./protocol.ts";

/** 同じ URL の同時取得は全 consumer で共有する。 */
const inFlight = new Map<string, Promise<string | null>>();

/** テスト用 */
export const __resetFragments = (): void => {
  inFlight.clear();
};

/** fragmentPrefix 配下の同一オリジンであること（付録 B.1.1） */
export const isAllowedFragmentUrl = (url: string): boolean => {
  const target = sameOriginUrl(url);
  return (
    target !== null &&
    target.hash === "" &&
    target.username === "" &&
    target.password === "" &&
    target.pathname.startsWith(getFragmentPrefix())
  );
};

/** 取得に失敗しても呼び出し元は既存の中身を残す。ページを落とさない */
export const fetchFragment = async (url: string): Promise<string | null> => {
  if (!isAllowedFragmentUrl(url)) {
    console.warn(
      `zogan: refusing to fetch fragment ${JSON.stringify(url)}: ` +
        `must be a same-origin URL under ${JSON.stringify(getFragmentPrefix())} (§4.3.3)`,
    );
    return null;
  }

  const target = new URL(url, location.href);
  const key = target.href;
  const current = inFlight.get(key);
  if (current !== undefined) return current;

  const request = (async (): Promise<string | null> => {
    try {
      const res = await fetch(target.href, {
        credentials: "same-origin",
        redirect: "manual",
        headers: { Accept: "text/html" },
      });
      if (isManualRedirect(res) || !res.ok) {
        console.warn(
          `zogan: fragment ${url} responded with ${res.status}. keeping current content`,
        );
        return null;
      }
      if (!isHtmlContentType(res.headers.get("Content-Type"))) {
        console.warn(`zogan: fragment ${url} did not return HTML. keeping current content`);
        return null;
      }
      return await res.text();
    } catch (error) {
      console.warn(`zogan: fragment ${url} failed to load. keeping current content`, error);
      return null;
    }
  })();
  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }
};

/**
 * Island の中身を Fragment の応答で丸ごと置換し、snapshot をマージする。
 * マージは必ず hydrate より先（§7.2）。
 */
export const applyFragmentHtml = (el: Element, html: string): void => {
  const nodes = parseHTMLFragment(html);
  el.replaceChildren(...nodes);
  mergeSnapshots([...el.childNodes]);
};

/** 反映先は data-fragment の値が完全一致する Island のみ。部分一致も正規化もしない（§7.1.4） */
export const fragmentTargets = (url: string): Element[] =>
  [...document.querySelectorAll("[data-island][data-fragment]")].filter(
    (el) => el.getAttribute("data-fragment") === url,
  );

/**
 * Fragment を取り直して DOM に反映する（付録 A.2.5）。
 *
 * 用途は §8 の 2 ケース（チェックアウト遷移前・pageshow）のみ。
 * 定期ポーリングに使わないこと。
 */
export const refreshFragment = async (url: string): Promise<void> => {
  const targets = fragmentTargets(url);
  if (targets.length === 0) {
    console.warn(
      `zogan: no island targets found for fragment ${JSON.stringify(url)}. nothing to do`,
    );
    return;
  }

  const html = await fetchFragment(url);
  if (html === null) return;

  for (const el of targets) {
    if (!el.isConnected) continue;
    disposeIslandsIn([...el.childNodes]);
    applyFragmentHtml(el, html);
    rehydrateIsland(el);
  }
};
