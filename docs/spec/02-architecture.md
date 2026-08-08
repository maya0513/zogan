# §2 全体構造

```
[Server: Hono]
  app.page('/products/:id', handler)   → 全 HTML または Partial
  app.fragment('cart-badge', handler)  → 独立エンドポイント (/_f/cart-badge)

[Client: 数百行のランタイム]
  リンククリック → fetch → Partial 差し替え → Store マージ → Island ハイドレート
```

**中核原則：Island は毎回作り直されてよい。状態は Island の外にある。**

この前提のおかげで差し替え実装が単純になる。DOM 保存方式（Turbo の `data-turbo-permanent` / htmx の `hx-preserve`）は主軸にしない（[§7.3](07-client-runtime.md) の逃げ道としてのみ用意）。

---

## 2.1 5 つの部品と責務

| 部品 | 生存期間 | 誰が作るか | 責務 |
|---|---|---|---|
| **Partial** | 1 回の差し替えまで | サーバ（SSR） | HTML のこの範囲を差し替え可能にする |
| **Fragment** | 独立したリクエスト | サーバ（別エンドポイント） | 殻と違うキャッシュ規則で中身を配る |
| **Island** | 差し替えのたびに作り直し | クライアント（ハイドレート） | 描画と対話。**状態を持たない** |
| **Store** | ページ遷移を跨いで生存 | クライアント（モジュール） | 共有状態を保持する唯一の場所 |
| **ランタイム** | タブが開いている間 | `zogan/client` | 上 4 つを繋ぐ |

責務の分離は、**生存期間が違うものを混ぜない**という一点に集約されます。

```
  タブが開いている間  ├──────────────────────────────────────┤  Store / ランタイム
  1 ページの表示中    ├──────────────┤├──────────────┤          Partial の中身
  差し替えのたびに    ├───┤├───┤├───┤├───┤├───┤├───┤          Island のインスタンス
```

Island が短命であることが前提なので、Island に状態を置くと遷移で消えます。これが [§6.2](06-island.md) の「Island は共有状態を持たない」の理由です。逆に Store は長命なので、サーバ確定値との整合を version で取る必要があります（[§5.1](05-store.md)）。

## 2.2 1 ページの構造

商品一覧ページを例に、どこがどの機構かを示します。

```html
<!-- ここから外側は「殻」。全ユーザ共通。CDN が s-maxage で保持する -->
<html>
<body data-client-nav>                          <!-- §7.1 ソフトナビ有効化 -->

  <header>
    <a href="/">ロゴ</a>

    <!-- 穴①：ユーザごとに違う → Fragment (private, no-store) -->
    <div data-island="CartBadge" data-fragment="/_f/cart-badge" data-trigger="load">
      <span>—</span>                          <!-- 取得までのプレースホルダ。§6.1.5 -->
    </div>
  </header>

  <!-- URL で決まる → Partial。ページと同じキャッシュキーに乗る -->
  <!--p:count-->1,284 件<!--/p:count-->

  <!--p:results-->
    <article>…</article>
    <article>…</article>
  <!--/p:results-->

  <!-- 穴②：TTL が短い → Fragment (public, s-maxage=30) -->
  <div data-island="Stock" data-fragment="/_f/stock/ABC-123" data-trigger="visible">
    <span>在庫を確認中</span>                <!-- 取得までのプレースホルダ -->
  </div>

  <!-- ★ ここに <script data-store> は置けない。この応答は CDN にキャッシュされる。
       共有確定値は穴①の応答（private, no-store）に載る。§5.5 -->

</body>
</html>
```

読み取ってほしいのは 3 点です。

1. **Partial にはラッパー要素がない。** コメントマーカーだけで範囲を示します。理由は [§3.3](03-partial.md)（CSS Grid / `<tbody>` / `<select>` が壊れる）。
2. **Fragment は「穴」であって、それ自体は HTML を持たない。** 殻の側にあるのはハイドレート先のプレースホルダだけで、中身は別リクエストで届きます。
3. **この HTML のどこにも Store の snapshot がない。** 殻はキャッシュされるので、載せると他ユーザに配られます（[§5.5](05-store.md)）。snapshot は穴①の応答（`private, no-store`）に入って届きます。

## 2.3 4 つのライフサイクル

zogan には 4 種類のリクエスト経路しかありません。実装はこの 4 つを満たせば足ります。

### (a) 初回のフルロード

```
ブラウザ ──── GET /products ──────────────────► Hono
                                                 │ app.page ハンドラ実行
                                                 │ Partial マーカー付きで SSR
         ◄─── 200 text/html (殻ぜんぶ) ─────────┘
   │
   ├─ HTML をパース、CSS 適用 → ここで LCP が確定（Island 待ちではない）
   ├─ zogan/client 起動
   ├─ [data-store] を集めて Store の base に投入        ← §5.2
   │    ※ キャッシュされるページには snapshot が無い（§5.5）。
   │      ここは空振りし、base は下の Fragment 応答から入る
   └─ [data-island] を trigger に従ってハイドレート     ← §6.1
        └─ CartBadge が load trigger → GET /_f/cart-badge
             └─ 応答の snapshot を base に投入 → 中身を描画
```

**SSR 済みの HTML がそのまま見える状態で LCP が確定する**ことが要点です。Island のハイドレートは後追いで構いません（[§6.1](06-island.md)）。

**カートの確定値は殻ではなく Fragment の応答で届きます**（[§5.5](05-store.md)）。キャッシュ不能なページ（カートページ等）では殻にも載るので、`[data-store]` の走査は両方の経路のために必要です。

### (b) ソフトナビゲーション（Partial 差し替え）

