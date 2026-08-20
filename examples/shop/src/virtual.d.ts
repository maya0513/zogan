declare module "virtual:zogan/islands" {
  export const islands: Readonly<Record<string, import("zogan/client").IslandLoader>>;
}
