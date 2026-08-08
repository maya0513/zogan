export const isHtmlContentType = (contentType: string | null): boolean =>
  contentType?.split(";", 1)[0]?.trim().toLowerCase() === "text/html";

export const isManualRedirect = (response: Response): boolean =>
  response.type === "opaqueredirect" ||
  response.redirected ||
  (response.status >= 300 && response.status < 400);

export const sameOriginUrl = (input: string | URL): URL | null => {
  try {
    const url = new URL(String(input), location.href);
    return url.origin === location.origin && (url.protocol === "http:" || url.protocol === "https:")
      ? url
      : null;
  } catch {
    return null;
  }
};

export const sameOrderedNames = (
  declared: readonly string[],
  actual: Iterable<string>,
): boolean => {
  const names = [...actual];
  return declared.length === names.length && declared.every((name, index) => name === names[index]);
};
