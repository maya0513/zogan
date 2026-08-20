# §6 Client runtime

## 6.1 公開surface

browser runtimeは責務ごとに別entryである。

```ts
import { start } from "zogan/client";
import { startFragments } from "zogan/fragments";

const islands = start({ islands: loaders, root: document.documentElement });
const fragments = startFragments({ root: document.documentElement });

islands.dispose();
fragments.dispose();
```

- `zogan/client` の `start()` はIslandだけを起動する。
- `zogan/fragments` の `startFragments()` はFragmentだけを取得する。
- 両方とも指定rootを一度scanし、そのrootだけを所有するdispose handleを返す。
- `root`の既定値は`document.documentElement`である。

module importだけではDOMへ触れない。DOMのないserver/Deno環境でもimportできる。呼び出し時にdocumentがなく、rootも与えられなければ例外にする。

## 6.2 rootとlifecycle

runtimeはmodule-globalなdocument singletonではない。互いに重ならないrootへ複数instanceを開始できる。各instanceは開始時に存在するmarkerだけをscanし、`MutationObserver`や公開rescan APIを持たない。

`dispose()`はpending triggerと所有するPreact rootを停止し、runtimeが置換または起動した領域を開始前のserver fallbackへ戻す。dispose後に到着したnetwork/module結果はDOMへ適用しない。同じhandleを複数回disposeしても安全である。

同じmarkerを複数runtimeで同時に所有する使い方はcontract外である。Viteの`virtual:zogan/islands`は開始済みruntimeを`runtime`としてexportするので、applicationはそのhandleをlifecycleへ組み込める。

## 6.3 native browser behavior

どちらのruntimeもdocumentの`click` / `submit`、windowの`popstate` / `pageshow`をlistenしない。anchor、form、back/forward、reload、redirect、download、external navigationはbrowserの標準動作である。

mutation後に別のserver表現と同期したい場合は通常のPageへnavigateする。Island自身が所有するformへ局所的なsubmit handlerを付ける場合も、SSR fallbackの`action` / `method`とserver routeを完成させ、失敗時にnative submitが成立するようにする。

zoganはURL bar、history state、document title、head、scroll、focusを更新しない。BFCacheからの復帰時にも自動取得しない。

## 6.4 trigger scheduler

FragmentとIslandは同じtrigger vocabularyを使う。

| trigger | browser primitive | cleanup |
|---|---|---|
| `load` | 即時call | なし |
| `idle` | `requestIdleCallback` またはtimer | idle callback / timerをcancel |
| `visible` | `IntersectionObserver` | observerをdisconnect |
| `media:QUERY` | `matchMedia` change listener | listenerをremove |

triggerは一度だけ発火する。必要なbrowser APIがなければ別triggerへ変更せずfallbackを維持する。imperative refresh、manual trigger、retry、pollingは提供しない。

## 6.5 Fragment runtime

Fragment runtimeはURL、protocol marker、予約attribute、wrapper、ownership、redirect、status、content typeをDOM変更前に検査する。同じruntime内の同一absolute URLは、進行中requestだけを共有する。

response適用時は接続、runtime token、src/trigger/protocol snapshot、予約attribute、ownerを再確認する。古いresponse、削除済みtarget、marker変更済みelement、未知の`data-zogan-*`が追加されたelement、待機中に別boundary配下へ移動したelementを更新しない。

Fragment responseにFragmentまたはIsland markerがあればresponse全体を拒否する。wrapper elementは残し、childrenだけをcontextual parserで一度置換する。挿入した内容を再scanしない。

## 6.6 Island runtime

Island loaderはtrigger発火後にだけ呼ぶ。runtimeごとにID単位でmodule Promiseをmemoizeし、default exportがPreact componentであることを検査する。module待機後にもowner、protocol、予約attribute、ID/mode/trigger/raw propsのsnapshotを再確認する。

`hydrate` はserver childrenをPreactへ接続する。`mount` はserver fallbackを消してclient componentをrenderする。activation前のchildrenをcloneし、同期的なrender failureまたはdisposeでは復元する。

`div`以外のwrapper、不正ID、欠落loader、欠落・壊れたprops、欠落・未知mode、欠落・未知trigger、module failure、削除済みtargetではserver DOMを維持する。Island内のFragmentとnested Islandは拒否する。

## 6.7 protocolとstate

serverはすべてのFragment/Island markerに`data-zogan-protocol="1"`を出す。clientはexact versionを要求し、欠落または不一致ならfallbackを維持する。boundaryごとの予約attribute allowlistもexactである。

runtimeが持つのは局所的な短命stateだけである。

- URLごとのin-flight Fragment Promise
- IDごとのIsland module Promise
- elementごとのclaim、activation token、開始前fallback
- pending trigger cleanup

application data、current route、form state、history snapshot、Fragment responseの永続cacheは持たない。request timeout、abort、自動retry、backoffも実装しない。
