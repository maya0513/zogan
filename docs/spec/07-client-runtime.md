# §7 クライアントランタイム

## 7.1 【重要】ナビゲーションはオプトイン

**リンクを無条件に傍受しない。** 有効化した部分木の中だけで動作する。

```html
<body data-client-nav>
  ...
  <a href="/checkout" data-client-nav="false">レジへ進む</a>
</body>
```

クリック時、自身から祖先へ遡って `data-client-nav` を探し、truthy なら差し替え、なければ通常遷移。

全傍受は危険：決済フォーム、外部決済へのリダイレクト、ファイルダウンロード、`target` 付きリンク、外部ドメインを巻き込む。

**フォームは `data-partial` / `data-fragment` を明示的に指定しない限り傍受しない。** Fresh は当初フォームを傍受していたが、2.3 で「明示指定がなければ傍受しない」に変更した。同じ失敗を繰り返さない。

```html
<form action="/cart/add" method="post" data-fragment="/_f/cart-badge">
```

この節は Fresh の `f-client-nav` をそのまま踏襲しています。**属性名以外は変えないこと。** Fresh が一度失敗して直した設計を、こちらで作り直す理由がありません。

### 7.1.1 属性の解決規則

```
resolveClientNav(el):
  node = el
  while node:
    if node.hasAttribute('data-client-nav'):
      v = node.getAttribute('data-client-nav')
      return v !== 'false'          // '' も 'true' も truthy
    node = node.parentElement
  return false                       // 見つからなければ通常遷移
```

- **最も近い祖先が勝つ。** 部分木ごとに有効/無効を切り替えられる
- 値が `"false"` の場合のみ無効。空文字列（`data-client-nav`）は有効
- 属性が 1 つも無ければ無効。**既定は「傍受しない」**

### 7.1.2 傍受の条件

すべて満たす場合のみソフトナビゲーションに入ります。1 つでも欠けたら**何もしない**（ブラウザの通常動作に任せる）。

| 条件 | 理由 |
|---|---|
| `<a>` 要素で `href` を持つ | — |
| 左クリック（`button === 0`） | 中クリックは新規タブ |
| 修飾キーなし（`ctrl` / `meta` / `shift` / `alt`） | 新規タブ・ウィンドウ・ダウンロード |
| `target` 属性が無いか `_self` | 別フレーム・別タブ指定を尊重 |
| `download` 属性が無い | **ファイルダウンロードを壊さない** |
| 同一オリジン | 外部ドメインへは通常遷移。`mailto:` / `tel:` / `javascript:` はここで弾かれる |
| **遷移先のパス・クエリが現在の URL と異なる** | **同一文書内アンカー（`#foo`）を除外する。** 下の補足を参照 |
| `rel="external"` が無い | 明示的な離脱指定 |
| `data-client-nav` が truthy（§7.1.1） | オプトイン |
| `event.defaultPrevented` が false | 他のスクリプトが処理済み |

**「疑わしきは通常遷移」が原則です。** 判定を間違えて通常遷移になっても、遅いだけで壊れません。逆に傍受してはいけないものを傍受すると、決済が止まります。

> **同一文書内アンカーの除外を忘れないこと。**
>
> `<a href="#reviews">レビューへ</a>` は同一オリジンの条件を通ってしまいます。傍受すると、**同じ URL へ無駄な fetch が飛び、ページ全体が差し替わり、ブラウザのアンカースクロールが失われます**。
>
> ```ts
> const target = new URL(a.href, location.href)
> const isSameDocument =
>   target.pathname === location.pathname && target.search === location.search
> if (isSameDocument) return          // ハッシュだけの違い → ブラウザに任せる
> ```
>
> 判定は**ハッシュを除いた部分の一致**で行います。`#foo` 付きで別ページへ行くリンクは傍受してよく、そのときのスクロールは §7.3.3 が扱います。

### 7.1.3 フォームの扱い

