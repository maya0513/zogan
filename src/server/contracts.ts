import type { Context, Env, Hono, Schema } from "hono";
import type { ComponentChildren, VNode } from "preact";

/** Options installed for one Hono application by {@link zogan}. */
export interface ZoganOptions {
  /** Component wrapped around page renders. Fragment renders never use it. */
  layout?: (props: { children: ComponentChildren }) => VNode;
  /** Fragment endpoint prefix. Defaults to `/_f/`. */
  fragmentPrefix?: string;
  /** Throw contract violations when true. Defaults to non-production environments. */
  dev?: boolean;
}

/** Handler for a full-page route or an `X-Partial` response. */
export type PageHandler<E extends Env = Env> = (c: Context<E>) => Response | Promise<Response>;

/** Fragment handlers receive only a Context so user-specific data is read inside the request. */
export type FragmentHandler<E extends Env = Env> = (c: Context<E>) => Response | Promise<Response>;

/** A Hono application whose environment, schema, and base path are preserved. */
export type ZoganApp<
  E extends Env = Env,
  S extends Schema = Schema,
  BasePath extends string = "/",
> = Hono<E, S, BasePath>;

declare module "hono" {
  interface HonoRequest {
    /** Requested X-Partial names, or null for a full-page request. */
    readonly partials: string[] | null;
  }

  interface ContextRenderer {
    (content: VNode): Response;
  }

  interface Hono {
    page<E extends Env>(this: Hono<E>, path: string, handler: PageHandler<E>): this;
    fragment<E extends Env>(this: Hono<E>, name: string, handler: FragmentHandler<E>): this;
  }
}
