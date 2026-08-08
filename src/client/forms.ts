/**
 * フォーム送信（§7.1.3 / §7.2.4）。
 *
 * data-partial または data-fragment を持つフォームだけを傍受する。
 * どちらも無ければブラウザの通常送信。Fresh が一度失敗して直した設計をなぞる。
 * フォームだけは祖先の data-client-nav を継承しない。
 */
import { splitPartials } from "./dom.ts";
import { refreshFragment } from "./fragments.ts";
import {
  applyParts,
  focusAndScroll,
  navigate,
  parseList,
  parseModes,
  PARTIAL_HEADER,
  PARTIAL_MODE_HEADER,
} from "./nav.ts";
import { mergeSnapshots } from "./store.ts";
import {
  isHtmlContentType,
  isManualRedirect,
  sameOrderedNames,
  sameOriginUrl,
} from "./protocol.ts";

export const shouldInterceptForm = (form: HTMLFormElement): boolean =>
  (form.hasAttribute("data-partial") || form.hasAttribute("data-fragment")) &&
  sameOriginUrl(form.getAttribute("action") || location.href) !== null;

const submitterAttribute = (submitter: HTMLElement | null, name: string): string | null =>
  submitter?.getAttribute(name) ?? null;

const formAction = (form: HTMLFormElement, submitter: HTMLElement | null): URL | null => {
  const action = submitterAttribute(submitter, "formaction") ?? form.getAttribute("action");
  return sameOriginUrl(action === null || action === "" ? location.href : action);
};

const formData = (form: HTMLFormElement, submitter: HTMLElement | null): FormData => {
  const data = new FormData(form);
  const name = submitter?.getAttribute("name");
  if (name && submitter !== null && !submitter.hasAttribute("disabled")) {
    data.append(name, submitter.getAttribute("value") ?? "");
  }
  return data;
};

const queryFrom = (data: FormData): URLSearchParams => {
  const query = new URLSearchParams();
  for (const [name, value] of data)
    query.append(name, typeof value === "string" ? value : value.name);
  return query;
};

const requestBody = (data: FormData, enctype: string): { body: BodyInit; contentType?: string } => {
  if (enctype === "multipart/form-data") return { body: data };
  if (enctype === "text/plain") {
    const body = [...data]
      .map(([name, value]) => `${name}=${typeof value === "string" ? value : value.name}`)
      .join("\r\n");
    return { body: `${body}\r\n`, contentType: "text/plain;charset=UTF-8" };
  }
  return { body: queryFrom(data) };
};

const nodesOf = (html: string): Node[] => {
  const template = document.createElement("template");
  template.innerHTML = html;
  return [...template.content.childNodes];
};

/** フォールバック = そのフォームを通常送信し直す。ブラウザに元の送信をやらせる（§7.2.4） */
const fallback = (form: HTMLFormElement): void => {
  HTMLFormElement.prototype.submit.call(form);
};

export const handleSubmit = async (event: Event, form: HTMLFormElement): Promise<void> => {
  if (!shouldInterceptForm(form)) return;
  const submitter =
    event instanceof SubmitEvent && event.submitter instanceof HTMLElement ? event.submitter : null;
  const method = (
    submitterAttribute(submitter, "formmethod") ??
    form.getAttribute("method") ??
    "get"
  ).toLowerCase();
  const url = formAction(form, submitter);
  if (url === null || (method !== "get" && method !== "post")) return;
  event.preventDefault();

  const partials = form.hasAttribute("data-partial")
    ? parseList(form.getAttribute("data-partial"))
    : null;
  const fragments = parseList(form.getAttribute("data-fragment"));
  const data = formData(form, submitter);

  // method="get" かつ data-partial は、組み立てた URL でソフトナビゲーションを行う
  if (method === "get" && partials !== null) {
    url.search = queryFrom(data).toString();
    await navigate(url, partials.length > 0 ? { partials } : {});
    for (const fragmentUrl of fragments) await refreshFragment(fragmentUrl);
    return;
  }

  let res: Response;
  try {
    const enctype = (
      submitterAttribute(submitter, "formenctype") ??
      form.getAttribute("enctype") ??
      "application/x-www-form-urlencoded"
    ).toLowerCase();
    const encoded = requestBody(data, enctype);
    const init: RequestInit =
      method === "get"
        ? { method: "GET", credentials: "same-origin" }
        : { method: "POST", body: encoded.body, credentials: "same-origin" };
    if (method === "get") {
      url.search = queryFrom(data).toString();
    }
    const headers = new Headers({ Accept: "text/html" });
    headers.set("X-Zogan-Request", "form");
    if (encoded.contentType !== undefined && method !== "get") {
      headers.set("Content-Type", encoded.contentType);
    }
    if (partials !== null && partials.length > 0) {
      headers.set(PARTIAL_HEADER, partials.join(","));
    }
    res = await fetch(url.href, {
      ...init,
      redirect: "manual",
      headers,
    });
    if (isManualRedirect(res) || !res.ok) throw new Error(`status ${res.status}`);
    if (!isHtmlContentType(res.headers.get("Content-Type"))) {
      throw new Error("response is not html");
    }
  } catch (error) {
    console.warn("zogan: form submission failed, falling back to a normal submit", error);
    fallback(form);
    return;
  }

  const html = await res.text();

  // 4. 応答本文の [data-store] をマージ。差し替えや Fragment 取り直しより先（§7.2.4）
  const returned = res.headers.get(PARTIAL_HEADER);
  const hasPartials = partials !== null && returned !== null && parseList(returned).length > 0;

  if (hasPartials) {
    let parts: Map<string, string>;
    try {
      parts = splitPartials(html);
    } catch (error) {
      console.warn("zogan: failed to parse partial response from form", error);
      fallback(form);
      return;
    }
    const returnedNames = parseList(returned);
    if (!sameOrderedNames(returnedNames, parts.keys())) {
      fallback(form);
      return;
    }
    // マージ対象はマーカーの外にある snapshot も含むため、応答全体を見る
    mergeSnapshots(nodesOf(html));
    const applied = applyParts(parts, parseModes(res.headers.get(PARTIAL_MODE_HEADER)));
    // POST の送信先 URL を履歴に積むと、戻るボタンで再送信になる（§7.2.4）
    focusAndScroll(applied.firstReplaced, "");
  } else {
    mergeSnapshots(nodesOf(html));
  }

  // 6. data-fragment があれば各 URL を取り直す。1 本が失敗しても他は続行
  for (const fragmentUrl of fragments) await refreshFragment(fragmentUrl);
};

export const onDocumentSubmit = (event: Event): void => {
  const form = event.target as HTMLFormElement | null;
  if (form === null || form.tagName !== "FORM") return;
  if (!shouldInterceptForm(form)) return;
  void handleSubmit(event, form);
};
