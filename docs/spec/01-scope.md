# §1 スコープ

## 1.1 提供するもの

zogan は次の3境界だけを提供する。

1. Hono `Context` とPreact `VNode` から、cache policy付きのpageまたはFragment responseを作る。
2. server HTMLへ `FragmentSlot` と型付き `Island` markerを出力する。
3. browserでopt-inしたruntimeごとに明示markerだけをscanし、one-shot Fragment取得またはIsland起動を行う。

Vite integrationを使う場合は、さらに次を提供する。

- `islandsDir` 直下の `*.tsx` をID別dynamic importへ変換するclient entry
- client-onlyのSSR到達とserver-onlyのclient到達に対するbuild-time診断

## 1.2 提供しないもの

- client router、route tree、route loader
- link click、form submit、browser historyの代行
- page全体のDOM差し替え、head merge、scroll/focus復元
- application state container、楽観更新、server data同期
- action/RPC abstraction、request mutation protocol
- authentication、authorization、CSRF対策
- CDN、response cache、revalidation daemon
- HTML sanitization
- polling、prefetch、streaming、push更新
- nested Island ownership
- Fragment response内のFragment／Island境界
- arbitrary SVG/MathML/template/custom-element contextへのFragment挿入

必要なbusiness stateはアプリが通常のserver route、Cookie、database、Island内部stateとして所有する。zogan module scopeへrequest固有値を置かない。

## 1.3 アプリ側の責務

| 責務 | 理由 |
|---|---|
| Hono routeを登録する | `createZogan()` はrouterを変更しない |
| page URLとFragment URLを分ける | 1 URL 1表現を守るため |
| 各responseへ正しい `CachePolicy` を選ぶ | zoganは内容がpublicかprivateか判断できない |
| public pageからユーザ固有値を除く | cache leakageはHTML生成時のデータ選択で決まる |
| Fragment responseをtrusted same-origin HTMLに限定する | client runtimeはsanitizerではない |
| link/formのnative経路を完成させる | JavaScriptがなくても操作可能にするため |
| mutation後に必要なら完全Pageへ遷移する | Fragment runtimeはapplication stateを同期しない |
| Island ID、filename、props schemaをdeploy間で管理する | runtimeにprotocol negotiationはない |

## 1.4 前提環境

- Hono `>=4.13 <5`
- Preact `>=10.29.8 <11`
- ESM
- Node.js `>=24.11` を開発・package基準とする
- Vite `^8` は `zogan/vite` を使う場合だけ必要
- Deno向けsource entryも同じ公開APIを持つ

`preact-render-to-string` は実装dependencyである。browser state libraryは前提にしない。

## 1.5 採用判断

zoganへ機能を追加する条件は、既存の局所境界をより明示し、安全にすることに限る。document全体の時間順序、server/client間の暗黙な共有状態、別表現を選ぶ隠れたrequest条件が増える変更は対象外である。
