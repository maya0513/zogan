# zogan 設計仕様

このディレクトリは、現在の zogan 実装が提供する契約を記述する。zogan は Hono + Preact 向けの、明示的な HTML Fragment と型付き Island の小さなライブラリである。

中心となる考え方は次のとおり。

> ページ遷移はブラウザに任せ、独立して更新する必要がある箇所だけを、明示した URL から HTML として取得する。対話性が必要な箇所だけを、明示した ID の Island として起動する。

Fragment は HTTP を使う remote include であり、契約がゼロになるわけではない。ページ HTML、Fragment URL、応答 HTML、キャッシュポリシー、DOM marker、client runtime の間には契約がある。zogan が狙うのは、その契約をページ全体の暗黙な時系列へ広げず、各 `FragmentSlot` の近くに見える形で閉じることである。

## 読み方

| 文書 | 内容 |
|---|---|
| [00-glossary.md](00-glossary.md) | 用語とパッケージ境界 |
| [01-scope.md](01-scope.md) | 提供する機能、提供しない機能 |
| [02-architecture.md](02-architecture.md) | 全体構造、不変条件、deploy境界 |
| [03-cache-policy.md](03-cache-policy.md) | 明示的な `CachePolicy` |
| [04-fragment.md](04-fragment.md) | `FragmentSlot` と HTML endpoint |
| [05-island.md](05-island.md) | 型付きdescriptorとlazy Island |
| [06-client-runtime.md](06-client-runtime.md) | `start` と `refreshFragment` |
| [07-failure-modes.md](07-failure-modes.md) | fail-closed動作と残る弱点 |
| [08-acceptance.md](08-acceptance.md) | テスト項目と品質ゲート |
| [09-references.md](09-references.md) | 系譜、差分、採用しなかった設計 |
| [appendix-a-api.md](appendix-a-api.md) | 公開APIと型の一覧 |
| [appendix-b-markup.md](appendix-b-markup.md) | DOM markerとHTTPの一覧 |

最初に [§2 全体構造](02-architecture.md) を読み、実装時は [付録A](appendix-a-api.md) と [付録B](appendix-b-markup.md) を参照する。

## 不変条件

1. **1 URL は常に1表現。** ページURLは常に完全なHTML documentを返し、Fragment URLは常に埋め込み用HTMLを返す。
2. **リンク、フォーム、履歴はnative。** zogan runtimeはdocument-levelのclick、submit、popstateを傍受しない。
3. **境界はmarkupに明示する。** 更新対象は `FragmentSlot`、対話対象は `Island` だけである。
4. **キャッシュは呼び出しごとに明示する。** ページとFragmentの応答生成に、opaqueな `CachePolicy` が必須である。
5. **失敗してもserver fallbackを残す。** 検証、通信、module load、activateに失敗した領域を空にしない。
6. **Island codeは必要になるまで読み込まない。** client entryはIDごとのdynamic import loaderを持つ。
7. **server/client境界をbuildで検査する。** 明示したclient-only moduleがSSR entryから到達可能ならbuildを失敗させる。

## 正本

公開契約の最終的な正本は、`src/server/index.ts`、`src/client/index.ts`、`src/vite/index.ts` と、それらを固定するテストである。この仕様はその実装を説明する。文書と実装が矛盾した場合は、実装とテストを確認し、同じ変更で文書も直す。

内部scanner、registry、module graph helper、test reset hookは公開APIではない。付録にも公開機能として記載しない。
