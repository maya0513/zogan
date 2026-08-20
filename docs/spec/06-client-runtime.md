# §6 Client runtime

## 6.1 公開surface

`zogan/client` のruntime value exportは2つだけである。

```ts
import { refreshFragment, start } from "zogan/client";
```

- `start(options?)`: initial documentの明示markerを1回scanする。
- `refreshFragment(src)`: marker値が完全一致するslotを明示的に更新する。

module importだけではDOMへ触れない。DOMのないserver/Deno環境でもimportできる。

## 6.2 `start`

```ts
interface StartOptions {
  readonly islands?: Readonly<Record<string, IslandLoader>>;
}
```

`start()` は次の順に行う。

1. loader mapを登録する。
2. `document.documentElement` 以下のFragment markerをscanする。
3. 同じ範囲のIsland markerをscanする。

2回目の呼び出しは警告して無視する。module scriptはdocument parse後に実行される配置にする。

runtimeは一般的なDOM mutation observerではない。initial documentと、Fragmentによって新しく挿入されたnodesだけをscanする。applicationが任意に後付けしたmarkerを起動する公開scannerはない。

runtime外からmarker elementをmove/removeしてlifecycleを管理する用途も対象外である。async callbackが到着すれば接続・owner・marker snapshot guardで適用を止めるが、任意の外部DOM操作をcleanup通知としてobserveはしない。

## 6.3 native browser behavior

runtimeは次のlistenerを登録しない。

- document `click`
- document `submit`
- window `popstate`
- window `pageshow`

したがってanchor、form、back/forward、reload、redirect、download、external navigationはbrowserの標準動作である。mutation routeではPost/Redirect/Getを使い、必要な局所再取得だけをapplication eventから `refreshFragment()` で呼ぶ。

Island自身が所有するformへ局所的なsubmit handlerを付けることはできる。その場合もSSR fallbackの`action` / `method`とserver routeを完成させ、Island失敗時はnative submitが成立するようにする。これはzogan runtimeによるdocument-wide interceptionではない。

zoganはURL bar、history state、document title、head、scroll、focusを更新しない。BFCacheからの復帰時にも自動refreshしない。applicationが最新値を必要とする場合は、自身の`pageshow` handlerから対象URLの`refreshFragment()`を明示的に呼ぶ。

## 6.4 trigger scheduler

FragmentとIslandは共通schedulerを使う。

| trigger | browser primitive | cleanup |
|---|---|---|
| `load` | 即時call | なし |
| `idle` | `requestIdleCallback` またはtimer | idle callback / timerをcancel |
| `visible` | `IntersectionObserver` | observerをdisconnect |
| `media:QUERY` | `matchMedia` change listener | listenerをremove |
| `manual` | scheduleしない | なし。Fragmentのみ |

各triggerは1回だけ発火する。target subtreeを置換する前にpending cleanupを実行する。必要なbrowser APIが存在しない場合は、別triggerへ勝手に変更せずfallbackを維持する。

## 6.5 Fragment runtime

Fragment取得では、URL、redirect、status、content typeをDOM変更前に検査する。同一の正規化済みURLは進行中requestを共有する。

automatic triggerはscan時の `src` を対象にする。`refreshFragment(src)` は現在のdocumentからraw marker値が `src` と完全一致する全slotを探す。いずれもIslandが所有するsubtreeと、正規化srcがancestor Fragmentと一致するinclude cycleをskipし、対応containerでないmarkerはfetch前に拒否する。

response適用時はgeneration、document接続、現在のsrc/trigger marker、予約attribute allowlist、Island owner不在、ancestor source cycle不在を再確認する。古いresponse、削除済みtarget、marker変更済みelement、未知の`data-zogan-*`が追加されたelement、待機中にIsland/cycle配下へ移動したelementを更新しない。

置換範囲の古いIsland/Fragmentをdisposeし、childrenを置換してから、挿入範囲だけを再scanする。page全体を毎回scanしない。

## 6.6 Island runtime

Island loaderはtrigger発火後にだけ呼ぶ。ID単位でmodule Promiseをmemoizeし、default exportがPreact componentであることを検査する。module待機後にもowner、予約attribute allowlist、ID/mode/trigger/raw propsのsnapshotを再確認し、別Islandのsubtreeへ移動したtarget、未知の`data-zogan-*`が追加されたtarget、marker変更済みtargetを起動しない。

`hydrate` はserver childrenをPreactへ接続する。`mount` はserver fallbackを消してclient componentをrenderする。activation前のchildrenをcloneしておき、同期的なrender failureでは復元する。

`div`以外のwrapper、不正ID、欠落loader、欠落・壊れたprops、欠落・未知mode、欠落・未知trigger、module failure、削除済みtargetではserver DOMを維持する。wrapperとIDをloader lookup前に検証し、propsはparse後も全nested valueをfinite JSONとして再帰検証する。

## 6.7 concurrency model

runtimeが持つのは、局所的な短命stateだけである。

- URLごとのin-flight Fragment Promise
- IDごとのIsland module Promise
- elementごとのclaim、generation、activation token
- pending trigger cleanup

application data、current route、form state、history snapshotは持たない。Fragment responseの永続cacheも持たない。

network requestはgenerationが無効になっても継続しうる。generation checkがDOMへの古い適用を防ぐ。timeout、自動retry、backoffは実装しない。

## 6.8 `refreshFragment`

```ts
declare function refreshFragment(src: string): Promise<void>;
```

用途は、applicationが知っているmutationや外部eventの後に、既にpageへ宣言されたslotを再取得することである。

```ts
await addToCart(sku);
await refreshFragment("/fragments/cart-badge");
```

対象となるtargetが0件なら警告してresolveする。Island subtreeのmarkerは対象に数えない。複数targetがあれば1 responseを全targetへ適用する。関数自身は任意DOM selector、HTTP method、request body、swap modeを受け取らない。
