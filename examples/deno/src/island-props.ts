import type { JsonObject } from "zogan";

export type PageStatusProps = JsonObject & {
  readonly page: number;
};
