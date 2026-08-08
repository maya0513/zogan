# §4 Fragment（キャッシュの穴）

## 4.1 使い分け

| 状況 | 機構 | キャッシュ |
|---|---|---|
| URL が変わると中身が変わる（検索結果、ページャ、パンくず） | **Partial** | ページと同じキー。CDN で効く |
| ユーザごとに変わる（カート数、ログイン名、会員価格） | **Fragment** | `private, no-store` |
| 全員同じだが TTL が短い（在庫、ランキング、セール残時間） | **Fragment** | `public, s-maxage=N` |

Fragment の存在意義は**「外の殻を CDN キャッシュ可能にすること」**。穴を開けるために作る。ライブラリ名 zogan はこの一点に由来する。

### 4.1.1 なぜ穴を開けるのか

商品ページに「カート数：3」が直接書かれていると、そのページは特定ユーザ専用になります。CDN はキャッシュできません。ページ全体の HTML — 商品説明、画像タグ、レビュー、関連商品 — が、たった 1 つの数字のためにオリジンから毎回配信されます。

```
穴を開けない場合:
  GET /products/ABC-123  →  private, no-store  →  毎回オリジン
                             ページ全体（40KB）が CDN を素通り

穴を開けた場合:
  GET /products/ABC-123  →  public, s-maxage=300  →  CDN ヒット
  GET /_f/cart-badge     →  private, no-store     →  オリジン（200B）
```

**キャッシュ不能な領域を最小の独立 URL に切り出す**。これがドーナツキャッシュであり、zogan の全体です。

### 4.1.2 判断フロー

```
その領域の中身は URL だけで決まるか？
  │
  ├─ YES → Partial。殻の一部として同じキャッシュキーに乗せる
  │
  └─ NO ─ 何に依存する？
            │
            ├─ Cookie / セッション  → Fragment: private, no-store
            │                          （+ Vary: Cookie）
            │
            └─ 時間（在庫、順位）    → Fragment: public, s-maxage=N
```

**迷ったら Partial を選ぶこと。** Fragment は追加のリクエストを発生させます。穴は少ないほどよい。

### 4.1.3 穴を開けすぎない

Fragment 1 つにつきリクエストが 1 本増えます。ヘッダに 5 つの穴があれば、初回表示で 5 本の追加リクエストが飛びます。

規則：

- **同じキャッシュ規則・同じ依存を持つ領域は 1 つの Fragment にまとめる。** カート数とログイン名は両方とも「Cookie 依存 / no-store」なので、`/_f/cart-badge` と `/_f/user-name` に分けず `/_f/header-user` 1 本にする
- 1 ページあたりの Fragment は**目安として 3 本以内**。超えるなら殻の切り方を疑う
- `visible` trigger（[§6.1](06-island.md)）を使えば、画面外の Fragment は初回リクエストに含まれない

---

## 4.2 宣言

```ts
app.fragment('cart-badge', (c) => {
  const cart = getCartFromSession(c)          // Cookie から読む
  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Cookie')
  return c.html(
    <>
      <StoreSnapshot name="cart" data={cart} />      {/* §5.5 */}
      <CartBadgeView count={cart.count} />           {/* props で受ける */}
    </>
  )
})

app.fragment('stock/:sku', (c) => {
  c.header('Cache-Control', 'public, s-maxage=30')
  return c.html(<Stock sku={c.req.param('sku')} />)
})
```

エンドポイント：`GET /_f/cart-badge`、`GET /_f/stock/ABC-123`

名前に含めた `:sku` はそのまま Hono のパスパラメータになります。**ルーティングは Hono のものをそのまま使う**（[§1](01-scope.md)）ので、zogan 側にルート解決の実装はありません。

> **Fragment ハンドラの中で Store を読むコンポーネントを使わないこと。**
>
> ハンドラはサーババンドルに入るので、そこから Store へ到達すると [§5.3.2](05-store.md) の検証で落ちます。`CartBadgeView` のように **props で値を受ける表示専用のコンポーネント**を使ってください。同じ見た目をクライアントで担うのは `CartBadge` Island（[§6.2](06-island.md)）で、こちらは `cart.value` を読みます。**2 つは別のコンポーネントで、同じ HTML を出す必要があります**（[§6.1.5](06-island.md)）。

