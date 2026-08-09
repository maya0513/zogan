# 品質レポート

このレポートの測定値はリポジトリから再現できます。生成されたレポートや現在のベンチマーク出力は正本として扱いません。リポジトリに保存されたゲートを満たさない場合、コマンドは失敗します。

## テストカバレッジ

コマンド：`just coverage`

| 指標 | 測定値 | 必須値 |
| ---- | -----: | -----: |
| 文   | 98.01% |    95% |
| 行   | 99.16% |    95% |
| 関数 | 99.43% |    95% |
| 分岐 | 94.07% |    90% |

キャッシュの強制、ミドルウェアの安全境界、Store の整合、Fragment URL と結果配布の挙動、クライアント専用モジュールへの到達可能性については、ファイル単位のしきい値により、文・行・関数・分岐のすべてで 100% を要求します。

## 性能基準

コマンド：`just bench`

環境：Linux x64 上の Node 24.19.0。ファイルは直列に実行します。比較には 3 回の実行で得た中央値をさらに中央値にした値を使い、リポジトリに保存された基準値より 20% を超えて遅い場合は失敗します。

| ベンチマーク                               |      中央値 |
| ------------------------------------------ | ----------: |
| SSR：100 商品と 3 個の Partial             | 0.088409 ms |
| Partial 抽出：100 マーカー中の 10 個       | 0.005764 ms |
| snapshot 走査：レンダリング済み文書        | 0.005015 ms |
| DOM 置換：20 個の商品カード                | 0.558057 ms |
| Store マージ：バージョン付き snapshot      | 0.000184 ms |
| Fragment の結果配布：100 Island 中の 75 個 | 0.277454 ms |

機械可読な正本は [`benchmarks/baseline.node24.json`](../benchmarks/baseline.node24.json) です。

## 公開物のバンドルサイズ

コマンド：`just package-check`

| エントリ         | gzip 測定値 |   上限 |
| ---------------- | ----------: | -----: |
| `zogan/client`   |   11.69 KiB | 12 KiB |
| `zogan` サーバー |    6.24 KiB |  7 KiB |
| `zogan/vite`     |    3.87 KiB |  5 KiB |

同じコマンドで実際の tarball を作成し、publint と Are The Types Wrong を実行します。さらに tarball 内のすべての JavaScript エントリを import し、それに対する型 import をコンパイルし、任意 peer dependency のメタデータを検証します。

## ランタイムとブラウザの検証

- ルートの単体テスト、契約テスト、回帰テストは Vitest で実行します。
- Workers/D1 の統合テストは、分離された D1 ストレージを使って Workerd で実行します。
- Playwright は JavaScript の有効時と無効時の両方で Chromium を実行します。
- `wrangler deploy --dry-run` は、デプロイを行わずにデモのバンドルを検証します。

## Deno と JSR の検証

コマンド：`vp run ci:deno`

- Deno 2.9 以降で、サーバー、DOM を使わないクライアント import、Vite エントリを検査・実行します。
- 一時的な Deno コンシューマーから、作成済み npm tarball を import し、型検査して実行します。
- JSR マニフェストのバージョン、export map、npm 依存の mapping、ソースだけを公開する境界、npm/JSR のランタイム export を自動比較します。
- `deno publish --dry-run` は、実際に公開せず JSR へのアップロードを検証します。このコマンドで slow type を許可するのは、文書化された Hono のモジュール拡張自体が JSR によって slow type に分類されるためです。
- Deno で Vite の本番ビルドを実行し、生成されたブラウザバンドルに Node 専用 import が含まれていれば失敗させます。
- Playwright で、JavaScript 有効時のソフトナビゲーションと Island のハイドレーション、および JavaScript 無効時の通常ナビゲーションを検証します。
