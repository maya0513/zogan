# §9 References

## 9.1 参照した系譜

| Project | 参照点 | zoganとの違い |
|---|---|---|
| [Fresh Partials](https://usefresh.dev/docs/advanced/partials) / [Islands](https://usefresh.dev/docs/concepts/islands) | server rendering、island単位のclient activation、HTML fallback | zoganはpage navigationを置換せず、Fragmentを独立URLのremote includeとしてだけ扱う。 |
| [Astro server islands](https://docs.astro.build/en/guides/server-islands/) | cache可能なshellと遅延server contentのhole、fallback | zoganはserver-side compositionや暗号化props transportを提供せず、browserが明示URLを取得する。 |
| [mizchi/sol（現luna.mbt monorepo）](https://github.com/mizchi/luna.mbt) | server-first、client boundaryのbuild-time分離、lazy entry | zoganはHono/Preact向けの小さなlibraryで、compiler/framework全体を所有しない。 |
| [mizchiの設計メモ](https://gist.github.com/mizchi/f13383bd33a4b1156249afd12edcbd6e) | 暗黙契約と時間的結合への警戒 | zoganは契約を消したとは主張せず、marker・URL・cache・asset互換性を可視化して局所化する。 |
| [htmx](https://htmx.org/docs/) | server HTMLを局所DOMへ反映する考え方 | zoganの宣言はFragmentSlotだけで、一般的なrequest/swap DSLを持たない。 |
| [Turbo Drive](https://turbo.hotwired.dev/handbook/drive) | server HTMLとprogressive enhancement | zoganはdocument navigation、form submission、historyを横取りしない。 |
| [Inertia protocol](https://inertiajs.com/docs/v3/core-concepts/the-protocol) | server/client間protocolが持つversion skewの教訓 | zoganはpage objectやclient-side routing protocolを持たず、通常のHTML responseを正本にする。 |

参照は設計の出典であって互換性の宣言ではない。それぞれのattribute、header、routing、lifecycle contractをzoganへ持ち込まない。

## 9.2 採用しなかった設計

旧zoganおよび比較対象から、次をvNextへ継承しない。

- Fresh風の`Partial` region、comment marker、region mode、および`soft-nav`/ソフトナビゲーション。
- client `Store`、snapshot、signal bridge、navigationをまたぐpreserve機構。
- `X-Partial`などのcustom headersで同一URLのpage/fragment表現を切り替えるresponse negotiation。
- document-wideなlink/form interceptionとhistory/popstate orchestration。
- Inertia型のpage object、hidden RPC、component nameからpageを復元するclient router。
- Astro server islands型のserver-side deferred compositionや暗号化props payload。
- htmx/Turbo型の汎用attribute language、任意swap target、global navigation lifecycle。

これらを互換shimとして復活させない。必要なapplicationはbrowser標準、Hono route、または別libraryを明示的に組み合わせる。

## 9.3 取り入れた原則

- SSR HTMLをfailure時にも意味のあるauthoritative UIにする。
- client codeは明示されたIsland boundaryへ限定し、activationまで個別chunkをloadしない。
- personalizationはpublic shellからprivate Fragment URLへ分離する。
- HTML fragment取得はmarkerに書かれたsame-origin URLだけに限定する。
- build graphでclient-only boundaryを検査する。
- protocolを隠すのでなく、[markup contract](./appendix-b-markup.md)と[failure mode](./07-failure-modes.md)として短く固定する。

## 9.4 比較するときの注意

zoganの強みは機能量ではなく、所有範囲の狭さである。page navigationはbrowser、routingと認証はapplication/Hono、DOMの局所置換だけをclient runtime、component reconciliationだけをPreactが所有する。

一方、remote includeである以上、次の契約は残る。

- page markerとFragment endpoint URL
- wrapper elementと返却HTMLのparse context
- cache policyとユーザー分離
- Island ID、props JSON、mode、trigger、lazy chunk
- 古いpageと新しいendpoint/assetが共存するdeploy window

したがって「server/client間の契約がゼロ」「version skewが起きない」と説明してはならない。zoganが提供するのは、page全体に広がる時間的契約を、検査可能なlocal markerと明示URLへ縮小することである。