型シグネチャは [付録 A](appendix-a-api.md) を参照。

### 4.2.1 応答の規則

| 項目 | 規則 |
|---|---|
| メソッド | `GET` のみ登録される。副作用のある操作を Fragment にしない |
| `Content-Type` | `text/html; charset=utf-8` |
| body | **HTML 断片。`<html>` / `<body>` / レイアウトを含めない** |
| `Cache-Control` | **ハンドラが必ず明示する。** 既定値に頼らない |
| `Vary` | Cookie を読むなら `Vary: Cookie` を必ず付ける |
| ステータス | 正常時 `200`。失敗時は 4xx / 5xx をそのまま返す |

`Cache-Control` を必須にしているのは、**書き忘れたときの既定値が事故に直結する**からです。フレームワークが `no-store` を既定にすれば安全側ですが、「public にするつもりが書き忘れて全部オリジンに来る」という性能事故が起きます。逆に `public` を既定にすればカート数が他人に配られます。**どちらも既定にできないので、明示を強制します。** 未指定なら開発ビルドで例外、本番ビルドでは `private, no-store` にフォールバックしつつ警告を出すこと。

`Vary: Cookie` も同様に重要です。`private, no-store` であっても、経路上のプロキシや将来の設定変更に対する二重の防御になります。**Cookie を読む Fragment には機械的に付けること。**

### 4.2.2 Fragment は Partial を含まない

Fragment の応答に `<!--p:name-->` マーカーを出力しないこと。Fragment は独立エンドポイントであり、差し替えの単位ではありません。両者を混ぜると「Fragment の中の Partial を差し替える」経路が生まれ、キャッシュ規則が交差します。

Fragment の中身を更新したいなら、**その Fragment をもう一度取得する**のが唯一の方法です。

### 4.2.3 レイアウトを適用しない

`app.page` はレイアウト（`c.render`）を通しますが、`app.fragment` は通しません。Fresh の `skipAppWrapper` に相当する挙動が、**Fragment では常に有効**だと考えてください。

---

## 4.3 【不変条件】Fragment 引数は URL 由来の ID のみ

**渡してよい**：`sku`, `page`, `categoryId`, `sort` — URL から導出でき、公開されている値

**渡してはならない**：`userId`, `price`, `memberRank`, `discount` — ユーザ固有・秘密・改ざんされると損害が出る値。これらは**ハンドラ内で Cookie から読む**。

この制約により：

- props の暗号化が不要になる（Astro の server islands は props を暗号化して送る必要がある）
- 価格・在庫の改ざんが**原理的に**不可能になる（渡していないものは改ざんできない）
- 識別子がそのまま素直なキャッシュキーになる

**識別子はキャッシュキーである。ゆえに秘密を含めてはならない。** 本仕様の中核的な安全性の根拠。実装時に例外を作らないこと。

### 4.3.1 判定基準

引数に含めてよいかは、次の 2 問を**両方**通ることで判定します。

> **問 1：その値を URL に書いて、ブラウザのアドレスバーに表示されても問題ないか？**
> **問 2：悪意あるユーザがその値を任意に書き換えて送ってきても、サーバの出力が正しいままか？**

| 値 | 問 1 | 問 2 | 判定 |
|---|---|---|---|
| `sku=ABC-123` | ○ 公開情報 | ○ 存在しなければ 404 | **可** |
| `page=3` | ○ | ○ 範囲外なら空 | **可** |
| `sort=price_asc` | ○ | ○ 未知の値は既定にフォールバック | **可** |
| `categoryId=42` | ○ | ○ | **可** |
| `userId=1234` | ✗ 他人の ID が URL に出る | ✗ 書き換えれば他人のカートが見える | **不可** |
| `price=980` | ○ 公開 | ✗ 書き換えれば 980 円で買える | **不可** |
| `memberRank=gold` | ✗ | ✗ 昇格し放題 | **不可** |
| `cartToken=...` | ✗ 秘密が CDN のキャッシュキーに載る | ✗ | **不可** |

問 2 が通らない値は、**Cookie から読むこと自体が正しい設計**です。サーバは既にセッションを持っているのだから、クライアントに往復させる理由がありません。

### 4.3.2 なぜ暗号化ではなくこの制約なのか

Astro の server islands は props を暗号化して送ります。動きますが、代償があります。

