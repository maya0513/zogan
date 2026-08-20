# 設計判断

この文書は、zogan vNext の公開契約を決めた理由を記録する。正確な規範は[仕様書](spec/README.md)と公開型である。

## 互換性を捨てて契約を縮小する

zogan は `0.0.0` であり、旧 API の利用者を移行させるより、誤った抽象を残さないことを優先した。`Partial`、Store、soft navigation、フォーム傍受、独自通信ヘッダー、Hono の prototype／型拡張を削除し、alias、shim、deprecated export は設けない。

旧設計は、クライアントとサーバーが Partial 名、現在の DOM 形状、保存状態、履歴、独自ヘッダーを同時に理解する必要があった。どれか一つが deploy の前後でずれると、古い DOM と新しい応答を混ぜたページを成立させ得る。vNext は契約をなくすのではなく、明示した Fragment と Island の局所境界に閉じ込める。

## ブラウザが文書を所有する

通常の link、form、history、head、scroll、focus はブラウザに任せる。zogan の client runtime は document の `click`、`submit`、`popstate` を監視しない。mutation の正本は通常フォームと PRG、またはアプリケーションが明示して所有する API である。

この境界を保つ判断基準は次の二文である。

1. zogan の JavaScript を外しても page、link、form は正しく動き、失われるのは明示的に遅延した鮮度と Island の対話性だけである。
2. client と server の版がずれても、失敗は局所的な SSR／fallback 維持で閉じ、URL、mutation、global state、別領域を壊さない。

履歴の横取り、任意 target、OOB swap、複数領域 transaction、server action、library-owned optimistic Store を追加する提案は、この判断を変更して full framework になるかを先に ADR で決めなければならない。

## Hono を拡張しない Response factory

`createZogan({ layout })` は stateless な `page()` と `fragment()` を返す。アプリケーションは通常の `app.get()` で URL を登録し、Hono の `Context` と VNode を helper へ渡す。zogan は route を登録せず、Hono の prototype、module augmentation、request field、global registry を変更しない。

`page()` は layout と doctype を適用した完全な HTML document を返す。`fragment()` は明示的な別 URL から wrapper の inner HTML だけを返す。同じ URL を要求ヘッダーで document と fragment に切り替えないため、`Vary` を伴う独自 representation negotiation は存在しない。

## Cache Policy を値として必須化する

すべての `page()`／`fragment()` 呼び出しは branded `CachePolicy` を必須とする。共有可能な応答は `publicCache()`、利用者固有または判断に迷う応答は `privateNoStore()`、追加 directive が必要な場合だけ検証付き `cachePolicy()` を使う。

ポリシーは `Cache-Control` と任意の `Vary` token を生成する。duration、空値、HTTP field-valueに使えない文字、HTTP field-name でない `Vary` は生成前に拒否し、既存の `Vary` は大小文字を区別せず merge する。zogan はデータ依存を推測できないため、公開キャッシュにしてよいかという最終判断は handler の所有者に残す。

## Fragment は明示的な read-only HTML include

`FragmentSlot` の `src` は root-relative な同一 origin の GET URL である。URL はアプリケーションが route として所有し、server は通常の `text/html` と標準キャッシュヘッダーを返す。opaque な endpoint、暗号化 props、独自 request／response header、server 指定の target や swap command は作らない。

runtime が所有するのは wrapper の子だけである。同じ URL の処理中 fetch は共有するが、結果は永続 cache せず、各slotは一度だけ取得する。redirect、非 2xx、非 HTML、network error、古い応答、削除済み target、不正 URL／container、予約済み`data-zogan-*`属性を含むresponseではDOMを変更せずfallbackを残す。

`FragmentElement` は安全に contextual parse でき、子を持てる HTML container の閉じた集合である。table／select 系は専用 context で parse し、document root、void、raw-text、template、embedded content、SVG／MathML は拒否する。

Fragment は「契約がない」のではない。URL、GET、HTML、cache policy、wrapper ownership という小さく可視な remote include 契約であり、安全性はその狭さと fallback によって得る。

## Island は型付き descriptor と lazy module の組である

