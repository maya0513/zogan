# Appendix B: Markup and HTTP contract

## B.1 FragmentSlot marker

serverは次を出力する。

```html
<div
  data-zogan-fragment="/fragments/cart-badge"
  data-zogan-protocol="1"
  data-zogan-trigger="load"
>
  <a href="/cart">Cart unavailable</a>
</div>
```

| Attribute | Server output | Client interpretation |
|---|---|---|
| `data-zogan-fragment` | 必須。検証済み`src`をそのまま格納 | root-relative、same-origin、hashなしの取得URL。値は空にできない |
| `data-zogan-protocol` | 必須。`1` | 欠落・不一致では取得しない |
| `data-zogan-trigger` | 必須。省略propなら`load`を出力 | 欠落・不正値では取得しない。`load`、`idle`、`visible`、空でない`media:<query>` |

Fragment wrapper上で許される`data-zogan-*`は、この3属性だけである。他の予約attributeが1つでもあればfetch前およびasync適用前に拒否する。

`src`は`/`から始まり、`//`、hash、backslash、CR/LF、decode後の`.`/`..` path segment、pathnameの不正percent encodingを含めない。queryは許可する。

wrapperのtagは`as`で選び、既定値は`div`である。許可される`FragmentElement`は次のとおり。

```text
a abbr address article aside b bdi bdo blockquote button caption cite code
colgroup data datalist dd del details dfn dialog div dl dt em fieldset
figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup i ins kbd
label legend li main mark menu meter nav ol optgroup output p pre progress q
rp rt ruby s samp search section select small span strong sub summary sup
table tbody td tfoot th thead time tr u ul var
```

document root、void/raw-text element、`template`、`slot`、embedded content、SVG/MathML、`option`などは許可しない。型で通常利用を拒否し、型を迂回した値やraw markerもruntimeで拒否する。`data-zogan-*`は予約済みで、component propから上書きできない。allowlistはwrapperごとのHTML content modelまで検証しないため、endpointはそのcontainerに妥当なchildrenを返す。

## B.2 Island marker

hydrate descriptor:

```html
<div
  data-zogan-island="Counter"
  data-zogan-mode="hydrate"
  data-zogan-protocol="1"
  data-zogan-trigger="visible"
  data-zogan-props="{&quot;initial&quot;:1}"
>
  <button>Count 1</button>
</div>
```

client-only descriptor:

```html
<div
  data-zogan-island="CheckoutWidget"
  data-zogan-mode="mount"
  data-zogan-protocol="1"
  data-zogan-trigger="idle"
  data-zogan-props="{&quot;cartId&quot;:&quot;c_123&quot;}"
>
  <a href="/checkout">Continue to checkout</a>
</div>
```

| Attribute | Server output | Client interpretation |
|---|---|---|
| `data-zogan-island` | 必須。descriptor ID | lazy loader mapのexact key |
| `data-zogan-mode` | 必須。`hydrate`または`mount` | 欠落・不正値では起動しない |
| `data-zogan-protocol` | 必須。`1` | 欠落・不一致では起動しない |
| `data-zogan-trigger` | 必須。省略propなら`load`を出力 | 欠落・不正値では起動しない。`load`、`idle`、`visible`、空でない`media:<query>` |
| `data-zogan-props` | 必須。strict JSON object | 欠落、不正JSON、array/scalar、nested非finite値なら起動しない |

Island wrapper上で許される`data-zogan-*`は、この5属性だけである。他の予約attributeが1つでもあればloader lookup前およびasync activate前に拒否する。

server descriptor ID、Viteのfilename stem、client marker IDは`^[A-Za-z][A-Za-z0-9_]{0,63}$`に一致する。clientは不正IDをloader lookup前に拒否するため、不正keyのloaderが登録されていても呼ばない。Vite利用時は`islandsDir`直下の`<ID>.tsx` stemがdescriptorと同じIDであり、moduleのdefault exportがclient componentである。serverはpropsをplain JSON objectとして再帰検証し、finite number、dense array、plain enumerable data propertyだけを許可する。clientもparse後の全nested valueがfinite JSONであることを再帰検証する。