```
クリック ─┬─ data-client-nav が truthy か祖先を遡って確認  ← §7.1
          │    無効なら何もしない（通常遷移に任せる）
          │
          └─ fetch(url, { headers: { 'X-Partial': 'results,count' } })
                                                 │
                                                 │ 同じハンドラを再実行
                                                 │ 指定領域だけを返す
             ◄─── 200 + X-Partial: results,count ┘
   │
   ├─ 1. パース
   ├─ 2. マーカー範囲を差し替え（mode に従う）        ← §3.4
   ├─ 3. ★ 挿入範囲内の [data-store] を version マージ ← §5.2
   ├─ 4. ★ Island をハイドレート                      ← §6.1
   └─ 5. pushState / focus / スクロール
```

**3 が 4 より先であることは必須**です。逆順だと Island が古い値で一度描画されてから正しい値に飛びます。

上の番号はこの図の中だけの略号です。**実装が従う正の順序は [§7.2](07-client-runtime.md) の 12 ステップ**で、ここでの 3・4 はそれぞれステップ 8・9 にあたります。

Fragment はこの経路に登場しません。**ソフトナビゲーションは Fragment を自動再取得しない**のが既定です。例外は [§8](08-edge-cases.md) の 2 ケース（チェックアウト遷移・`pageshow`）のみで、これは明示的に取得します。

### (c) Fragment の取得

```
Island のハイドレート ── GET /_f/cart-badge ────► Hono
   または明示的な refresh()                        │ Cookie からカートを読む   ← §4.3
                                                   │ Cache-Control を自分で設定
             ◄─── 200 + private, no-store ─────────┘
   │
   └─ 応答 HTML を Island の中身として差し込み、[data-store] があればマージ
```

Fragment のリクエストは**殻のキャッシュとは完全に独立**です。CDN から見ると `/products` と `/_f/cart-badge` は無関係な 2 つの URL で、前者だけがキャッシュされます。これが zogan の存在意義そのものです（[§4.1](04-fragment.md)）。

### (d) フォーム送信

**`data-partial` または `data-fragment` を持つフォームだけ**が傍受されます（[§7.1.3](07-client-runtime.md)）。どちらも無ければブラウザの通常送信で、この経路に入りません。

```
submit ─┬─ data-partial / data-fragment のどちらも無い → 何もしない
        │
        └─ fetch(action, { method, body })
                                                 │
                                                 │ 通常のハンドラ（app.page とは限らない）
              ◄─── 200 + Cache-Control: no-store ┘
   │
   ├─ 1. 応答本文の [data-store] を version マージ     ← §5.2.3
   ├─ 2. data-partial があれば → (b) の差し替えを行う
   └─ 3. data-fragment があれば → その Fragment を取り直す（§7.1.4）
```

**この経路の応答は `private, no-store` です。** カート更新の結果を snapshot で返すため（[§5.5](05-store.md)）、そもそもキャッシュできません。

(b) との違いは 3 点です。

| | (b) ソフトナビゲーション | (d) フォーム送信 |
|---|---|---|
| 起点 | `<a>` のクリック | `<form>` の submit |
| オプトイン | 祖先の `data-client-nav` | **要素自身の `data-partial` / `data-fragment`**（祖先を継承しない） |
| Fragment | 自動再取得しない | **`data-fragment` があれば取り直す** |

処理の正の順序は [§7.2](07-client-runtime.md) にあります。

## 2.4 状態がどこにあるか

差し替えで消えるもの・消えないものを一覧にします。**バグの大半はこの表の読み違いから出ます。**

| 置き場所 | 差し替えで | 遷移で | フルリロードで | 用途 |
|---|---|---|---|---|
| Island の `useSignal` | 消える | 消える | 消える | 開閉、ホバー、入力中の検索語 |
| `data-props` | 上書き | 上書き | 再生成 | その Island の入力 |
| Store の `base` | 残る（version 比較でのみ更新） | 残る | snapshot から再構築 | カート、ログイン状態 |
| Store の `pending` | 残る | 残る | 消える | 楽観差分 |
| `data-preserve` の DOM | 移送される | 移送される | 消える | 動画・iframe・入力途中のフォーム |

`base` と `pending` を分けている理由は [§5.1](05-store.md) にあります。要点だけ言うと、**サーバが拒否した場合の巻き戻しが「pending を消す」だけで済む**からです。エラー処理が特別扱いになりません。

## 2.5 既存実装との対応

zogan は新しい概念を含みません。各部品がどこから来ているかを明示しておきます。詳細は [§12](12-references.md)。

| 部品 | 最も近い既存実装 | 差分 |
|---|---|---|
| `<Partial>` / mode / key | **Fresh の `<Partial>`** | 取得方式のみ差分（[§3.2](03-partial.md)） |
| `data-client-nav` オプトイン | **Fresh の `f-client-nav`** | 属性名のみ |
| `X-Partial` ヘッダでの部分取得 | **Turbo の `Turbo-Frame` ヘッダ** | 複数領域を同時指定できる点が差分 |
| Fragment（キャッシュの穴） | **Astro の server islands** | props を渡さないので暗号化が不要（[§4.3](04-fragment.md)） |
| Island の trigger 名 | **Astro の `client:*`** | 名前をそのまま採用 |
| コメントマーカー | **mizchi/sol** | — |
| `data-preserve` | **Turbo `data-turbo-permanent` / htmx `hx-preserve`** | 逃げ道に限定 |

**独自なのは 1 点だけ**です。[§5](05-store.md) の base + pending 二層と、それをビルド時に client-only 強制する仕組み（[§5.3](05-store.md)）。既存フレームワークはどれもこれを明示的に守ってくれません。

それ以外で既存実装と違うことをしている箇所を見つけたら、**理由が書かれているか確認してください。書かれていなければ、既存実装に寄せるのが正しい**。
