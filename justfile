default:
    @just --list

# 依存をインストールする
install:
    pnpm install

# テストを 1 回流す
test *ARGS:
    pnpm exec vp test --run {{ ARGS }}

# カバレッジ閾値を含むテスト
coverage:
    pnpm run coverage

# テストを監視する
watch:
    pnpm exec vp test

# フォーマット・lint・型検査（すべて vite-plus 同梱の oxfmt / oxlint / tsgolint）
check:
    pnpm exec vp check

# フォーマットと lint の自動修正
fix:
    pnpm exec vp fmt
    pnpm exec vp lint --fix

# ライブラリをビルドする（dist に ESM と .d.ts）
build:
    pnpm run build

# 性能ベンチマーク
bench:
    pnpm run bench

# publish されるパッケージの構造・型・サイズを検査
package-check:
    pnpm run package:check

# Workers デモの build とテスト
demo:
    pnpm run demo:build
    pnpm --filter @zogan/shop cf-typegen:check
    pnpm run demo:test

# ライブラリ紹介サイトの production build
site:
    pnpm run site:build

# Cloudflareへ送る両サイトのbundleを、公開せずに検証
deploy-check:
    pnpm run deploy:dry

# レジストリ上の依存更新を確認
deps-check:
    pnpm run deps:check

# Deno runtime、npm配布物、JSR、Denoサンプルを独立して検証
deno-ci:
    deno install --frozen --node-modules-dir=manual
    pnpm run build
    deno task deno:check
    deno task deno:test
    pnpm run package:check:deno
    deno task deno:example:build
    pnpm run deno:contract
    deno task deno:jsr
    pnpm run deno:e2e

# CI で回す決定的な品質ゲート（benchmark と browser E2E は専用 job）
# check は package.json の self-reference から dist を解決するため、clean checkout では build を先に行う。
ci: build check coverage package-check site demo
