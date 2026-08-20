# §0 用語

## 0.1 中核語彙

| 語 | 意味 |
|---|---|
| **page** | layoutとdoctypeを含む完全なHTML document。`Zogan.page()` が生成する |
| **Fragment** | 独立した同一origin URLから取得する、埋め込み用のHTML表現 |
| **Fragment endpoint** | `Zogan.fragment()` でHTMLを返す通常のHono route。route登録はアプリの責務 |
| **FragmentSlot** | Fragmentの取得URL、trigger、server fallbackを持つ置換コンテナ |
| **remote include** | ブラウザが別URLのHTMLを取得し、既存documentの局所へ挿入すること |
| **Island** | serverが描画した局所DOMを、lazyに読み込んだPreact componentでhydrateまたはmountする境界 |
| **Island descriptor** | 安定ID、mode、props型、server componentまたはfallbackを結び付ける値 |
| **hydrate mode** | server DOMを残したままPreact event処理を接続するmode |
| **mount mode** | server fallbackを消し、client componentを新規renderするmode |
| **trigger** | Fragmentの取得またはIslandの起動を開始する契機 |
| **fallback** | JavaScript実行前から存在し、失敗時にも残す意味のあるserver HTML |
| **shell** | 複数ユーザへ共有できるpage部分。ユーザ固有箇所は別URLのFragmentへ分離する |
| **CachePolicy** | responseの `Cache-Control` と追加する `Vary` tokenを保持するopaque値 |
| **Island loader** | `Promise<{ default: ComponentType }>` を返すID単位のdynamic import関数 |
| **marker protocol** | serverとclientが共有する `data-zogan-*` 属性の意味 |
| **version skew** | キャッシュ済みHTML、client asset、server endpointが異なるdeploy世代になる状態 |
| **client-only module** | SSR module graphから到達してはならないと明示されたmodule |

## 0.2 パッケージ境界

| import | 役割 | browser globalへのimport時アクセス |
|---|---|---|
| `zogan` | response helper、cache policy、`FragmentSlot`、Island descriptorとSSR | なし |
| `zogan/client` | Island用`start`、runtime handle、loader型 | なし。`start()` 後にだけDOMへアクセス |
| `zogan/fragments` | Fragment用`startFragments`とruntime handle | なし。`startFragments()` 後にだけDOMへアクセス |
| `zogan/vite` | Island client entry生成とenvironment境界検査 | なし。Vite/Node用 |

browser entry自体はimport時にDOMへ触れないため、universal moduleから型をimportしてserverで評価できる。ただしserver routeで `start()` / `startFragments()` を実行しない。top-level browser accessやbrowser専用dependencyのためSSRで安全に評価できないapplication moduleはclient-onlyとして明示し、SSR graphから到達させない。

## 0.3 「局所」の意味

局所とは、単にDOMの一部分という意味ではない。次の責務が、そのmarkerを持つ要素とURLまたはIDの組へ閉じていることを指す。

- 取得またはmodule loadを開始するtrigger
- server fallback
- 更新対象
- cache boundary
- 失敗時の挙動

ページ遷移、履歴、document全体のloading状態はこの局所契約に含めない。