フォームは **`data-partial` または `data-fragment` があるときだけ**傍受します。どちらも無ければ通常送信です。

```html
<!-- 傍受する：カート追加後に cart-badge を取り直す -->
<form action="/cart/add" method="post" data-fragment="/_f/cart-badge">

<!-- 傍受する：送信後に results 領域を差し替える -->
<form action="/search" method="get" data-partial="results,count">

<!-- 傍受しない：決済フォーム。どちらも無い -->
<form action="/checkout/pay" method="post">
```

2 つの属性は**直交していて、併記できます**。意味は要素を問わず一定です（[付録 B](appendix-b-markup.md)）。

| 属性 | 値 | 送信後の動作 |
|---|---|---|
| `data-partial` | **Partial 領域名**のカンマ区切り | 応答からその領域を差し替える |
| `data-fragment` | **Fragment の取得先 URL**のカンマ区切り | 送信後にその Fragment を取り直す |

- `data-client-nav` が有効な部分木の中にあっても、どちらの属性も無ければ傍受しない。**フォームだけは祖先の設定を継承しない**
- `method="get"` のフォームも同じ規則。検索フォームを傍受したいなら属性を書く
- `data-fragment` の値は [§4.3.3](04-fragment.md) の制約を受ける。**サーバが SSR 時に書いた URL のみ**

`enctype="multipart/form-data"`（ファイルアップロード）も同じ扱いです。**フレームワーク側で特別扱いしません。** 進捗表示やタイムアウトの都合で通常送信にしたいなら、属性を書かなければ済みます。**明示的に書かれた属性をフレームワークが無視する規則を作らないこと。**

### 7.1.4 Fragment の取り直し先をどう決めるか

`data-fragment` を持つフォームと `refreshFragment(url)`（[付録 A](appendix-a-api.md)）は、どちらも「Fragment を取り直して DOM に反映する」ものです。**反映先は URL から機械的に決まります。**

```
refreshFragment(url):
  targets = document.querySelectorAll(`[data-island][data-fragment="${url}"]`)
  if targets.length === 0:
    警告して return                    // 反映先が無い。何もしない

  html = await fetchFragment(url)      // 失敗 → 警告のみ。既存の中身を残す

  for el of targets:
    el の中身を html で置換
    mergeSnapshots([...el.childNodes])  // ★ hydrate より先（§7.2）
    el を再ハイドレート
```

- **反映先は `data-fragment` の値が完全一致する Island のみ。** 部分一致や正規化を行わない
- 該当が複数あってよい（同じカートバッジをヘッダとフッタに置くなど）。**全部を同じ応答で更新する**
- **該当が 1 つも無ければ何もしない。** 例外にしない

**この規則が [§4.3](04-fragment.md) の不変条件を守っています。** 反映先が「DOM に既に存在する `data-fragment` の値」に限られるため、`refreshFragment` に任意の URL を渡しても、サーバが SSR 時に書いていない URL では**そもそも反映先が見つからず何も起きません**。クライアントが URL を組み立てる意味がなくなります。

`fetchFragment` の実装要件：

| 項目 | 規則 |
|---|---|
| URL の検証 | `fragmentPrefix` 配下の同一オリジンであること。違反は警告して中止（[付録 B](appendix-b-markup.md)） |
| `credentials` | `'same-origin'`。Fragment が Cookie を読む |
| `AbortController` | ナビゲーション用とは**別に管理する**（§7.3.2） |
| 失敗時 | 警告のみ。既存の中身を残す。ページを落とさない |

フォームの `data-fragment` がカンマ区切りで複数の URL を持つ場合は、**各 URL に対して独立に上の手順を回します**。1 本が失敗しても他は続行します。

### 7.1.5 傍受してはいけないものの実例

**全傍受を採用すると全部壊れます。**

