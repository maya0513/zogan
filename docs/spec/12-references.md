# §12 参照する既存実装

| | 参照する箇所 |
|---|---|
| **Fresh (Deno)** | **最優先。`<Partial>` の意味論、`f-client-nav` のオプトイン、mode と key、フォールバック、ローディング指示子。本仕様の 8 割が既に存在する。** ただしパーシャル専用ルート方式（[§3.2](03-partial.md)）だけは採らない |
| **Astro** | server islands の穴あけとキャッシュ設計。ただし props 暗号化方式は採用しない（[§4.3](04-fragment.md)） |
| **Turbo (Hotwire)** | `data-turbo-permanent` の DOM 移送。[§7.3](07-client-runtime.md) の実装参考 |
| **htmx** | `hx-preserve` の実装（退避コンテナ方式）と、その既知の破綻ケース |
| **mizchi/sol** | コメントマーカーによる領域指定、trigger の分類。遅延取得は持たないので [§4](04-fragment.md) の参考にはならない |
| **Hydrogen / React Router** | 楽観 UI とサーバ権威カートの割り切り方 |

---

## 12.1 機構ごとの対応表

**「これは zogan の発明か、既存実装からの借用か」を即座に引ける**ようにするための表です。実装で迷ったとき、借用元の実装を読むのが最短経路になります。

| zogan の機構 | 借用元 | 相当するもの | 差分 |
|---|---|---|---|
| `<Partial name>` | Fresh | `<Partial name>` | 無し |
| `mode="replace\|append\|prepend"` | Fresh | 同名 | 無し |
| `key`（append/prepend で必須） | Fresh | 同 | 無し |
| `data-client-nav` オプトイン | Fresh | `f-client-nav` | 属性名のみ |
| `data-partial`（リンク・フォーム） | Fresh | `f-partial` | **値が URL ではなく Partial 領域名**（[§7.1.3](07-client-runtime.md)） |
| `data-fragment`（Island・フォーム） | — | — | **zogan 独自** |
| フォームは明示指定時のみ傍受 | Fresh 2.3 | 同 | 無し |
| フォールバックでフルナビ | Fresh | 同 | 無し |
| `navigating` / `pendingPartials` | Fresh | ローディング指示子 | signal で公開する点 |
| `X-Partial` ヘッダで部分取得 | Turbo | `Turbo-Frame:` ヘッダ | **複数領域を同時指定** |
| `data-preserve` | Turbo / htmx | `data-turbo-permanent` / `hx-preserve` | 用途を 4 つに限定 |
| preserve の退避コンテナ方式 | htmx | 同 | 無し |
| Fragment（キャッシュの穴） | Astro | server islands | **props を渡さない**（[§4.3](04-fragment.md)） |
| `/_f/` エンドポイント | ESI / Rails | fragment caching | 無し |
| trigger（`load`/`idle`/`visible`/`media`） | Astro | `client:*` | 名前をそのまま採用 |
| コメントマーカー `<!--p:name-->` | mizchi/sol | 同 | 無し |
| 楽観 UI + サーバ権威カート | Hydrogen | 同 | 二層に明示分離した点 |
| **base + pending の二層** | — | — | **zogan 独自** |
| **client-only のビルド時強制** | — | — | **zogan 独自** |

**独自は 3 行だけです。** 他はすべて既存実装に前例があります。

## 12.2 既存実装から**あえて外した**判断

外した箇所は 4 つだけです。それぞれ本編に理由が書かれています。**理由を確認せずに「既存に合わせる」方向へ戻さないこと。**

| 外したもの | 借用元での方式 | zogan の方式 | 理由 |
|---|---|---|---|
| パーシャルの取得経路 | Fresh：専用ルートファイル + `skipAppWrapper` | 同じハンドラ + `X-Partial` ヘッダ | 同じ内容を二重に書く必要が出て利用者が混乱している（[§3.2](03-partial.md)） |
| Fragment への入力 | Astro：props を暗号化して送る | URL 由来 ID のみ。秘密は Cookie から読む | 暗号文がキャッシュキーに載ると**穴の側がキャッシュできない**（[§4.3.2](04-fragment.md)） |
| DOM 状態の保存 | Turbo：`data-turbo-permanent` を主軸に使う | 逃げ道に限定。主軸は Store | ID マッチング方式は履歴復元で破綻する（[§7.3.4](07-client-runtime.md)） |
| `data-partial` の値 | Fresh：`f-partial` は取得先 URL | Partial 領域名。URL は `data-fragment` に分離 | URL 意味論は専用ルートファイル方式に由来し、それを外した以上リンクに別の取得先を書く意味がない（[§3.2](03-partial.md) / [§7.1.3](07-client-runtime.md)） |

## 12.3 参照の優先順位

実装で判断に迷ったとき、**この順に読むこと**。

```
1. Fresh          — Partial / client-nav 周りは 8 割ここにある
2. Astro          — キャッシュの穴と trigger
3. htmx / Turbo   — preserve の実装詳細だけ
4. mizchi/sol     — マーカーの実装だけ
5. Hydrogen       — カートの割り切り方だけ
```

1 と 2 は**設計まで参照します**。3〜5 は**特定の実装詳細だけ**を見て、設計思想は持ち込まないこと。htmx の属性駆動の思想や Turbo の DOM 中心の思想を持ち込むと、[§2](02-architecture.md) の中核原則（状態は Island の外にある）と衝突します。

## 12.4 参照しないもの

意識的に読まないリスト。**読むと引きずられるため**です。

| | 理由 |
|---|---|
| react-router / TanStack Router | ネストルート・loader 階層の設計が入り込む（[§1](01-scope.md)） |
| Next.js App Router | RSC 前提の設計。zogan は SSR + islands であり系譜が違う |
| Remix の楽観 UI | フォーム中心の抽象化。zogan はフォームを既定で傍受せず、`action` / `useFetcher` 相当の抽象も持たない（[§7.1.3](07-client-runtime.md)） |
| Qwik | resumability は別問題を解いている。ハイドレーションの設計が根本的に違う |

これらが劣っているという意味ではありません。**解いている問題が違う**ので、部分的に借りると設計が混ざります。
