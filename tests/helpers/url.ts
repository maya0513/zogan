/** fetch のモックが受け取る input を URL 文字列にする */
export const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};