| 対象 | 何が起きるか |
|---|---|
| 決済代行へのリダイレクト | 外部オリジンへ fetch して CORS エラー。決済に進めない |
| 領収書 PDF のリンク | `download` を無視すると PDF の中身が HTML として差し替わる |
| 3D セキュアの iframe 内リンク | フレームを跨いだ差し替えで表示が壊れる |
| ログアウトリンク | Store が残ったまま別ユーザの画面になる（[§8](08-edge-cases.md)） |
| 外部サイトへのアフィリエイトリンク | 同一オリジン判定で弾かれるが、判定を忘れると離脱できない |

---

## 7.2 処理順序

ソフトナビゲーションは次の順で進む。**この番号を本仕様における処理順序の正とする。**

### 7.2.1 各ステップの詳細

| # | 処理 | 失敗時 | 参照 |
|---|---|---|---|
| 1 | クリック傍受 | 何もしない（通常遷移） | §7.1.2 |
| 1.5 | 進行中の fetch を abort、`navigating` を true に | — | §7.3 |
| 2 | `fetch(url, { headers: { 'X-Partial': … } })` | **フォールバック** | [§3.2](03-partial.md) |
| 3 | 応答を検証（ステータス / `X-Partial` ヘッダ） | **フォールバック** | §7.3.1 |
| 4 | HTML をパースしてマーカー範囲を切り出し | **フォールバック** | [§3.3.2](03-partial.md) |
| 5 | `data-preserve` の DOM を退避 | 続行 | §7.3.4 |
| 6 | マーカー範囲を挿入（mode に従う） | **フォールバック** | [§3.4](03-partial.md) |
| 7 | `data-preserve` の DOM を復帰 | 続行 | §7.3.4 |
| 8 | **★ Store snapshot をマージ** | 警告して続行 | [§5.2.3](05-store.md) |
| 9 | **★ Island をハイドレート** | 警告して続行 | [§6.1.3](06-island.md) |
| 10 | `history.pushState` | — | — |
| 11 | focus 移動、スクロール位置調整 | — | §7.3.3 |
| 12 | `navigating` を false に | — | §7.3.2 |

**8 が 9 より先であることは必須です。** 逆順だと Island が古い値で一度描画されてから正しい値に飛び、カート数がちらつきます（§7.2.2）。

**フォールバックはステップ 6 より前でしか起こせません。** DOM への挿入を始めた後に失敗すると、中途半端に差し替わった画面が残ります。したがって**挿入前に検証を全部終える**設計にすること。

### 7.2.2 なぜ 8 が 9 より先なのか

```
（誤った順序：Island → Store）
  t=0  Island をハイドレート → cart.value.count を読む → base は古い 41 の値「3」
  t=1  画面に「3」が描画される
  t=2  Store をマージ → base が 42 に更新 → count = 4
  t=3  signal の再描画で「4」に変わる

  → ユーザには「3」が一瞬見えてから「4」に飛ぶ
```

`@preact/signals` は同期的に再描画するため、ちらつきは 1 フレーム程度です。しかし**カート数が減ってから戻る**という動きは、金額に関わる画面では露骨に不信感を与えます。

正しい順序なら、Island は最初から正しい値を読みます。

**この順序は差し替え時だけでなく、初回ロード時（[§2.3](02-architecture.md)）にも同じく必要です。**

### 7.2.3 どの領域を要求するか

ステップ 2 の `X-Partial` に何を入れるかの決定規則。

1. リンクに `data-partial` があれば、その領域名リストを使う
2. 無ければ、**現在の DOM に存在する全マーカーの名前**を使う

2 が既定です。ページに `results` と `count` があれば `X-Partial: results,count` を送ります。サーバは遷移先で存在する領域だけを返し、応答ヘッダで実際の内容を通知します（[§3.2.2](03-partial.md)）。

遷移先に別の領域があるケース（一覧 → 詳細）では、要求した領域が 1 つも返らないため**フォールバックしてフルナビゲーションになります**。これは正しい挙動です。ページ構造が変わる遷移を部分差し替えで処理する意味がありません。

