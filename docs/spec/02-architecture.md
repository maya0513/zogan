# §2 全体構造

## 2.1 データフロー

```text
native page GET
    │
    ▼
Hono route ── Zogan.page() ──► complete HTML document
                                  │
                                  ├─ FragmentSlot: fallback + URL + trigger
                                  └─ Island: SSR/fallback + ID + props + trigger
                                                    │
                       explicit Island / Fragment runtimes scan their own markers
                                                    │
                         ┌──────────────────────────┴──────────────────────────┐
                         ▼                                                     ▼
              same-origin Fragment GET                              ID-specific lazy import
                         │                                                     │
                  Zogan.fragment()                                      hydrate / mount
                         │
                replace slot children once
```

page取得、Fragment取得、Island module loadは別の経路である。一方の失敗を、別の経路へ暗黙に昇格させない。

## 2.2 層ごとの責務

| 層 | 入力 | 出力 | 持たない責務 |
|---|---|---|---|
| Hono application | request、database、Cookie | routeごとのVNode | client lifecycle |
| `zogan` | `Context`、VNode、`CachePolicy` | HTML `Response` | route登録、data load |
| server component | typed props | fallback/SSR markup | browser module registry |
| `zogan/client` | Island marker、loader map | Island hydrate/mount | navigation、Fragment取得 |
| `zogan/fragments` | Fragment marker | 一回限りの局所HTML include | navigation、Island起動 |
| `zogan/vite` | module graph、island directory | lazy client entry、build診断 | runtime data |

## 2.3 1 URL 1表現

同じURLがrequestの付帯情報によって完全documentと埋め込みHTMLを切り替えてはならない。

- `/products/ABC-1` は常にpageである。
- `/fragments/stock/ABC-1` は常にFragmentである。
- `Zogan.page()` はlayoutとdoctypeを付ける。
- `Zogan.fragment()` はlayoutとdoctypeを付けない。

`createZogan({ layout })` のlayoutを省略した場合、`page()`へ渡すVNode自身が`html`を含む完全document rootを担う。zoganは`html`、`head`、`body`を暗黙には補わず、doctypeだけを前置する。

これにより、browser、CDN、crawler、JavaScriptなしのclientがURLの意味を共有できる。cache keyへ見えない表現分岐を持ち込まない。

## 2.4 shellとhole

共有cacheへ置くpage shellには、全閲覧者へ同じ内容だけを出す。Cookieやsessionで変わる領域は、別のFragment URLへ分け、fallbackには匿名表示または意味のあるplaceholderを置く。

```tsx
const zogan = createZogan({ layout: Layout });

app.get("/products", (c) =>
  zogan.page(
    c,
    <main>
      <h1>Products</h1>
      <FragmentSlot as="span" src="/fragments/cart-badge">
        <a href="/cart">Cart —</a>
      </FragmentSlot>
    </main>,
    { cache: publicCache({ sMaxAge: 60 }) },
  ),
);

app.get("/fragments/cart-badge", (c) =>
  zogan.fragment(c, <CartBadge user={userFromCookie(c)} />, {
    cache: privateNoStore({ vary: ["Cookie"] }),
  }),
);
```

`CachePolicy` は安全なデータ選択を代行しない。public policyとユーザ固有HTMLを組み合わせれば漏洩するため、application testで境界を検証する。

## 2.5 局所契約と残る時間契約

zoganの契約は局所だが、時間契約が消えるわけではない。

| 契約 | 局所化の方法 | 残る時間的リスク |
|---|---|---|
| page → Fragment | slot自身が取得URLを持つ | 古いpageが廃止済みendpointを指す |
| marker → runtime | `data-zogan-*` を固定する | 古いHTMLと新しいruntimeのschema差 |
| Island ID → module | descriptor IDとfilename stemを一致させる | 新deployでIDやprops schemaが変わる |
| response → DOM | wrapperを保持してchildrenだけ置換する | endpointのHTML content modelが変わる |

したがって「契約不要なHTML差し替え」ではない。契約面積を小さくし、fallbackとfail-closed検証で壊れ方を限定している。

## 2.6 version skewのguardrail

runtimeはmarker protocol version 1をexactに検証するが、version negotiationはしない。deployでは次を守る。

1. build assetはcontent hash付きで配信し、古いHTMLが参照するassetを直ちに消さない。
2. 既存Island IDのprops schemaを破壊的に変えない。変える場合は新しいIDとfilenameを使うか、関連page cacheを同時にpurgeする。
3. Fragment URLのresponse shapeを破壊的に変える場合はURLをversion化するか、参照pageの最大TTLが過ぎるまで旧shapeを提供する。
4. marker属性の意味を変えるdeployでは、page cache、client asset、server routeを同じrelease unitとして扱う。
5. rolling deploy中も、新旧双方のFragment endpointとIsland chunkを利用可能にする。

未知のIsland ID、壊れたprops、取得失敗はfallbackを残す。ただし同じIDに互換でないcomponentが読み込まれた場合をruntimeは検出できない。IDのversion化はapplication側の責務である。

## 2.7 逆戻りを防ぐ条件

次のいずれかを導入する変更は、このarchitectureからの逸脱として設計レビューを必須にする。

- page routeがrequestの隠れた条件で別の表現を返す
- runtimeがdocument全体のlink、form、historyを所有する
- Fragment URLをcomponentのopaqueなserialized inputから生成する
- server requestを跨ぐmutable application stateをlibrary registryへ置く
- Island componentを初期client entryへ静的importする
- marker不一致やnetwork failureでfallbackを消す
- unsupported DOM contextを検証なしで許す

これらを追加すると、局所的で見える契約が、clientとserverの強いpage-wide契約へ戻る。
