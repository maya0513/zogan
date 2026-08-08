# 付録 B：マークアップ契約

> **この付録は新しい設計判断を含みません。** 本編に散在する DOM 属性・マーカー・HTTP ヘッダの規則を 1 箇所に集めたものです。本編と矛盾する記述があれば**本編が正**です。

---

## B.1 `data-*` 属性 一覧

属性はすべて `data-*` 接頭辞で統一する（有効な HTML であること、Fresh の `f-` と混同されないこと）。[§0](00-glossary.md)

| 属性 | 付ける要素 | 値 | 既定 | 継承 | 参照 |
|---|---|---|---|---|---|
| `data-client-nav` | 任意（通常 `<body>`） | `""` / `"true"` / `"false"` | 無し = 無効 | **祖先から継承** | [§7.1.1](07-client-runtime.md) |
| `data-partial` | `<a>` / `<form>` | **Partial 領域名**のカンマ区切り | 無し = §7.2.3 の既定 | **継承しない** | [§7.1.3](07-client-runtime.md) |
| `data-island` | 任意の要素 | コンポーネント名 | — | — | [§6.1.1](06-island.md) |
| `data-props` | `[data-island]` | JSON オブジェクト（属性値エスケープ） | `{}` | — | [§6.1.1](06-island.md) |
| `data-trigger` | `[data-island]` | `load` / `idle` / `visible` / `media:(…)` / `none` | `load` | — | [§6.1.2](06-island.md) |
| `data-fragment` | `[data-island]` / `<form>` | **Fragment の取得先 URL**。Island は 1 つ、フォームはカンマ区切りで複数可 | 無し = 取得しない | **継承しない** | [§6.1.5](06-island.md) / [§7.1.3](07-client-runtime.md) |
| `data-store` | `<script type="application/json">` | Store 名 | — | — | [§5.2.1](05-store.md) |
| `data-preserve` | 任意の要素 | 一意な ID | — | — | [§7.3.4](07-client-runtime.md) |
| `data-view-transition` | `<a>` | 値なし | — | — | [§7.3.6](07-client-runtime.md) |

**継承の列が最も間違えやすい箇所です。** `data-client-nav` は祖先を遡って解決しますが、`data-partial` / `data-fragment` は要素自身にしか効きません。フォームが祖先の `data-client-nav` を継承しないのは、[§7.1](07-client-runtime.md) の「フォームは明示指定が無ければ傍受しない」という規則そのものです。

**`data-partial` と `data-fragment` は要素を問わず意味が一定です。** 前者は常に Partial 領域名、後者は常に Fragment の取得先 URL で、`<a>` / `<form>` / `[data-island]` のどこに書いても値の型は変わりません。両者は直交しており、フォームには併記できます（[§7.1.3](07-client-runtime.md)）。

### B.1.1 値の規則

識別子の規則は **2 種類だけ**です（[§5.2.1](05-store.md)）。

| 種類 | 正規表現 | 対象 | 理由 |
|---|---|---|---|
| 一般識別子 | `^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$` | Partial 名、`data-store` | HTML コメントの `-->` と紛れない |
| コンポーネント名 | `^[A-Za-z][A-Za-z0-9_]*$` | `data-island` | **JS の識別子として書ける**こと |

| 属性 | 正規表現 / 形式 | 検証時期 |
|---|---|---|
| `data-island` | `^[A-Za-z][A-Za-z0-9_]*$`（コンポーネント名） | ビルド時 |
| `data-store` | `^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$`（一般識別子） | ビルド時 |
| `data-trigger` | `^(load\|idle\|visible\|none\|media:.+)$` | ビルド時 |
| `data-fragment` | `fragmentPrefix` 配下の同一オリジン URL（Island は単一、フォームはカンマ区切り可） | 実行時 |
| `data-preserve` | 文書内で一意な文字列 | 実行時（重複は警告） |
| `data-props` | 有効な JSON オブジェクト | 実行時（破損は警告して継続） |
| `data-partial` | Partial 領域名のカンマ区切り（[§3.1.1](03-partial.md) の正規表現） | 実行時 |

### B.1.2 エスケープ規則

**2 種類あり、混同すると事故になります。**

| 埋め込み先 | 対象 | 規則 |
|---|---|---|
| `data-props`（HTML 属性値） | JSON 文字列 | **HTML 属性値としてエスケープ**（`&` → `&amp;`、`"` → `&quot;`、`'` → `&#39;`、`<` → `&lt;`） |
| `<script type="application/json">` | JSON 文字列 | **`<` → `\u003c` のみ。** それ以外の変換を行わない |

後者で HTML エスケープを行うと **JSON が壊れます**（`&quot;` は JSON のクォートではない）。前者で `<` だけをエスケープすると **属性が閉じられて XSS になります**。

```ts
// data-props 用
const attr = (data: unknown) =>
  JSON.stringify(data).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c])

// <script type="application/json"> 用（§5.2.1）
const json = (data: unknown) =>
  JSON.stringify(data).replaceAll('<', '\\u003c')
```