| 方式 | 鍵管理 | キャッシュキー | 改ざん耐性 | 実装量 |
|---|---|---|---|---|
| props を暗号化して送る | **必要**（ローテーション、複数インスタンス間の共有） | 暗号文なので実質一意 = **キャッシュが効かない** | 鍵が漏れたら破綻 | 大きい |
| **URL 由来 ID のみ（zogan）** | 不要 | `/_f/stock/ABC-123` = **素直に共有される** | **原理的に改ざん不能** | ゼロ |

キャッシュの列が決定的です。**穴を開ける目的はキャッシュなのに、暗号化した props をキーに含めると穴の側がキャッシュできなくなります。** 目的と手段が衝突しているので、zogan はこの方式を採りません。

「原理的に改ざん不能」の意味は単純です。**渡していないものは改ざんできない。** 検証コードもテストも要りません。

### 4.3.3 実装上の強制

不変条件は「気をつける」では守れません。次を機械的に行うこと。

1. **`app.fragment` のハンドラに props を渡す API を作らない。** 引数は `Context` のみ。渡す口が無ければ違反しようがない
2. Fragment 名のパスパラメータは Hono のルート定義に現れるので、**レビューで目視確認できる**（`stock/:sku` は見れば分かる）
3. クライアント側の Fragment 取得 API（`refresh()` 等）に、任意のクエリを付ける引数を用意しない

3 番目が抜け穴になりやすい箇所です。`refresh('/_f/price?rank=gold')` のような呼び出しを許すと、URL 経由で不変条件を破れます。**クライアントから Fragment を取得するときの URL は、SSR 済みの HTML に書かれたものだけを使う**こと。

これを構造的に保証するのが `data-fragment` 属性です（[§6.1.5](06-island.md)）。Island の Fragment 取得先はサーバが SSR 時に書き、ランタイムはそれを読むだけで組み立てません。**`data-fragment` を JS から書き換える API を作らないこと。**

---

## 4.4 キャッシュ設定の実例

EC でよく出る領域の設定値。**そのまま使える初期値**として置いておきます。

| 領域 | 機構 | `Cache-Control` | `Vary` | snapshot | 備考 |
|---|---|---|---|---|---|
| 商品ページの殻 | `app.page` | `public, s-maxage=300, stale-while-revalidate=60` | `X-Partial` | ✗ | 在庫と価格を殻に書かないこと |
| 検索結果 | `app.page` + Partial | `public, s-maxage=60` | `X-Partial` | ✗ | URL で一意に決まる |
| カートページ | `app.page` | `private, no-store` | `X-Partial`, `Cookie` | ○ | ページ本体がカートの権威 |
| カート数・ログイン名 | Fragment | `private, no-store` | `Cookie` | ○ | 例外なく no-store |
| 会員価格 | Fragment | `private, no-store` | `Cookie` | ○ | rank は Cookie から読む（§4.3） |
| 在庫数 | Fragment | `public, s-maxage=30` | — | ✗ | sku は URL 由来なので可 |
| ランキング | Fragment | `public, s-maxage=300` | — | ✗ | 全員同じ |
| セール残時間 | Fragment | `public, s-maxage=10` | — | ✗ | 短い TTL で足りる。WebSocket は要らない |

`Vary` の列は [§3.2.4](03-partial.md) の規則によります。**`app.page` の応答は部分応答・フルページ応答のどちらも `Vary: X-Partial` を持ちます。** 片方だけに付けると CDN のエントリが分割されません。

snapshot の列は [§5.5](05-store.md) の不変条件によります。**`Cache-Control` に `no-store` が無い行には、共有確定値を載せられません。**

### 4.4.1 2 つの運用規則

**1. 殻に在庫と価格を書かない。** `s-maxage=300` の殻に在庫「残り 3 点」を書くと、最大 5 分間ずれた在庫が配信されます。

**2. 殻に snapshot を書かない。** ずれるだけでは済まず、**他ユーザの確定値が配信されます**（[§5.5](05-store.md)）。1 は精度の問題ですが、2 は情報漏洩です。

どちらも「キャッシュされる応答に、キャッシュしてよくないものを書いた」という同じ誤りです。**`Cache-Control` を書く前に、その応答の中身が全ユーザ共通かを確認してください。**
