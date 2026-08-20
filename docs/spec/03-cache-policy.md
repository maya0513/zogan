# §3 Cache policy

## 3.1 必須のopaque値

`Zogan.page()` と `Zogan.fragment()` は、どちらも `{ cache: CachePolicy }` を必須とする。文字列を直接渡せないため、次のfactoryのいずれかで作る。

```ts
import { cachePolicy, privateNoStore, publicCache } from "zogan";
```

| factory | 用途 | 出力例 |
|---|---|---|
| `publicCache(options?)` | browser/shared cacheへ保存できるHTML | `public, max-age=0, s-maxage=60` |
| `privateNoStore(options?)` | ユーザ固有・保存禁止HTML | `private, no-store` |
| `cachePolicy(value, options?)` | typed helperにないdirectiveのescape hatch | 指定文字列をtrimした値 |

`CachePolicy` のbrandはprivateである。object literalやunchecked stringから作れない。

## 3.2 `publicCache`

```ts
publicCache({
  maxAge: 0,
  sMaxAge: 300,
  staleWhileRevalidate: 30,
  immutable: false,
  vary: ["Accept-Encoding"],
});
```

directive順は次で固定する。

1. `public`
2. `max-age`。省略時も `0`
3. `s-maxage`。指定時のみ
4. `stale-while-revalidate`。指定時のみ
5. `immutable`。`true` の場合のみ

durationは有限の非負整数だけを受け付ける。負数、小数、`NaN`、infinityは例外になる。

## 3.3 `privateNoStore` とescape hatch

ユーザ固有HTMLの既定は次である。

```ts
privateNoStore({ vary: ["Cookie"] });
// Cache-Control: private, no-store
// Vary: Cookie
```

`cachePolicy()` は空文字とHTTP field-valueに使えない文字を拒否する。HTAB、visible ASCII、obs-textだけを許可し、C0制御文字（HTABを除く）、DEL、U+00FFを超えるcode pointは生成時に失敗する。directiveの意味までは解釈しないため、利用者が値全体に責任を持つ。

## 3.4 `Vary`

`vary` はHTTP field-name tokenの配列である。

- 空、空白、commaを含む値、CR/LFを拒否する。
- 大文字小文字を区別せず重複を除く。
- 既に `Context` responseへ設定された `Vary` を失わない。
- 先に現れた表記と順序を保つ。
- どちらかに `*` があれば結果は `*`。
- tokenが0件なら新しい `Vary` headerを付けない。

## 3.5 response生成

pageとFragmentの両方で次を行う。

- `Content-Type: text/html; charset=utf-8`
- policy由来の `Cache-Control`
- merge後に値があれば `Vary`
- Hono `Context` に設定済みのstatusと他headerを維持

pageだけがlayoutと `<!DOCTYPE html>` を加える。FragmentはVNodeをraw HTMLとしてrenderする。

## 3.6 cache decision

| 内容 | 推奨policy |
|---|---|
| 全ユーザに同じpage shell | `publicCache({ sMaxAge: … })` |
| Cookie/session依存Fragment | `privateNoStore({ vary: ["Cookie"] })` |
| 短TTLで全ユーザ共通の在庫表示 | `publicCache({ sMaxAge: … })` |
| login後のaccount page | `privateNoStore({ vary: ["Cookie"] })` |

`Vary: Cookie` をpublic shared cacheへ付けるとcache keyが過剰に分裂しやすい。個人化responseは原則 `private, no-store` にする。

## 3.7 守れないこと

zoganはHTML本文を検査してpersonal dataを見つけない。また実際のCDN挙動を制御しない。次はapplicationの受け入れテストで守る。

- public pageにCookie由来の値が入っていない
- private Fragmentが他ユーザへ再利用されない
- proxyが `Cache-Control` / `Vary` を削除しない
- Fragment URLが意図したcache cardinalityを持つ