### 7.2.4 フォーム送信の処理順序

[§2.3](02-architecture.md)(d) の経路です。上の 12 ステップとは**起点と終点が違う**ので、別に定めます。

| # | 処理 | 失敗時 |
|---|---|---|
| 1 | submit 傍受（`data-partial` / `data-fragment` のどちらかを持つ場合のみ） | 何もしない（通常送信） |
| 2 | `FormData` を組み立て、`method` に従って送信<br>`get` → クエリ文字列にして URL へ、`post` 等 → body へ | **フォールバック** |
| 3 | 応答を検証（ステータス / `Content-Type`） | **フォールバック** |
| 4 | **★ 応答本文の `[data-store]` をマージ** | 警告して続行 |
| 5 | `data-partial` があれば、応答から該当領域を差し替える（12 ステップの 4〜9 と 11。**`pushState` は含まない**） | **フォールバック** |
| 6 | `data-fragment` があれば、各 URL を §7.1.4 の手順で取り直す | 警告して続行 |

**4 が 5・6 より先**である理由は §7.2.2 と同じです。カート追加の応答に載った新しい確定値を、差し替えや再ハイドレートより先に base へ入れます。

規則：

- **`pushState` するのは `method="get"` のフォームだけです。** POST の送信先 URL を履歴に積むと、戻るボタンで再送信になります。`data-partial` を持つ POST フォームは、差し替えはするが URL を変えません
- `method="get"` かつ `data-partial` を持つフォーム（検索フォーム）は、**組み立てた URL でソフトナビゲーションを行います**。12 ステップの 2 以降にそのまま合流すると考えてください（`pushState` を含む）
- **どちらの属性も無ければ、差し替えもナビゲーションも起きません。** カート追加のように「送って、バッジだけ更新する」用途は `data-fragment` だけを書きます
- 応答は `private, no-store` である前提です。カート更新の結果を snapshot で返すため（[§5.5](05-store.md)）
- **フォールバック = そのフォームを通常送信し直す。** `form.submit()` で、ブラウザに元の送信をやらせます

> **応答本文に何を入れるかはアプリケーションが決めます。**
>
> zogan が要求するのは「`[data-store]` があればマージする」「`data-partial` の領域があれば差し替える」の 2 点だけです。カート追加の応答は `<StoreSnapshot>` 1 つだけでも成立します。**フォーム専用の応答形式を定義しません。**

---

## 7.3 その他の必須挙動

- **フォールバック**：応答に対象の Partial が含まれない、非 2xx、fetch 失敗 → **フルナビゲーションに切り替える**。壊れた画面を出さない。リダイレクト応答も同様に扱う
- **連打・競合**：進行中の fetch は AbortController で破棄。最後のナビゲーションだけを適用
- **JS 無効 / 読込前のクリック**：`<a href>` がそのまま機能する。progressive enhancement は必須（JS 実行前のクリックが実際に起きる）
- **フォーカス**：差し替え後、新コンテンツの先頭に focus を移す
- **ローディング表示**：`zogan/client` が `navigating: ReadonlySignal<boolean>` と `pendingPartials: ReadonlySignal<string[]>` を export する。Island はこれを読むだけでスピナーを出せる。Store と同じ signal 基盤に乗るので追加機構は不要。**書き込むのはランタイムだけ**なので、公開する型は読み取り専用にする（[付録 A](appendix-a-api.md)）
- **View Transitions**：`data-view-transition` があれば `document.startViewTransition()` でラップ。任意
- **preserve（DOM 保存の逃げ道）**：

```html
<div data-preserve="player-1"><video>...</video></div>
```

差し替え時、同じ ID の要素が新旧両方にあれば古い DOM ノードを移送する。用途は**動画・音声プレイヤー、埋め込み決済ウィジェット(iframe)、入力途中のフォーム、地図に限定**する。ID マッチング方式は履歴復元で破綻しやすい（htmx でも戻る/進むで Web Component の状態が失われる問題が報告されている）ため、逃げ道に留める。