通常 Island は `defineIsland({ id, component })` で同じ Preact component を SSR と hydrate に使う。client-only Island は `defineClientIsland({ id, fallback })` で意味のある fallback を SSR し、client module を load できたときだけ mount で置換する。`Island` は descriptor から props 型を保持し、props を有限数・plain object・配列だけからなる厳格な JSON object に限定する。

Vite plugin は `islandsDir` 直下の `.tsx` filename stem を stable ID とし、Island ごとの `() => import(...)` loader を生成する。初期 entry は Island implementation を static import せず、trigger に到達した ID だけを load する。通常 Island module は SSR-safe、`"use client-only"` または明示 glob の module は server graph から到達不能でなければならない。

Fragment と Island は一つのnodeを二重所有しない。Fragment responseはFragmentSlot／Islandを含めず、Islandの内側にもFragmentSlot／別Islandを置けないため、これらはserver renderで拒否する。通常Page上のFragmentSlot childrenはserver側のowner scopeではないためnestを描画できるが、browser runtimeはnested ownerをfail closedにする。staleまたは改変markupも同様に拒否する。

## deploy skew は局所的に fail closed する

旧 HTML と新しい asset が混在する可能性は消えない。Island ID／props schema を破壊的に変える場合は ID も変え、content-hashed chunk を使い、HTML の最大 TTL 以上は旧 asset を保持する。loader、module、props、hydrate が失敗した場合、runtime は既存 SSR を残す。

Fragment route の削除や意味変更にも互換期間を設ける。認証切れを login page の `200 text/html` として返すと slot に挿入できてしまうため、fragment route は redirect または非 2xx で失敗を明示する。CSS は shell で先に利用可能にするか、Island chunk と同じ寿命で配信する。

## 公開 entry と依存を狭くする

公開entryは`zogan`、`zogan/client`、`zogan/fragments`、`zogan/vite`の四つである。Island runtimeは`start`、opt-in Fragment runtimeは`startFragments`だけを公開し、いずれもroot-scopedなdispose handleを返す。serverのvalue exportはresponse／cache／Fragment／Islandの八つ、Viteはnamed/defaultの`zoganVite`だけである。

`hono` と `preact` は peer dependency、`preact-render-to-string` は内部 runtime dependency、Vite 8 は optional peer とする。library-owned Store の削除に伴い Signals を除去し、client-only 判定から lexer の直接依存も除去した。

## サンプルは progressive enhancement の受け入れ仕様である

Workers + D1 shop はnative filter／pagination／form／PRGを正本とする。cart badgeとstockは一度だけ読む明示的Fragment、AddToCartだけがtyped Islandである。Islandのmutationはアプリケーション固有JSON APIを呼び、成功確認後は完全Pageへ遷移する。POST dispatch後の通信失敗ではnative formを自動再送せず、reloadを促して停止する。

Denoコードサンプルは、nativeなPage、明示的なFragment、cache policy、typed Islandを使うHono/PreactコードとDenoテストを提供する。公開サイトやbrowser E2Eは持たない。

## 品質ゲート

Vite+ を task、format、lint、type check、Vitest の単一入口とする。lint は type-aware と full type checking を有効にし、warnings と未使用 disable を error にする。correctness、nursery、pedantic、performance、suspicious と、import 境界、Promise、accessibility、React/Preact hook、test の全利用可能 plugin を有効にする。相互に矛盾する restriction や formatter と重複する style rule は category ごと一括適用せず、意味のある強い rule を明示する。

coverage は全体閾値に加えて CachePolicy、response factory、Fragment runtime、Vite graph／entry にファイル単位の閾値を置く。benchmark は Node 24 で page render、fragment render、Fragment fan-out、lazy Island discovery を測る。package check は gzip budget、publint、Are The Types Wrong、全 entry の runtime／type import、公開 export allowlist を検証する。

## 配布と deploy

npm と JSR は同じ四 entry を公開する。Hono module augmentation を削除したため、JSR の `--allow-slow-types` は不要である。Deno source、npm tarball、Node current、Chromium、Workerd、Vite production build を独立した gate で検証する。

Cloudflare の紹介サイトと Shop は別 deploy 単位とする。Deno は公開サイトではなく、コードサンプルとDenoテストとして配布する。rolling deploy では cache された HTML と content-hashed asset の保持期間を揃え、deploy convenience のために runtime の ownership を広げない。