Island ownerのelementは常にHTML `div`である。clientはlocal nameをloader前に検証し、raw `span` / `template`、SVG/MathML等にIsland markerがあっても起動しない。

`hydrate`はserver componentとclient default componentが同じpropsで同じ初期DOMを作ることを要求する。`mount`はfallback childrenを除去してからclient componentをrenderする。どちらもloader待機後にID、mode、trigger、raw propsのsnapshotをexact再検査し、変更済みなら起動しない。activation直前にchildrenをcloneし、loader/activation失敗時はそのSSR/fallbackを維持または復元する。

## B.3 HTTP exchange

Fragment requestは次に固定する。

| Field | Value |
|---|---|
| method | `GET` |
| URL | markerのsame-origin root-relative URL |
| `Accept` | `text/html` |
| credentials | `same-origin` |
| redirect | `manual` |

成功条件はmanual redirectでなく、`Response.ok`がtrueで、`Content-Type`のmedia typeが`text/html`であること。parameter付きmedia typeは許容する。失敗時にpage navigation、retry、fallback削除は行わない。

bodyはwrapperへ挿入するinner HTMLだけで、完全document、`html` / `head`、外側wrapper、予約済み`data-zogan-*`属性を含めない。`script`の実行はcontract外であり、`script` / `style`のasset declarationも返さない。CSSはpage shell、対話module固有assetはIsland chunkから供給する。

serverの`page()`と`fragment()`はいずれも次を設定する。

```http
Content-Type: text/html; charset=utf-8
Cache-Control: <explicit CachePolicy>
```

policyに`vary`がある場合、既存`Vary`へcase-insensitiveに重複排除して追加する。既存status、その他のheaderは維持する。page/fragment判定は別routeと別render helperで行い、同じURLのrequest-dependent negotiationにはしない。

## B.4 replacement algorithm

1. 一度だけのtrigger発火が、他のFragmentまたはIslandに所有されない対象slotを選ぶ。
2. URLを再検証し、同じabsolute URLのin-flight requestだけを共有する。
3. response guard通過後、接続・runtime token・src/trigger/protocol snapshot・reserved attributes・ownerを再検査し、wrapper tagに応じたHTML contextでnodeをparseする。
4. response内に予約済み`data-zogan-*`属性がないことを検証する。
5. wrapper element自体を残し、childrenだけを置換する。挿入nodeは再scanしない。

`table`/`tbody`/`thead`/`tfoot`/`tr`/`td`/`th`/`colgroup`/`caption`と`select`/`optgroup`は専用contextでparseする。汎用`div`経由で構造を変形させない。

browser runtimeではFragmentとIslandを相互にも同種同士にもnestできない。同じelementへFragment markerとIsland markerの両方を付けたraw markupはmalformedであり、両runtimeが拒否する。wrapperそのものはserver/DOMが所有し、置換対象はchildrenだけである。

Island内部またはFragment response内でapplication componentが作るnestはserver renderで拒否する。通常Page上のFragmentSlot childrenはserver側のowner scopeではないためnestを描画できるが、clientはnested ownerとして拒否する。raw/stale DOMのnestと、予約済み`data-zogan-*`属性を含むFragment responseもclientで拒否する。same-src siblingは同じ進行中requestを共有する。

## B.5 protocol evolution

markerには`data-zogan-protocol="1"`が必須である。runtimeは交渉せずexact versionだけを受理する。attribute名、value vocabulary、ID、props schema、URLを非互換変更するときは、古いpage cacheと古いassetが残る期間を考慮する。

boundaryごとのreserved-attribute allowlistはexactである。新しい`data-zogan-*`を追加することもbreaking protocol changeで、古いclientはそのboundaryをfail-closedにする。

- 同じIsland IDのprops schemaを変えず、必要なら新IDを発行する。
- cached pageが参照するFragment endpointをTTL中残すか、URLをversion化する。
- content-hash chunkを猶予期間保持する。
- pageとclient entryを同じrelease unitで配信する。
- unknown/malformed markerをfail-closedにし、SSR/fallbackを残す。

このguardrailはversion skewを消さない。失敗範囲を局所化し、古い表現を安全に表示し続けるための最低条件である。
