# §10 受け入れテスト

以下をすべて自動テストで確認する。テスト件数は変わるため固定せず、コマンドと不変条件を受け入れ基準とする。

## 10.1 公開契約

- [ ] `zogan(app, options)` の戻り値が Hono の `Env`、bindings、variables、schema、base path の型を失わない
- [ ] 異なる `fragmentPrefix` を持つ 2 つの Hono アプリが互いに影響しない
- [ ] サーバ・クライアント・Vite の各エントリが文書化された名前だけを公開し、マーカー・レンダラ・registry・module graph の内部実装を公開しない
- [ ] `hono`、`preact`、`@preact/signals` は必須 peer、Vite 8 は optional peer、`preact-render-to-string` は通常の依存になっている
- [ ] pack した tarball が publint、Are The Types Wrong、JavaScript import、型 import、peer dependency の契約検査を通る

## 10.2 HTTP とキャッシュ

- [ ] フルページ応答と部分応答の両方に `Vary: X-Partial` が付く
- [ ] 成功したページ応答と Fragment 応答には `Cache-Control` が必須。未指定なら、本番では `private, no-store` にフォールバックする
- [ ] 成功した HTML の GET/HEAD 応答に snapshot がある場合、`Cache-Control` に正確な `no-store` directive が必要。`no-storehouse` のような部分一致は拒否する
- [ ] public 応答にユーザの snapshot が入らない。private な snapshot 応答には `private, no-store` と必要な `Vary` を付ける
- [ ] リダイレクトは manual mode で扱い、DOM に挿入しない
- [ ] HTML 以外、外部オリジン、不正な Fragment prefix、ヘッダと本文が一致しない応答は、DOM を変更する前に拒否する
- [ ] `HEAD` も同じキャッシュ契約に従い、本文の読み取りを要求しない

## 10.3 クライアントランタイム

- [ ] ナビゲーションが連続したとき、最後の応答だけを適用する
- [ ] 同じ canonical Fragment URL へのリクエストは 1 つにまとめ、接続中の該当 Island すべてに同じ結果を反映する
- [ ] Fragment またはコンポーネントの読み込み中に Island が削除された場合、後からハイドレートしない
- [ ] Store の snapshot は `version` が現在値より大きい場合だけ適用し、アプリケーションの `pending` とは混ぜない
- [ ] フォーム送信で submitter、同名フィールド、GET query、`enctype`、他のフィールドと同名の submit control を失わない
- [ ] `data-partial` / `data-fragment` のないフォームは傍受しない。応答の検証に失敗した場合は通常送信へフォールバックする
- [ ] replace では focus とスクロールを復元し、append/prepend では focus を奪わない。View Transitions がなければ DOM を直接変更する

## 10.4 Workers デモ

- [ ] Workerd + D1 テストで、Cookie 単位のユーザ分離、カート version の競合、在庫切れの拒否、snapshot の非漏洩、キャッシュヘッダを確認する
- [ ] JavaScript 有効時に、Playwright で絞り込み・ページング・部分遷移・カートの楽観更新・戻る/進む・模擬チェックアウトが動く
- [ ] JavaScript 無効時に、通常の HTML とフォームだけで商品閲覧・カート追加・模擬チェックアウトが動く
- [ ] Wrangler の binding 型が最新で、本番ビルドと `wrangler deploy --dry-run` が成功する。実デプロイは行わない

## 10.5 品質ゲート

- [ ] 全体のカバレッジが statements / lines / functions で 95% 以上、branches で 90% 以上
- [ ] キャッシュ漏洩、ミドルウェア境界、Store、Fragment URL と結果配布、client-only 到達検査の各ファイルは、すべてのカバレッジ指標で 100%
- [ ] Node 24 Active LTS のベンチマーク中央値が、保存済み baseline から 20% を超えて悪化しない
- [ ] gzip サイズが client 12 KiB、server 7 KiB、Vite plugin 5 KiB を超えない
- [ ] `vp run ci:quality`、デモの統合テスト、Playwright が成功する
- [ ] lockfile を確定する直前に、安定版の依存バージョンを registry と照合する

## 10.6 Deno と JSR

- [ ] Deno 2.9 以降で、Hono の generics を保ったまま、フル HTML、Partial、Fragment、Store snapshot、キャッシュ契約を型検査・実行する
- [ ] DOM がなくても `zogan/client` を import でき、3 つの公開エントリすべてが `deno check` を通る
- [ ] pack した npm tarball を一時的な Deno consumer から import・型検査・実行できる
- [ ] npm と JSR の manifest で version と公開エントリが一致し、JSR にはソース、README、LICENSE だけが含まれる
- [ ] 文書化した Hono module augmentation の制約下で、`deno publish --dry-run` と documentation lint が通る
- [ ] Deno サンプルを Vite でビルドでき、ブラウザ bundle に Node 専用 import が含まれず、フルページ・Partial・asset のリクエストと JavaScript 有効/無効の Playwright が通る
- [ ] `vp run ci:deno` が `vp run ci:quality` とは独立して成功する

特に危険なのは、ユーザ間の状態漏洩、snapshot のキャッシュ、古い書き込みの受理、リダイレクト本文の挿入です。近くの helper の単体テストで代用せず、実際に事故が起きる境界へ回帰テストを置くこと。