**どちらも [付録 A](appendix-a-api.md) のコンポーネント（`<Island>` / `<StoreSnapshot>`）に閉じ込めること。** 手書きしない。

---

## B.2 Partial マーカー

```html
<!--p:results-->
<article>…</article>
<!--/p:results-->
```

| 項目 | 規則 | 参照 |
|---|---|---|
| 開始 | `<!--p:NAME-->` | [§3.3](03-partial.md) |
| 終了 | `<!--/p:NAME-->` | 同 |
| `NAME` | `^[A-Za-z][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$`、64 文字以内 | [§3.1.1](03-partial.md) |
| 空白 | マーカー内に入れない（`<!-- p:x -->` は不正） | [§3.3.1](03-partial.md) |
| 親ノード | 開始と終了は**同じ親の直接の子** | 同 |
| 重複 | 1 文書内で同じ `NAME` を 2 回使わない | [§3.1.1](03-partial.md) |
| ネスト | 許可。同時要求時は**親のみ返す** | [§3.1.2](03-partial.md) |
| 差し替え時 | **マーカー自身は削除しない** | [§3.3.2](03-partial.md) |

`NAME` の正規表現が連続ハイフン（`--`）と末尾ハイフンを禁じているのは、**HTML コメントの終端 `-->` と紛れる形を作らないため**です。文字集合が固定されているので、マーカーにエスケープは不要です。

### B.2.1 配置可能な位置

コメントノードなので、**ラッパー要素が置けない場所にも置けます**。これがコメント方式を選んだ理由です（[§3.3.3](03-partial.md)）。

```html
<!-- CSS Grid の直接の子 -->
<div class="grid">
  <!--p:results--><article>…</article><!--/p:results-->
</div>

<!-- tbody の中 -->
<tbody>
  <!--p:rows--><tr>…</tr><!--/p:rows-->
</tbody>

<!-- select の中 -->
<select>
  <!--p:variants--><option>…</option><!--/p:variants-->
</select>
```

---

## B.3 HTTP ヘッダ 一覧

### B.3.1 Partial（ソフトナビゲーション）

**リクエスト**

| ヘッダ | 値 | 必須 |
|---|---|---|
| `X-Partial` | 領域名のカンマ区切り。空白は無視 | ○ |

**応答（200・部分応答）**

| ヘッダ | 値 | 必須 |
|---|---|---|
| `Content-Type` | `text/html; charset=utf-8` | ○ |
| `X-Partial` | **実際に返した領域**を宣言順で列挙 | ○ |
| `Cache-Control` | ハンドラが必ず明示（[§5.5](05-store.md)） | ○ |
| `Vary` | **`X-Partial` を含めること** | ○ |

**応答（200・フルページ応答）**

| ヘッダ | 値 | 必須 |
|---|---|---|
| `Content-Type` | `text/html; charset=utf-8` | ○ |
| `X-Partial` | 付けない | — |
| `Cache-Control` | ハンドラが必ず明示（[§5.5](05-store.md)） | ○ |
| `Vary` | **`X-Partial` を含めること** | ○ |

> **`Vary: X-Partial` は両方の応答に必要です。片方だけでは足りません。**
>
> | 抜けた側 | 何が起きるか | 気付けるか |
> |---|---|---|
> | 部分応答 | CDN が部分応答をページ本体としてキャッシュし、**全ユーザに `<html>` の無い壊れた HTML を配る** | 即座に分かる |
> | フルページ応答 | `X-Partial` 付きリクエストにフルページ版がヒット → 応答に `X-Partial` が無い → **ソフトナビゲーションが恒久的にフォールバックする** | **CDN が温まるまで分からない** |
>
> **`app.page` の全応答にミドルウェアで機械的に付けること。** ハンドラの責務にしない。
>
> 代償として**キャッシュエントリが分裂します**。ソフトナビゲーションはフルページ版のヒットを利用しません。ヒット率を保つには `X-Partial` の値をばらつかせないことが要点です（[§3.2.4](03-partial.md)）。

**応答（異常系）** — [§3.2.3](03-partial.md)

| 状況 | ステータス | ヘッダ |
|---|---|---|
| 一部だけ返せた | `200` | `X-Partial` に実際の内容 |
| 1 つも返せなかった | `200` | `X-Partial:`（空）→ クライアントはフォールバック |
| リダイレクト | `3xx` そのまま | `X-Partial` を付けない |
| エラー | `4xx` / `5xx` そのまま | `X-Partial` を付けない |

### B.3.2 Fragment

**応答**

| ヘッダ | 値 | 必須 |
|---|---|---|
| `Content-Type` | `text/html; charset=utf-8` | ○ |
| `Cache-Control` | **ハンドラが必ず明示** | ○ |
| `Vary` | Cookie を読むなら `Cookie` | Cookie 依存時は ○ |

設定値の実例は [§4.4](04-fragment.md) を参照。

### B.3.3 クライアント側の `fetch` オプション

