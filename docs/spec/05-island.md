# §5 Island

## 5.1 typed descriptor

Islandは最初にserver descriptorを定義する。

```tsx
import { defineClientIsland, defineIsland, type JsonObject } from "zogan";
import Counter, { type CounterProps } from "../islands/Counter.tsx";

export const CounterIsland = defineIsland<CounterProps>({
  id: "Counter",
  component: Counter,
});

export const MapIsland = defineClientIsland<JsonObject>({
  id: "Map",
  fallback: () => <p>Map loading</p>,
});
```

| factory | mode | server output | client activation |
|---|---|---|---|
| `defineIsland` | `hydrate` | `component(props)` のHTML | 対応するlazy client componentを既存DOMへhydrate |
| `defineClientIsland` | `mount` | `fallback(props)` のHTML | fallbackを消してclient moduleをrender |

descriptorはfreezeされ、props型を保持する。IDは `^[A-Za-z][A-Za-z0-9_]{0,63}$` を満たす必要があり、server、Vite、clientの各境界で同じ規則を検証する。

## 5.2 rendering

```tsx
<Island of={CounterIsland} props={{ count: 3 }} trigger="visible" />
```

`Island` は常に固定の `div` wrapperを出力する。`props` は省略できない。clientもmarker elementのlocal nameが`div`であることとID規則をloader lookup前に検証し、raw `span`、`template`、SVG等へ付けたmarkerや不正IDは起動しない。

Island wrapperで許される予約attributeは`data-zogan-island`、`data-zogan-mode`、`data-zogan-protocol`、`data-zogan-trigger`、`data-zogan-props`だけである。それ以外の`data-zogan-*`があれば、clientはloader lookup前とasync activate前の両方で拒否する。

```html
<div
  data-zogan-island="Counter"
  data-zogan-mode="hydrate"
  data-zogan-protocol="1"
  data-zogan-trigger="visible"
  data-zogan-props="{&quot;count&quot;:3}"
>
  <button>3</button>
</div>
```

## 5.3 JSON props

`JsonObject` / `JsonValue` はJSONで往復できる値だけを表す。serverは型だけに依存せず、実行時にも全graphを検証する。

- top-levelはplain object。`Object.prototype` またはnull prototypeだけ
- nested valueはnull、boolean、string、有限number、array、plain object
- `undefined`、function、symbol、bigint、`NaN`、infinityを拒否
- class instance、Date、Map、Set等のnon-plain objectを拒否
- cycle、sparse array、extra array propertyを拒否
- getter/setter、non-enumerable property、symbol keyを拒否

検証後に `JSON.stringify` し、Preact rendererがHTML attributeとしてescapeする。clientも `data-zogan-props` の存在、top-level object、全nested valueがfiniteなJSON値であることを再帰検証する。欠落、array/null/primitiveのtop-level、壊れたJSON、overflowして非finiteになったnumberはfallbackを残す。

propsへsecretを入れるとpage HTMLへ出る。public page上のIsland propsは全ユーザへ公開可能な値だけにする。ユーザ固有propsが必要ならprivate pageでIslandをrenderする。Fragment response内にIslandは置けない。

## 5.4 trigger

```ts
type IslandTrigger = "load" | "idle" | "visible" | `media:${string}`;
```

component propの既定は `load`で、serverはtrigger markerを必ず出す。raw markerでtriggerが欠落または不正、あるいは対応browser APIがなければ警告してSSR/fallbackを維持する。

triggerが発火するまで、そのIDのloaderを呼ばない。`visible` やmedia queryは、初期bundleと初期実行costを局所化するための機能である。

## 5.5 client module mapping

client moduleはdefault exportに対応componentを置く。

```tsx
// src/islands/Counter.tsx
import type { JsonObject } from "zogan";

export type CounterProps = JsonObject & { readonly count: number };

export default function Counter({ count }: CounterProps) {
  return <button>{count}</button>;
}
```

Vite pluginは `islandsDir` 直下の `*.tsx` だけを列挙し、filename stemをIDにする。相対directoryはVite root基準、absolute directoryはそのまま使う。subdirectory、`.ts`、`.jsx`は列挙しない。各entryは個別のdynamic import loaderになる。

