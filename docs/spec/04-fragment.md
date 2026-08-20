# §4 Fragment

## 4.1 明示的なremote include

Fragmentは、同一originの独立URLからHTMLをGETし、`FragmentSlot` wrapperのchildrenだけを置換する機構である。

```tsx
<FragmentSlot as="span" src="/fragments/cart-badge" trigger="load">
  <a href="/cart">Cart —</a>
</FragmentSlot>
```

```tsx
app.get("/fragments/cart-badge", (c) =>
  zogan.fragment(c, <CartBadge user={userFromCookie(c)} />, {
    cache: privateNoStore({ vary: ["Cookie"] }),
  }),
);
```

これは汎用includeでも、任意originのHTML loaderでもない。slot自身がURL、trigger、fallback、置換先を宣言し、endpointは通常のHono routeとして見える。

## 4.2 `src` 契約

`src` はqueryを含められるroot-relative pathで、server生成時とclient取得時に検証する。

- 空でない
- `/` で始まり、`//` では始まらない
- literalな `#`、backslash、CR、LFを含まない
- pathnameが正しくpercent decodeできる
- decode後のpathnameにbackslashを含まない
- decode後のpath segmentに `.` または `..` がない
- browser側で現在のoriginと一致し、protocolがHTTP(S)である

許可例は `/fragments/stock/ABC-1`、`/fragments/search?q=book`。absolute URL、protocol-relative URL、fragment identifier付きURLは拒否する。

URLとqueryはbrowser、log、cacheに見える。secretや巨大なserialized component propsを入れない。endpoint handlerはCookie、session、path parameterから必要なdataを読み直す。

## 4.3 trigger

```ts
type FragmentTrigger =
  | "load"
  | "idle"
  | "visible"
  | "manual"
  | `media:${string}`;
```

| 値 | 挙動 |
|---|---|
| `load` | scan時に直ちに取得を開始。既定値 |
| `idle` | `requestIdleCallback`、未対応なら短いtimerで1回起動 |
| `visible` | `IntersectionObserver`、`rootMargin: "200px"` で1回起動 |
| `media:QUERY` | `matchMedia(QUERY)` が一致した時点で1回起動 |
| `manual` | 自動取得せず、`refreshFragment(src)` だけで更新 |

`media:` のqueryはtrim後に空であってはならない。server componentはprop省略時も`load` markerを必ず出す。raw markerでtriggerが欠落または不正なら、clientは警告してfallbackを維持する。

## 4.4 wrapper element

`as` の既定値は `div`。型と実行時の両方で、children置換を明示的に対応したHTML containerだけを許可する。

```text
a abbr address article aside b bdi bdo blockquote button caption cite code
colgroup data datalist dd del details dfn dialog div dl dt em fieldset
figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup i ins kbd
label legend li main mark menu meter nav ol optgroup output p pre progress q
rp rt ruby s samp search section select small span strong sub summary sup
table tbody td tfoot th thead time tr u ul var
```

document root、void element、raw-text element、`template` / `slot`、embedded content、SVG/MathML、`option` は対象外。特に `svg`、`template`、`img`、`input`、`script`、`style`、`textarea` を型の迂回で渡してもserverは例外にする。clientも不正markerをfetch前に拒否する。

通常のintrinsic attributesはwrapperへforwardする。`data-zogan-*` は予約済みで、型と実行時の両方から上書きを拒否する。

Fragment wrapperで許される予約attributeは`data-zogan-fragment`と`data-zogan-trigger`だけである。raw wrapperにそれ以外の`data-zogan-*`が1つでもあれば、clientはfetch前とasync適用前の両方でfail-closedにする。

allowlistはparserがchildren置換を扱えることだけを示し、返却HTMLがwrapperのHTML content modelに適合することまでは検証しない。たとえば`a`の中へ別の`a`を返さない、といったsemantic validityはendpoint側の契約である。

## 4.5 request / response

browser requestは通常のGETである。

```text
URL         srcを現在のlocationに対して解決した同一origin URL
Accept      text/html
credentials same-origin
redirect    manual
```

responseは次をすべて満たす必要がある。

1. opaque/manual redirect、追跡済みredirect、3xxではない
2. `Response.ok` がtrue
3. `Content-Type` のmedia typeが大文字小文字を無視して `text/html`

charset等のmedia type parameterは許可する。失敗時はchildrenを変更しない。

`Zogan.fragment()` は `text/html; charset=utf-8`、明示したcache header、raw HTMLを返す。layoutとdoctypeは付けない。statusと既存headerはHono `Context` から維持する。

response bodyはslot wrapperへ入れるinner HTMLだけにする。完全document、`html` / `head`、外側の`FragmentSlot` wrapperを返さない。`script`はruntimeの実行contractに含まれず、`script` / `style`のasset declarationをFragmentへ混ぜない。必要なCSSはpage shell、対話module固有のassetはIsland chunk側で用意する。

## 4.6 置換

wrapper自身とそのattributesは保持し、response HTMLからparseしたnodesでchildrenだけを置換する。

- `table`、`caption`、`colgroup`、`thead`、`tbody`、`tfoot`、`tr`、`td`、`th` はtable contextでparseする。
- `select` と `optgroup` はselect contextでparseする。
- responseは複数root nodeを含められる。
- 取り除くsubtreeのpending Fragment triggerとIsland rootをdisposeする。
- 挿入した範囲だけをscanし、nested Fragmentを起動してIslandをhydrate/mountする。

Islandを含むFragmentは許可する。これによりendpointから返った新しい `data-zogan-props` を使って起動できる。反対に、Island内部の `FragmentSlot` は所有権が衝突するため拒否する。

Fragment include cycleも拒否する。targetの正規化済み`src`がancestor `FragmentSlot`のいずれかと一致すれば、scan/refreshともfetchしない。directなA→AとindirectなA→B→Aを止める一方、same-src siblingのfan-outと非循環A→Bは許可する。

## 4.7 concurrency

同じ正規化済みURLへの並行取得は、進行中のPromiseだけを共有する。response cacheは持たない。

- 同じURLを持つ複数slotは1 responseをfan-outする。
- 新しいgenerationだけがDOMへ適用できる。
- targetがdocumentから外れた、disposeされた、`data-zogan-fragment` / `data-zogan-trigger` が変わった、待機中にIsland subtreeへ移動した、またはsame-src ancestor配下へ移ってcycleになった場合は遅いresponseを無視する。
- network request自体はabortしない。

`refreshFragment(src)` は、document内でmarker値が文字列として完全一致し、Islandに所有されていないすべての対応slotを1回のresponseで更新する。Island subtreeのmarkerはmanual refreshでもskipする。targetがなければ警告して何もしない。

cycle判定は正規化URLで行うため、raw表記だけが異なる同一URLでもancestorと一致すれば対象から外す。

## 4.8 security boundary

Fragment HTMLはtrusted same-origin application outputでなければならない。zoganはHTMLをsanitizeしない。CSP、認可、CSRF、output escapingはapplicationとplatformの責務である。

same-origin検証は、悪意ある別originからのincludeを防ぐ境界であって、同一origin endpointの安全性を証明するものではない。
