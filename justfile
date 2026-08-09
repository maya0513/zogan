# 利用できるタスクと説明を表示する
default:
    @just --list

# 依存をインストールする
install:
    pnpm install

# テストを実行する
test:
    pnpm exec vp test

# カバレッジ閾値を含むテストを実行する
coverage:
    pnpm exec vp test run --coverage

# format・lint・型検査を実行する
check:
    pnpm exec vp check

# format と lint の問題を自動修正する
fix:
    pnpm exec vp check --fix

# ライブラリをビルドする
build:
    pnpm exec vp run build

# Node 24 baseline と性能を比較する
bench:
    pnpm exec vp run bench

# publish 対象の構造・型・サイズ・Vite peer を検証する
package-check:
    pnpm exec vp run package:check

# registry 上の依存更新を確認する
deps-check:
    pnpm exec vp run deps:check