```text
server descriptor id: Counter
client filename:       Counter.tsx
loader registry key:   Counter
markup marker:         data-zogan-island="Counter"
```

この4値は完全一致が必要である。pluginはstemの文字pattern、64文字上限、生成対象内の重複IDをbuild時に拒否するが、server descriptor sourceを解析して一致を証明するわけではない。descriptorとの一致とdefault exportのcomponent検査はruntimeとapplication testで守る。

IDは1つのclient entry内でglobalに扱う。別moduleで同じIDのdescriptorを複数定義してもserver APIは横断検出できないため、同じIDへ異なるcomponentやprops schemaを割り当てない。

`islandsDir` が存在しない、または読めない場合、pluginは空のloader mapを生成する。Fragmentだけのapplicationを許すためbuild errorにはしないので、意図せずdirectoryを誤指定したケースはapplication acceptance testで検出する。

通常の`hydrate` Islandでは、`src/islands/Counter.tsx`のようなSSR-safe component moduleをserver descriptorがimportして描画し、Viteも同じfilenameのdefault exportをlazy importする。これがserver/clientの初期DOMを揃える標準形である。moduleはserverで評価できる必要がある。

`mount`するclient-only Islandだけは、server-safeなdescriptor/fallback moduleとbrowser component moduleを分ける。server側がclient-only moduleをimportしてはいけない。

Vite integrationを使わない場合は、applicationがloader mapを明示する。

```ts
import { start } from "zogan/client";

start({
  islands: {
    Counter: () => import("./islands/Counter.tsx"),
  },
});
```

eager componentではなく、必ず `Promise<{ default: ComponentType }>` を返すloaderである。

Viteのvirtual moduleは自身で`start({ islands })`を呼び、返されたhandleを`runtime`としてexportする。同じrootを手書きの `start()`でも所有しない。互いに重ならないrootなら別runtime instanceを開始できる。

## 5.6 activationとmemoization

1. markerをscanし、nested Islandでないことを確認する。
2. IDに対応するloaderを探す。
3. triggerをscheduleする。
4. propsとmodeを検証する。
5. loaderを呼ぶ。
6. targetがまだ有効ならhydrateまたはmountする。

同じIDの進行中または成功済みloader Promiseはmemoizeする。module loadが失敗したPromiseはcacheから外し、後から現れる別instanceで再試行できる。

activate前にtargetがdisposeまたはdocumentから削除された場合は結果を適用しない。loader待機中にID、mode、trigger、raw propsのいずれかが変わった場合も、snapshot不一致として起動しない。Preact activationが同期的に失敗した場合は、事前にcloneしたserver childrenを復元する。

## 5.7 ownership rules

- Islandの中にIslandをnestしない。outer Preact rootがsubtreeを所有する。
- Islandの中に `FragmentSlot` を置かない。
- Fragment responseの中にIslandまたは別のFragmentを置かない。
- application componentが作るnestはserver renderで拒否し、raw/stale markupはclientでfail closedにする。

これらは「たまたま動くDOM」を許さず、subtree ownerを1つにするための制約である。

## 5.8 client-only boundary

top-level browser accessやbrowser専用dependencyのためSSRで安全に評価できないmoduleは、先頭の `'use client-only'` directive、または `zoganVite({ clientOnly: [...] })` の明示globで分類する。逆にserver secretやNode専用処理を持つmoduleは`'use server-only'`または`serverOnly` globで分類する。event handler内だけでbrowser APIを参照し、module評価とserver renderが安全な通常hydrate componentまでclient-onlyにする必要はない。

SSR buildからclient-onlyへ、client buildからserver-onlyへstatic/dynamic importerを逆向きに辿る。到達可能ならentryから対象moduleまでのpath全体を表示してbuildを失敗させる。directory名や特定API importを暗黙には分類しない。

Island用dynamic importはclient entryからだけ到達させる。server-reachable moduleにdynamic importを書いてもclient-only境界を越えたことになる。
