# Appendix A: Public API

このappendixはsource packageの公開entryだけを列挙する。型宣言は説明用にreadonlyを保った簡略形であり、正確なgeneric inferenceは配布される`.d.ts`を正本とする。

## A.1 `zogan`

### Response

```ts
interface ZoganLayoutProps {
  readonly children?: ComponentChildren;
}

interface ZoganOptions {
  readonly layout?: ComponentType<ZoganLayoutProps>;
}

interface ZoganRenderOptions {
  readonly cache: CachePolicy;
}

interface Zogan {
  page(c: Context, vnode: VNode, options: ZoganRenderOptions): Response;
  fragment(c: Context, vnode: VNode, options: ZoganRenderOptions): Response;
}

declare const createZogan: (options?: ZoganOptions) => Zogan;
```

`page()`はdoctypeと任意layoutを使い、`fragment()`はlayoutなしのHTMLを使う。両方ともcache指定が必須である。layoutを省略した場合、`page()`へ渡すVNode自身が完全document rootを提供する。zoganが暗黙に足すのはdoctypeだけである。

### Cache

```ts
interface PublicCacheOptions {
  readonly maxAge?: number;
  readonly sMaxAge?: number;
  readonly staleWhileRevalidate?: number;
  readonly immutable?: boolean;
  readonly vary?: readonly string[];
}

interface CachePolicyOptions {
  readonly vary?: readonly string[];
}

declare const publicCache: (options?: PublicCacheOptions) => CachePolicy;
declare const privateNoStore: (options?: CachePolicyOptions) => CachePolicy;
declare const cachePolicy: (value: string, options?: CachePolicyOptions) => CachePolicy;
```

`CachePolicy`はopaque typeである。object literalや未検証stringをrender APIへ渡せない。
raw escape hatchは、HTAB、visible ASCII、obs-text以外のHTTP field-value文字を生成時に拒否する。

### Fragment

```ts
type FragmentTrigger = "load" | "idle" | "visible" | `media:${string}`;

type FragmentElement =
  | "a" | "abbr" | "address" | "article" | "aside" | "b" | "bdi" | "bdo"
  | "blockquote" | "button" | "caption" | "cite" | "code" | "colgroup"
  | "data" | "datalist" | "dd" | "del" | "details" | "dfn" | "dialog" | "div"
  | "dl" | "dt" | "em" | "fieldset" | "figcaption" | "figure" | "footer"
  | "form" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "header" | "hgroup"
  | "i" | "ins" | "kbd" | "label" | "legend" | "li" | "main" | "mark" | "menu"
  | "meter" | "nav" | "ol" | "optgroup" | "output" | "p" | "pre" | "progress"
  | "q" | "rp" | "rt" | "ruby" | "s" | "samp" | "search" | "section" | "select"
  | "small" | "span" | "strong" | "sub" | "summary" | "sup" | "table" | "tbody"
  | "td" | "tfoot" | "th" | "thead" | "time" | "tr" | "u" | "ul" | "var";

type FragmentSlotProps<Element extends FragmentElement = "div"> = {
  readonly as?: Element;
  readonly src: string;
  readonly trigger?: FragmentTrigger;
  readonly children?: ComponentChildren;
} & Omit<
  JSX.IntrinsicElements[Element],
  "as" | "src" | "trigger" | "children" | `data-zogan-${string}`
> & {
  readonly [Attribute in `data-zogan-${string}`]?: never;
};

declare function FragmentSlot<Element extends FragmentElement = "div">(
  props: FragmentSlotProps<Element>,
): ComponentChildren;
```

`as`の既定値は`div`である。intrinsic attributeは転送されるが、`data-zogan-*`は予約済みである。

### Island

