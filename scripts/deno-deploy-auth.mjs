export function deployClientOptions(token, org) {
  return {
    apiEndpoint: "https://console.deno.com",
    ...(token.startsWith("ddo_") ? {} : { org }),
    token,
  };
}
