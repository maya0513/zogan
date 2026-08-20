# §8 Acceptance

## 8.1 完了条件

release candidateは、次のcommandをすべてclean checkoutで通過しなければならない。

```sh
pnpm exec vp check
pnpm exec vp test run
pnpm exec vp test run --coverage
pnpm exec vp run build
pnpm exec vp run package:check
pnpm exec vp run demo:check
pnpm exec vp run ci:browser
pnpm exec vp run ci:deno
pnpm exec vp run ci:node-current
pnpm exec vp run deploy:check
pnpm exec vp run bench
pnpm exec vp run ci:quality
```

`ci:quality`はbuild、静的検査、coverage、package検査、site build、demo検査、benchmarkをまとめる。browser、Deno、current Node、deploy dry-runのmatrixは別途必須である。

## 8.2 contract test

### Server

- `page()`はdoctypeと任意layoutを含む完全documentを返す。
- `fragment()`はlayoutなしのHTMLだけを返す。
- 同じpage URLはenhancementを示唆するrequest metadataによって別表現へ変わらない。
- すべてのHTML responseに明示的な`Cache-Control`があり、既存statusとheaderを保つ。
- public shellにユーザー固有値がなく、private Fragmentを200並列・複数ユーザーで取得しても値が混ざらない。
- Honoのprototype、route登録、contextへ暗黙の変更を加えない。
- 不正なcache policy、Fragment marker、Island descriptor/propsをresponse生成前に拒否する。

### Client

- `start()`はdocumentの`click`/`submit`とwindowの`popstate`/`pageshow`をlistenしない。
- link、form、redirect、historyはJavaScriptなしでもnative semanticsを保つ。
- mutation routeはPost/Redirect/Getを使い、fixtureでは`303`を返す。
- SSRだけでlink、form、Fragment fallbackが利用できる。
- Fragmentのnetwork/status/media-type/redirect/parser前検証失敗で既存childrenを維持する。
- 同じURLの同時取得、複数slotへのfan-out、世代race、削除済みtarget、待機中のownership/marker/ancestor変更を検証する。
- direct A→A / indirect A→B→A include cycleをautomatic/manual双方で拒否し、same-src siblingと非循環A→Bは許可する。
- `tbody`、`tr`、`select`、`optgroup`を含むcontextual parsingを検証する。
- 差し替えられたsubtreeのpending workとPreact rootをdisposeし、新しいFragment/Islandだけをscanする。
- Island moduleはtrigger前にloadされず、同じIDのin-flight/successを共有し、rejection後はretryできる。
- `div`以外のIsland wrapper、不正ID、loader、再帰的finite JSON props、必須mode、必須trigger、待機中のID/mode/trigger/raw props変更、Preact activationの失敗でSSR/fallbackを維持する。
- 初めからIsland内にあるFragmentはautomatic/manualとも取得せず、取得開始後にIsland内へ移ったFragmentは反映しない。nested Islandもscan時/activate直前の双方で起動しない。同一elementのdual markerとboundary allowlist外の`data-zogan-*`は両runtimeがasync処理の前後で拒否する。

### Vite/package

- `zogan`、`zogan/client`、`zogan/vite`のruntime export名をexact allowlistで検査する。
- packed tarballを`publint`、`attw`、TypeScript smoke testへ通す。
- Vite pluginはIslandごとのdynamic importを生成し、初期entryへ静的に束ねない。
- plugin testはfilename stemの文字pattern、重複ID、Islandごとのloader生成を検査する。
- acceptance/runtime testはdescriptor IDとloader keyの一致、default component export、不一致時のfallback維持を検査する。pluginがdescriptor sourceまで照合したとは見なさない。
- SSR graphから明示的client-only moduleへのstatic/dynamic到達を、到達path付きで失敗させる。
- npmとJSRで3 entry pointの形を一致させ、browser bundleにNode runtimeを混入させない。

## 8.3 coverage gate

V8 coverageのglobal thresholdはstatements/lines/functionsが95%、branchesが90%である。さらに次をfile単位で固定する。

| File | Statements | Lines | Functions | Branches |
|---|---:|---:|---:|---:|
| `src/server/cache.ts` | 95% | 95% | 100% | 95% |
| `src/server/zogan.ts` | 100% | 100% | 100% | 100% |
| `src/client/fragments.ts` | 100% | 100% | 100% | 100% |
| `src/vite/client-only.ts` | 100% | 100% | 100% | 90% |
| `src/vite/islands-entry.ts` | 100% | 100% | 100% | 100% |

thresholdを下げる変更は、意図したcontract削除と同じreviewを必要とする。

## 8.4 size/performance gate

gzip後の公開entry budgetはclient 5 KiB、server 4 KiB、Vite 5 KiBである。`package:check`がbuild artifactを直接測る。

benchmarkはNode 24 baselineを使い、3 runそれぞれのmedianの中央を採用する。個別benchmarkがbaselineから20%を超えて遅くなれば失敗する。baselineを更新するときは環境、変更理由、profile結果をreviewする。

## 8.5 release review

自動検査に加え、release時に次を確認する。

1. cached pageの最大寿命より長く、対応するFragment endpoint、Island ID、content-hash chunkを残せるか。
2. Island props schemaを同じIDのまま非互換変更していないか。
3. public responseにsession/cookie由来HTMLが混入していないか。
4. 新しいruntime behaviorがglobal navigationまたはrequest-wide response negotiationを導入していないか。
5. 新しい公開surfaceが[Appendix A](./appendix-a-api.md)とpackage allowlistの両方へ反映されているか。
