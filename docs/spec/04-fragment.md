# §4 Fragment

## 4.1 役割

Fragmentは、page shellの明示的な穴を同一originのGET HTMLで一度だけ埋めるread-only includeである。navigation、mutation、application state同期、polling、OOB updateには使わない。

```tsx
<FragmentSlot as="span" src="/fragments/cart-badge" trigger="load">
  <a href="/cart">Cart —</a>
</FragmentSlot>
```

server fallbackはJavaScriptなし、通信失敗、protocol不一致でも残る有用なHTMLにする。

## 4.2 URLとresponse

`src`はroot-relative、same-origin、hashなしのURLである。scheme-relative URL、backslash、CR/LF、decode後のdot segmentを拒否する。Page URLとFragment URLは分け、request headerで同じURLの表現を切り替えない。

Fragment endpointは通常のHono GET routeで、`zogan.fragment(c, vnode, { cache })`から`text/html`を返す。response bodyはwrapperのinner HTMLだけであり、doctype、`html`、`head`、外側のslotを含めない。

## 4.3 trigger

```ts
type FragmentTrigger = "load" | "idle" | "visible" | `media:${string}`;
```

既定は`load`。triggerは一度だけ発火する。imperative refresh、manual trigger、自動retry、pollingは提供しない。

## 4.4 browser runtime

Fragmentを使うapplicationだけが別entryを起動する。

```ts
import { startFragments } from "zogan/fragments";

const runtime = startFragments({ root: document.documentElement });
// lifecycle終了時
runtime.dispose();
```

`zogan/client`のIsland runtimeはFragmentをscanまたはfetchしない。`zogan/fragments`もIslandを起動しない。

同じ正規化URLの同時fetchだけを共有し、結果は永続cacheしない。redirect、非2xx、HTML以外、network error、古いresponse、marker drift、削除済みtargetではDOMを変更しない。disposeはpending triggerをcancelし、置換済みslotを最初のserver fallbackへ戻す。

## 4.5 ownership

Fragment responseは`FragmentSlot`または`Island` markerを含められない。applicationがFragment response内に境界componentをrenderするとserverで例外にし、staleまたは改変response内のmarkerはclientで拒否する。

FragmentSlotをIsland内または別FragmentSlot内へnestできない。application生成のnestはserver renderで例外、raw/stale DOMのnestはclientでfallback維持となる。wrapperはserver/DOMが所有し、runtimeが置換するのはchildrenだけである。

この制約により、Fragmentはcomponent tree、複数領域transaction、application invalidation graphを持たない。

## 4.6 contextual parsing

`FragmentElement`は子を安全に置換できるHTML containerの閉じた集合である。table/select系は専用context wrapperでparseする。document root、void、raw-text、template、embedded content、SVG、MathML、custom elementは対象外である。

## 4.7 cacheとno-JS

すべてのFragment responseに`CachePolicy`が必須である。ユーザ固有HTMLは通常`privateNoStore({ vary: ["Cookie"] })`を使う。

public shell上のprivate FragmentはJavaScriptなしではfallbackのままである。したがって保証は「page、link、form、mutationの正本が動く」であり、遅延した個人化や鮮度がJavaScriptなしでも同一になるという保証ではない。
