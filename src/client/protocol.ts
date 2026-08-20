export const isHtmlContentType = (contentType: string | null): boolean =>
  contentType?.split(";", 1)[0]?.trim().toLowerCase() === "text/html";

type RedirectResponse = Pick<Response, "type" | "redirected" | "status">;

export const isManualRedirect = (response: RedirectResponse): boolean =>
  response.type === "opaqueredirect" ||
  response.redirected ||
  (response.status >= 300 && response.status < 400);

/** Resolve an explicit root-relative URL without widening it to arbitrary same-origin strings. */
export const fragmentUrl = (input: string): URL | null => {
  if (!input.startsWith("/") || input.startsWith("//") || /[#\\\r\n]/.test(input)) return null;

  const pathname = input.split("?", 1)[0] ?? "";
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decodedPathname.includes("\\")) return null;
  if (decodedPathname.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  try {
    const url = new URL(input, location.href);
    if (url.origin !== location.origin || url.hash !== "") return null;
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};