### 7.3.1 フォールバックの判定表

**判定はステップ 6（DOM 挿入）より前に完了すること**（§7.2.1）。上から順に評価します。

| # | 条件 | 動作 |
|---|---|---|
| 1 | `fetch` が reject（ネットワークエラー、CORS） | **フォールバック** |
| 2 | `AbortError` | **何もしない**（新しいナビゲーションが進行中） |
| 3 | `res.type === 'opaqueredirect'`（リダイレクト） | **フォールバック**（クエリを保持したまま元 URL へ） |
| 4 | ステータスが 2xx 以外 | **フォールバック** |
| 5 | `Content-Type` が `text/html` でない | **フォールバック** |
| 6 | 応答ヘッダ `X-Partial` が無い | **フォールバック**（Partial 非対応の応答） |
| 7 | 応答ヘッダ `X-Partial` が空 | **フォールバック**（返せる領域が無かった） |
| 8 | 返された領域が現在の DOM に 1 つも存在しない | **フォールバック** |
| 9 | 一部の領域だけ DOM に存在する | **存在する分だけ差し替える**。フォールバックしない |
| 10 | マーカーのパースに失敗 | **フォールバック** |

**フォールバック = `location.assign(url)`。** 元のクリックと同じ遷移をブラウザに行わせます。ユーザから見れば「少し遅い通常の遷移」であり、壊れた画面は一切見えません。

3 番の扱いが重要です。ログインセッション切れでログイン画面へリダイレクトされるケースがここに当たります。**リダイレクト先の HTML を部分差し替えしてはいけません**（[§8](08-edge-cases.md)）。

> **ステータスコードでは判定できません。**
>
> ソフトナビゲーションの `fetch` は `redirect: 'manual'` を指定します（[§8.4.3](08-edge-cases.md)）。このとき応答は **opaque redirect** になり、次のようになります。
>
> | プロパティ | 値 |
> |---|---|
> | `res.type` | `'opaqueredirect'` |
> | `res.status` | **`0`** |
> | `res.headers` | **空** |
> | `res.url` | 空文字列 |
>
> `302` や `301` は読めません。**`res.status` を見て 3xx と判定するコードは 1 度も真になりません。** `res.type` で判定すること。
>
> ステータスが 0 なので 4 番でも結果的にフォールバックしますが、リダイレクトであることを区別できないと、[§8.4.3](08-edge-cases.md) の「元 URL へ遷移する」という扱いを 4 番の一般的なエラーと分けられません。**3 番を先に評価すること。**

9 番は例外的にフォールバックしません。ネストした Partial（[§3.1.2](03-partial.md)）で親だけが返るケースが正常に起こるためです。

### 7.3.2 連打・競合と signal

```ts
let controller: AbortController | null = null

async function navigate(url: string) {
  controller?.abort()                    // 進行中を破棄
  controller = new AbortController()

  navigating.value = true
  pendingPartials.value = targets
  try {
    const res = await fetch(url, { signal: controller.signal, headers })
    …
  } finally {
    navigating.value = false
    pendingPartials.value = []
  }
}
```

- **最後のナビゲーションだけを適用する。** ファセットを 5 回連続で切り替えても、適用されるのは 5 回目だけ（[§10](10-acceptance.md)）
- `AbortError` は**フォールバックしない**。新しいナビゲーションが既に走っているため（§7.3.1 の 2 番）
- Fragment の取得（[§2.3](02-architecture.md)）は別の AbortController で管理する。ナビゲーションが Fragment 取得を巻き添えで破棄しないこと

`navigating` / `pendingPartials` を signal にしているのは、**Store と同じ基盤に乗せるため**です。Island は他と同じように読むだけで済みます。

```jsx
import { navigating } from 'zogan/client'
export default () => navigating.value ? <Spinner /> : null
```