| オプション | 値 | 理由 |
|---|---|---|
| `headers` | `{ 'X-Partial': … }` | [§3.2](03-partial.md) |
| `redirect` | **`'manual'`** | 追跡するとログイン画面を差し込む事故になる。判定は `res.type === 'opaqueredirect'`（`status` は `0` になり読めない）（[§8.4.3](08-edge-cases.md)） |
| `signal` | `AbortController` のもの | 連打・競合（[§7.3.2](07-client-runtime.md)） |
| `credentials` | `'same-origin'`（既定） | Fragment が Cookie を読むため |

---

## B.4 実装チェックリスト

マークアップ層の実装が終わったら、これを上から確認してください。

**サーバ側**

- [ ] `<Partial>` の `name` を正規表現で検証し、違反で例外を投げる
- [ ] 1 文書内の `name` 重複を検出して例外を投げる
- [ ] ネストした Partial が同時要求されたとき、親だけを返す
- [ ] 部分応答に `Vary: X-Partial` を**ミドルウェアで**付ける
- [ ] 応答ヘッダ `X-Partial` に**実際に返した領域**を列挙する
- [ ] リダイレクト・エラーを部分応答に変換していない
- [ ] `app.page` / `app.fragment` とも `Cache-Control` 未指定なら開発ビルドで例外
- [ ] Cookie を読む Fragment に `Vary: Cookie` を付ける
- [ ] **snapshot を含む応答が `no-store` であることをミドルウェアで照合**（[§5.5](05-store.md)）
- [ ] キャッシュ可能な `app.page` の応答に `<script data-store>` が 1 つも含まれない
- [ ] `<StoreSnapshot>` が `<` → `\u003c` のみ変換している
- [ ] `<Island>` の `data-props` が HTML 属性値としてエスケープされている
- [ ] Fragment 島の `data-fragment` を**サーバ側で**出力している（クライアントで組み立てていない）

**クライアント側**

- [ ] `data-client-nav` を祖先へ遡って解決している
- [ ] `data-partial` / `data-fragment` を継承させていない（フォームは自身の属性のみ）
- [ ] `data-partial` を領域名として、`data-fragment` を URL として扱っている（要素による分岐を書いていない）
- [ ] [§7.1.2](07-client-runtime.md) の傍受条件を全部実装している（特に `download` と `target`）
- [ ] `fetch` に `redirect: 'manual'` を指定している
- [ ] リダイレクト判定を `res.type === 'opaqueredirect'` で行っている（`res.status` を見ていない）

## B.5 Response validation order

Fragment, navigation, and enhanced-form fetches perform all applicable checks before changing DOM or Store state:

1. Resolve against `location.href`, require the same origin, normalize the configured Fragment prefix, and require a path-segment boundary rather than a string prefix.
2. Fetch with `credentials: 'same-origin'` and `redirect: 'manual'`.
3. Reject opaque/manual redirects and non-2xx responses.
4. Parse `Content-Type` as a media type and require `text/html` case-insensitively. Parameters are allowed.
5. Parse protocol headers as ordered exact tokens. Reject duplicate, missing, unexpected, or header/body-mismatched Partial names.
6. Parse the complete body into detached nodes, validate markers and snapshots, then merge Store state and mutate the DOM.

Concurrent requests for the same canonical Fragment URL share one promise. Every still-connected Island whose normalized `data-fragment` exactly matches receives the result; disconnected targets are skipped. A replacement invalidates pending Island hydration so a removed node cannot be hydrated later.

Enhanced forms use the actual submitter (`formaction`, `formmethod`, `formenctype`, name, and value), preserve repeated names and file names, append GET fields to the query, and select URL-encoded, multipart, or text bodies according to the effective encoding. Forms without `data-partial` or `data-fragment` are never intercepted. Validation failure invokes the native form submission path.
- [ ] DOM 挿入より**前**にフォールバック判定を完了している
- [ ] **Store マージが Island ハイドレートより先**（差し替え時・初回ロード時の両方）
- [ ] 走査範囲が「今回挿入された範囲」に限定されている
- [ ] 古い Island のリスナ（`IntersectionObserver` / `matchMedia` / `requestIdleCallback`）を解除している
- [ ] `data-fragment` の取得が trigger 発火時に 1 回だけで、失敗時は SSR 済みの中身を残している
- [ ] Fragment の反映先を `[data-island][data-fragment="url"]` の完全一致で解決している（[§7.1.4](07-client-runtime.md)）
- [ ] 反映先が 1 つも無い `refreshFragment` を、例外ではなく警告で終えている
- [ ] フォーム送信で **snapshot マージが差し替え・Fragment 取り直しより先**（[§7.2.4](07-client-runtime.md)）
- [ ] Fragment 取得の AbortController がナビゲーション用と分かれている
- [ ] `AbortError` でフォールバックしていない
- [ ] `replace` の差し替え後に focus を移動している
- [ ] `focus({ preventScroll: true })` を指定している（[§7.3.3](07-client-runtime.md)）
- [ ] `append` / `prepend` でスクロール位置**と focus** を動かしていない
- [ ] マーカーを削除せず、受け取った HTML 側のマーカーを取り除いてから挿入している
