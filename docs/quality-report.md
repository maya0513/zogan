# 品質レポート

測定日：2026-08-20。数値は zogan vNext の実装から取得した。生成物ではなく、リポジトリに保存した設定・テスト・baseline を正本とし、閾値を満たさなければコマンド自体が失敗する。

## 静的検査

コマンド：`vp check`

- Oxfmt による全対象ファイルの format check
- Oxlint の warning ゼロ運用
- type-aware rule と TypeScript Go toolchain による full type check
- 未使用の lint disable を error 化
- correctness、nursery、pedantic、performance、suspicious と、安全性、import、Promise、accessibility、hooks、Vitest の規則を error 化
- runtime warning／CLI結果以外の`console`、重複import、valueとして不要なtype import、type-only importのside effectを禁止

相互に矛盾する preference rule を一括で有効にはせず、実行環境や public API に必要な例外だけをファイル範囲付き override または理由付き disable として記録する。

## テストカバレッジ

コマンド：`vp test run --coverage`

15 test files、217 tests が成功した。

| 指標       | 測定値 | 全体閾値 |
| ---------- | -----: | -------: |
| Statements | 97.28% |      95% |
| Lines      | 98.29% |      95% |
| Functions  | 98.50% |      95% |
| Branches   | 95.73% |      90% |

全体閾値に加え、次の重要境界へファイル単位の gate を置く。

- `src/server/cache.ts`: statements／lines 95%、functions 100%、branches 95%
- `src/server/zogan.ts`: 全指標 100%
- `src/client/fragments.ts`: 全指標 100%
- `src/vite/client-only.ts`: statements／lines／functions 100%、branches 90%
- `src/vite/islands-entry.ts`: 全指標 100%

テストは、必須 CachePolicy、Hono 非拡張、one URL／one representation、native link／form、Fragment の fetch 重複排除・descriptor race・削除 target・contextual parsing・failure fallback・response境界拒否、root-scoped dispose、nested owner、typed descriptor、lazy loader、chunk／hydrate failure、client-only/server-only graph を含む。

## 性能基準

コマンド：Node 24 で `vp run bench`

環境：Node 24.19.0、Linux x64。各 benchmark file を直列に三回実行し、その中央値を保存値と比較する。baseline より 20% を超えて遅い場合は失敗する。

| Benchmark                                         | baseline median |
| ------------------------------------------------- | --------------: |
| Page render: 100 products and typed Island        |     0.083796 ms |
| Fragment render: 20 product cards                 |     0.024030 ms |
| FragmentSlot fan-out/DOM replace: 75 of 100 slots |    22.939023 ms |
| Lazy Island discovery/loader: 75 of 100 nodes     |    12.689826 ms |

機械可読な正本は [`benchmarks/baseline.node24.json`](../benchmarks/baseline.node24.json) にある。

## 公開 bundle と package

コマンド：`vp run package:check`

| Entry             | gzip 測定値 | hard limit |
| ----------------- | ----------: | ---------: |
| `zogan/fragments` |    1.68 KiB |      4 KiB |
| `zogan/client`    |    1.64 KiB |      5 KiB |
| `zogan` server    |    2.51 KiB |      4 KiB |
| `zogan/vite`      |    3.03 KiB |      5 KiB |

同じ command で実 tarball を作成し、publint、Are The Types Wrong、Vite 8 peer、全 runtime entry の import、公開 value export の allowlist、全 vNext API／型の consumer compile を検証する。npm package は ESM only である。

## サンプルとブラウザ

- `vp run demo:check`: Shop の production build、生成済み Cloudflare binding 型、Workerd + D1 integration tests
- `vp run ci:browser`: 紹介サイト、Shop、Deno サンプルの Chromium E2E と Cloudflare dry-run
- Shop と Deno は JavaScript 有効／無効の両 project で native document navigation を検証
- Shop は native form + PRG と app-owned JSON enhancement、private cart Fragment、stock Fragment を検証
- production build は Island 実装を初期 entry に static import せず、使用する Island ごとの lazy chunk を生成。Shop E2E は対応markerがないdocumentで `AddToCart` chunkが取得されないことをnetwork request単位で検証する

## Deno、JSR、Node current

コマンド：`vp run ci:deno`、`vp run ci:node-current`

- Deno 2.9+ で server／client／Vite source とサンプルを type check・test・build
- 一時 Deno consumer から npm tarball の四 entry と vNext API／型を検証
- npm／JSR の runtime export を比較し、publish file boundary と import map を検査
- `deno doc --lint` と `deno publish --dry-run` を実行。Hono augmentation を廃止したため `--allow-slow-types` は使わず、peer typeとopaque symbolに由来する既知のprivate-type-refだけを名前単位で検査する
- Node current job で build、unit tests、Vite peer を再検証

## 再現するコマンド

```sh
vp check
vp test run --coverage
vp run package:check
vp run demo:check
vp run ci:browser
vp run ci:deno
vp run ci:node-current
vp run deploy:check
vp run bench
```