ローディング表示のための専用機構（Fresh の `f-partial` インジケータ相当）を別に作らないこと。

**この Island は SSR して構いません。** `navigating` / `pendingPartials` はモジュールスコープにありますが、リクエスト間で漏れる値ではなく、SSR 中は常に `false` / `[]` です。[§5.3.2](05-store.md) の client-only 判定は `clientStore` の import だけを対象とするので、これらを読む Island はサーババンドルに入ってよく、ビルドも落ちません。

その代わり **`zogan/client` はサーババンドルでも評価可能でなければなりません。** モジュールのトップレベルで `document` / `window` に触れないこと。DOM への参照は `start()` の内側に閉じ込めます。

### 7.3.3 focus とスクロール

差し替えは URL が変わってもページがリロードされないため、**ブラウザが行うはずの処理を自前でやる必要があります**。

| 項目 | 動作 |
|---|---|
| focus（`replace`） | **最初に差し替わった領域の先頭要素**へ focus を移す。フォーカス可能な要素が無ければ、その領域に `tabindex="-1"` を付けて focus する |
| focus（`append` / `prepend`） | **動かさない。** 蓄積であってページ遷移ではない |
| スクリーンリーダー通知（`replace`） | focus 移動により読み上げが始まる。追加の `aria-live` は不要 |
| スクリーンリーダー通知（`append` / `prepend`） | 追加分を `aria-live="polite"` の領域に入れる。**focus は奪わない** |
| スクロール（`replace`） | ページ先頭へ。ただしアンカー（`#foo`）付きならその要素へ |
| スクロール（`append` / `prepend`） | **動かさない。** 無限スクロールで先頭に飛ぶのは論外 |
| 戻る/進む | スクロール位置の復元規則は [§11](11-open-questions.md) の未決定事項 |

**focus 移動はアクセシビリティの必須要件です。** 省略すると、スクリーンリーダー利用者にはページが変わったことが伝わりません。

#### `focus()` は既定でスクロールします

ステップ 11 は「focus 移動、スクロール位置調整」を 1 つにまとめていますが、**この 2 つは互いに干渉します**。

```ts
// ✗ focus() が要素を画面内へスクロールし、直後の指定を打ち消す／順序に依存する
el.focus()
window.scrollTo(0, 0)

// ✓ focus のスクロールを止め、位置は明示的に決める
el.focus({ preventScroll: true })
window.scrollTo(0, 0)          // アンカー付きなら該当要素へ
```

**`preventScroll: true` を必ず指定すること。** 指定しないと、`replace` では「先頭へ」の指定が focus 先へのスクロールと競合し、`append` では「動かさない」という規則が focus によって破られます。

`append` / `prepend` で focus を動かさないのは、**蓄積はページ遷移ではない**からです。無限スクロールで「もっと見る」を押すたびに focus が飛ぶと、キーボード利用者は読んでいた位置を失います。ページが変わったわけではないので、通知は `aria-live` で足ります。

### 7.3.4 preserve の詳細

```html
<div data-preserve="player-1"><video>...</video></div>
```

手順：

```
1. 挿入前：差し替え対象範囲の [data-preserve] を集め、退避コンテナへ move
2. 挿入
3. 挿入後：新 DOM 内の [data-preserve] を探し、同じ ID があれば
   新しい要素を「退避しておいた古い要素」で置き換える
4. 退避コンテナに残った（新 DOM に対応が無い）要素は破棄
```

htmx の退避コンテナ方式と同じです。**独自の方式を考えないこと。**

用途の限定：

| 用途 | 可否 |
|---|---|
| 動画・音声プレイヤー | ○ 再生位置が失われると実害 |
| 埋め込み決済ウィジェット（iframe） | ○ 再初期化がベンダ側で失敗する |
| 入力途中のフォーム | ○ |
| 地図 | ○ 再初期化がタイル取得を伴い重い |
| **カート数の表示** | ✗ Store を使う（[§5](05-store.md)） |
| **アコーディオンの開閉** | ✗ `useSignal` で足りる。消えてよい |
| **スクロール位置** | ✗ §7.3.3 の話 |

