# §7 Failure modes

## 7.1 基本方針

enhancement失敗時のauthoritative UIは、直前まで表示されていたserver HTMLである。runtimeは警告し、局所処理を止める。明示的なFragment取得をpage navigationへ変えたり、失敗したIslandを空にしたりしない。

## 7.2 Fragment

| 状況 | 検出 | 結果 |
|---|---|---|
| 不正・外部originの `src` | URL guard | fetchせずfallback維持 |
| 未対応wrapper | shared container guard | fetchせずfallback維持 |
| trigger欠落・不正、または必要なbrowser API不在 | trigger scheduler | fetchせずfallback維持 |
| network error | `fetch` catch | fallback維持 |
| manual/opaque/追跡済みredirect | response guard | fallback維持 |
| 2xx以外 | `Response.ok` | fallback維持 |
| HTML以外 | media type guard | fallback維持 |
| 同じURLの並行取得 | in-flight map | 1 requestへ集約 |
| targetがdispose/削除済み | generation / `isConnected` | responseを無視 |
| markerの`src` / triggerが変更済み | exact snapshot再検査 | responseを無視 |
| 待機中にIsland subtreeへ移動 | apply直前owner再検査 | responseを無視 |
| `refreshFragment` targetなし | document query | 警告してresolve |
| Fragment inside Island | owner guard | automatic/manualとも取得せずfallback維持 |
| direct/indirect include cycle | normalized ancestor-src guard | automatic/manualで取得せず、async適用前にもfallback維持 |
| 同一elementにFragment/Island両marker | dual-marker guard | 両方とも起動せずfallback維持 |
| wrapperに未知の`data-zogan-*` | reserved-attribute allowlist | fetch前・適用前ともfallback維持 |

取得成功後のHTMLはtrusted application outputとして扱う。sanitize failureという概念はなく、malicious same-origin HTMLを防ぐ機構ではない。

## 7.3 Island

| 状況 | 検出 | 結果 |
|---|---|---|
| loader未登録 | ID lookup | SSR/fallback維持 |
| wrapperが`div`でない | local-name guard | loaderを呼ばずSSR/fallback維持 |
| IDがpattern/64文字制限に違反 | ID guard | loader keyがあっても呼ばずSSR/fallback維持 |
| `data-zogan-props` 欠落・不正・非finite nested値 | strict recursive JSON guard | SSR/fallback維持 |
| mode欠落・不正 | `hydrate` / `mount` guard | SSR/fallback維持 |
| trigger欠落・不正・API不在 | scheduler | SSR/fallback維持 |
| module load失敗 | Promise rejection | SSR/fallback維持、module cacheを外す |
| default componentなし | module validation | SSR/fallback維持、後のinstanceでretry可能 |
| targetがdispose/削除済み | activation token / `isConnected` | module結果を無視 |
| 待機中に別Island subtreeへ移動 | activate直前owner再検査 | module結果を無視 |
| ID/mode/trigger/raw propsが変更済み | exact snapshot再検査 | module結果を無視 |
| Preact activation失敗 | try/catch + children snapshot | best-effort cleanup後にfallback復元 |
| nested Island | owner guard | innerを起動しない |
| 同一elementにFragment/Island両marker | dual-marker guard | 両方とも起動せずfallback維持 |
| wrapperに未知の`data-zogan-*` | reserved-attribute allowlist | loader前・activate前ともfallback維持 |
| dispose時のPreact error | try/catch | 警告し、runtime cleanupを継続 |

Viteの`islandsDir`が存在しない、または読めない場合は空loader mapになる。その結果は各Islandの「loader未登録」としてfallback維持になるが、設定ミスを自動的なbuild failureにはしない。

hydrate mismatchの詳細なreconciliationはPreactの責務である。server componentとclient default componentが同じpropsで同じ初期DOMを作ることをapplication testで確認する。

## 7.4 server API

次はresponse生成前に例外となる。

- 不正なIsland IDまたはcomponent
- JSONで表現できないIsland props
- 不正なIsland/Fragment trigger
- 不正なFragment `src`
- 未対応 `FragmentSlot.as`
- 予約済み `data-zogan-*` attributeの上書き
- 不正なcache duration、`Vary` token、raw cache string
- factoryで作られていない `CachePolicy`

server側のprogrammer errorをfallbackへ変換しない。deploy前のtestで発見する。

## 7.5 version skew

| 組み合わせ | runtimeの防御 | application guardrail |
|---|---|---|
| 古いpage / 新clientでIDが消えた | loaderなしとしてSSR維持 | 古いassetとIDをpage TTL中残す |
| 古いpage / 同じIDで新props schema | 自動検出できない | 新IDを発行、またはpage cacheをpurge |
| 古いpage / Fragment URL廃止 | fetch失敗でfallback維持 | endpointをTTL中残すかURL version化 |
| 新page / 古client | 欠落・未知reserved attributeは検出できる範囲でfallback維持。既知valueの意味変更は検出不能 | pageとassetを同じrelease unitで配信 |
| rolling deploy / lazy chunk削除 | module load失敗でfallback維持 | content-hash assetを猶予期間保持 |

現在のmarker protocolにはversion fieldやhandshakeがない。fail-closedは誤表示の範囲を狭めるが、互換性そのものを作らない。

## 7.6 残る弱点

- remote includeにはpage HTML、endpoint、runtimeの時間的な依存が残る。
- `load` Fragmentはpage表示後に追加round tripを発生させる。
- request timeout、abort、retry、response-size limit、persistent cacheはない。
- include cycle guardはancestorで繰り返すURLだけを止める。毎回異なるURLを生成する無限chainや最大nest depthは制限しない。
- `MutationObserver`を持たないため、runtime外でremoveされたpending markerのobserver/listener cleanupは保証しない。document navigationかFragment置換で所有範囲を終える。
- focus、scroll、announcementは自動管理しない。更新内容に応じたaccessibility対応はapplicationが行う。
- 同一origin HTMLを信頼するため、endpoint侵害時のDOM injectionを防がない。
- runtimeは同じIsland IDのprops schema差を検出できない。
- 別server moduleで同じIsland IDを重複定義しても横断検出できない。
- client-only検査は明示directive/globが前提で、分類されていないbrowser moduleを推測しない。

## 7.7 drift-back検知

次の回帰テストを削除してはならない。

- pageがrequest metadataによらず同じ完全documentを返す
- `start()` がdocument click、submit、window popstate listenerを登録しない
- formがnativeで、mutation routeが303 redirectを返す
- Fragment failureがfallbackを保持する
- same URL requestのdedupe、fan-out、generation race、removed target
- A→A / A→B→A cycle拒否と、same-src sibling / 非循環A→Bの許可
- Island moduleがtrigger前にloadされず、失敗時にfallbackを保持する
- public shellにユーザ固有値がなく、private Fragmentが並行ユーザ間で混ざらない
- SSR entryからclient-only moduleへstatic/dynamic到達するとbuildが失敗する

この一覧のどれかを「便利さ」のために反転すると、局所契約からpage-wideな強い契約へ戻る。