```ts
type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
type JsonObject = { readonly [key: string]: JsonValue };
type IslandMode = "hydrate" | "mount";
type IslandTrigger = "load" | "idle" | "visible" | `media:${string}`;

interface DefineIslandOptions<Props extends JsonObject> {
  readonly id: string;
  readonly component: ComponentType<Props>;
}

interface DefineClientIslandOptions<Props extends JsonObject> {
  readonly id: string;
  readonly fallback: ComponentType<Props>;
}

interface IslandProps<Props extends JsonObject> {
  readonly of: IslandDescriptor<Props>;
  readonly props: Props;
  readonly trigger?: IslandTrigger;
}

declare const defineIsland: <Props extends JsonObject>(
  options: DefineIslandOptions<Props>,
) => IslandDescriptor<Props>;

declare const defineClientIsland: <Props extends JsonObject>(
  options: DefineClientIslandOptions<Props>,
) => IslandDescriptor<Props>;

declare function Island<Props extends JsonObject>(props: IslandProps<Props>): VNode;

type IslandComponentFor<Descriptor> =
  Descriptor extends IslandDescriptor<infer Props> ? ComponentType<Props> : never;
```

`IslandDescriptor<Props>`は`id`と`mode`をreadできるopaque descriptorであり、公開されないsymbol fieldにserver componentとprops typeを保持する。利用者がobject literalで偽造する型ではない。

## A.2 `zogan/client`

```ts
type IslandComponent = ComponentType<any>;

interface IslandModule {
  readonly default: IslandComponent;
}

type IslandLoader = () => Promise<IslandModule>;

interface StartOptions {
  readonly islands?: Readonly<Record<string, IslandLoader>>;
  readonly root?: Element;
}

interface ClientRuntime {
  dispose(): void;
}

declare const start: (options?: StartOptions) => ClientRuntime;
```

`start()`は指定rootのIslandだけを一度scanする。rootの既定値は`document.documentElement`で、handleの`dispose()`はpending workとPreact rootを停止し、server fallbackを復元する。

## A.3 `zogan/fragments`

```ts
interface StartFragmentsOptions {
  readonly root?: Element;
}

interface FragmentClientRuntime {
  dispose(): void;
}

declare const startFragments: (options?: StartFragmentsOptions) => FragmentClientRuntime;
```

`startFragments()`は指定rootのFragmentだけを一度scanする。imperative refresh、manual trigger、挿入後の再scanは提供しない。

## A.4 `zogan/vite`

```ts
interface ZoganPluginOptions {
  clientOnly?: string[];
  islandsDir?: string;
  serverOnly?: string[];
}

declare const zoganVite: (options?: ZoganPluginOptions) => Plugin;
export default zoganVite;
```

`clientOnly`と`serverOnly`の既定値は空配列、`islandsDir`の既定値は`src/islands`である。相対`islandsDir`はVite root基準、absolute pathはそのまま使う。直下の`*.tsx`だけが対象である。Vite 8はoptional peerで、pluginを使わないapplicationには不要である。

pluginは`virtual:zogan/islands`をintegration surfaceとして提供する。生成moduleは各`*.tsx`を個別のdynamic import loaderへし、`islands` mapをexportして`start({ islands })`を一度呼ぶ。

```ts
declare module "virtual:zogan/islands" {
  export const islands: Readonly<Record<string, import("zogan/client").IslandLoader>>;
  export const runtime: import("zogan/client").ClientRuntime;
}
```

## A.5 package entry

| npm import | JSR import | Runtime value exports |
|---|---|---|
| `zogan` | `@maya0513/zogan` | `FragmentSlot`, `Island`, `cachePolicy`, `createZogan`, `defineClientIsland`, `defineIsland`, `privateNoStore`, `publicCache` |
| `zogan/client` | `@maya0513/zogan/client` | `start` |
| `zogan/fragments` | `@maya0513/zogan/fragments` | `startFragments` |
| `zogan/vite` | `@maya0513/zogan/vite` | default export、`zoganVite` |

scanner、registry、DOM parser、protocol guard、test reset hookは内部実装であり公開APIではない。