**preserve は逃げ道であり、設計の主軸ではありません。** [§2](02-architecture.md) の中核原則は「Island は毎回作り直されてよい。状態は Island の外にある」です。preserve を多用し始めたら、Store に置くべき状態を DOM に置いていないか疑ってください。

既知の弱点として、**ID マッチング方式は履歴復元（戻る/進む）で破綻します**。htmx でも同種の問題が報告されています。この弱点を承知の上で、上表の 4 用途に限定して使うこと。

### 7.3.5 progressive enhancement

**JS が動かない状態でも EC として成立すること。** これは努力目標ではなく必須要件です（[§10](10-acceptance.md)）。

| 機構 | JS 無効時の挙動 |
|---|---|
| `<a href>` | 通常遷移。すべてのリンクが機能する |
| `<form>` | 通常送信。`data-partial` / `data-fragment` は無視される |
| Partial | マーカーは HTML コメントなので**何も起きない**。ページは完全な HTML |
| Island | SSR 済みの中身がそのまま表示される（[§6.1.4](06-island.md)） |
| Fragment | **取得されない。** 穴が空いたまま |
| Store | 動かない |

Fragment の行が唯一の非対称点です。JS 無効ではカート数が表示されません。対処：

- **カート数が見えなくても購入導線が成立するように設計する。** カートページへのリンクは常に存在し、そこでは殻ではなくページ本体としてカート内容を SSR する
- 決済フローは Fragment に依存させない

**JS 実行前のクリックは実際に起きます。** 商品一覧の表示直後、まだ `zogan/client` が読み込まれていない数百ミリ秒の間にユーザがクリックすることは珍しくありません。このとき `<a href>` がそのまま機能することが、progressive enhancement の実利です。

### 7.3.6 View Transitions

```html
<a href="/products/ABC-123" data-view-transition>
```

`data-view-transition` があれば、§7.2 のステップ 6〜9 を `document.startViewTransition()` でラップします。

- **任意機能。** 未対応ブラウザでは単に効果なしで動作する
- `startViewTransition` のコールバック内で DOM 操作を完結させること。Store マージと Island ハイドレートも含める（含めないと遷移中に値が変わる）
- 対応していない環境の分岐は `if (!document.startViewTransition) { 直接実行 }` の 1 行に留める

#### 通信をコールバックに含めない

`startViewTransition` のコールバックが解決するまで、**ブラウザは画面を凍結します**。ここに通信が入ると、その待ち時間がそのまま無反応時間になります。

ステップ 9（Island のハイドレート）には、通信を伴う経路が 2 つあります。

| 経路 | 参照 | 扱い |
|---|---|---|
| `data-fragment` の取得 | [§6.1.5](06-island.md) | **待たない。** ラップの外で続行させる |
| `visible` / `idle` trigger の発火待ち | [§6.1.2](06-island.md) | **待たない。** そもそも発火はずっと後 |

規則：

> **コールバックが待つのは、DOM の差し替えと `load` trigger の同期的なハイドレートまで。** Fragment の取得と遅延 trigger は、ラップの外で非同期に進めます。

```ts
await document.startViewTransition(() => {
  差し替え()                    // ステップ 6・7
  mergeSnapshots(挿入ノード)     // ステップ 8
  hydrateIslands(挿入ノード)     // ステップ 9（Fragment 取得は待たない）
}).finished
```

Fragment の中身が遷移アニメーションの後から差し替わりますが、**それでよい**のが [§6.1.5](06-island.md) の設計です。Fragment 島の SSR 済み中身はプレースホルダであり、LCP も担いません。**遷移の滑らかさのために通信を待つ理由がありません。**
