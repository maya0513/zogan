# 本番デプロイ

紹介サイトとショップデモはCloudflare Workersで動作します。Denoサンプルは、現在のDeno Deployプラットフォームで独立して動作します。3つのサービスはいずれも、`main`に対する`ci`ワークフローが成功した後、または明示的に手動実行した場合に限り、GitHub Actionsからデプロイされます。

## サービス

| サービス          | ソース          | デフォルトURL                                             | ランタイム                |
| ----------------- | --------------- | --------------------------------------------------------- | ------------------------- |
| `zogan`           | `examples/site` | `https://zogan.<workers-subdomain>.workers.dev`           | Workers Static Assets     |
| `zogan-shop-demo` | `examples/shop` | `https://zogan-shop-demo.<workers-subdomain>.workers.dev` | Worker, Static Assets, D1 |
| `zogan-deno`      | `examples/deno` | `https://zogan-deno.maya0513.deno.net`                    | Deno Deploy, dynamic      |

このリポジトリにはCloudflareの認証情報を含めません。また、`just ci`の一部としてローカルコマンドからデプロイされることもありません。

## デプロイの実行条件

`.github/workflows/deploy.yml`は、次のいずれかの場合に実行されます。

1. `main`へのプッシュを対象とした`ci`ワークフローが成功した場合
2. メンテナーがGitHub Actionsの**Run workflow**から手動実行した場合

Pull Requestからデプロイされることはありません。CIが失敗した場合もデプロイされません。ワークフローはCIを通過したものと同一のコミットをチェックアウトし、実行中の処理をキャンセルしない単一の本番同時実行グループを使用することで、複数リビジョンの競合を防ぎます。

各ジョブは、`production-introduction`、`production-demo`、`production-deno`という個別のGitHub Environmentを使用します。あるサービスのデプロイが失敗しても、別のサービスですでに公開されたリビジョンが巻き戻されることはありません。

## Cloudflareの初期設定

### 1. Workersサブドメインを有効にする

**Cloudflare Dashboard → Workers & Pages**を開き、アカウントの`workers.dev`サブドメインが有効でなければ有効にします。

### 2. 本番用D1データベースを作成する

ローカル環境で認証し、データベースを作成します。

```sh
pnpm --filter @zogan/shop exec wrangler login
pnpm --filter @zogan/shop exec wrangler d1 create zogan-shop
```

返されたUUIDを、`examples/shop/wrangler.jsonc`の`database_id`に設定します。D1のデータベースIDはリソースを識別する値であり、認証情報ではないため、Wrangler設定とともにバージョン管理します。すべて0のプレースホルダーが残った状態では先へ進まないでください。

リモートデータベースを一度だけ初期化します。

```sh
pnpm --filter @zogan/shop db:migrate:remote
pnpm --filter @zogan/shop db:seed:remote
```

`db:seed:remote`は初期データを投入するコマンドであり、デプロイコマンドではありません。再実行するとデモの商品行が置き換えられ、在庫数も初期値に戻ります。通常のデプロイでは、未適用のマイグレーションだけを適用します。

### 3. 権限を限定したAPIトークンを作成する

**Cloudflare Dashboard → My Profile → API Tokens**で、これらのWorkersを所有するアカウントだけを対象としたカスタムトークンを作成します。次の権限が必要です。

- **Account / Workers Scripts / Edit**：2つのWorkersをデプロイするため
- **Account / D1 / Edit**：本番マイグレーションを適用するため

後からWranglerでカスタムドメインのルートも管理する場合に限り、**Zone / Workers Routes / Edit**を追加します。現在の設定は`workers.dev`を使用するため、Zone権限は不要です。

### 4. GitHubのシークレットとEnvironmentを追加する

**GitHub repository → Settings → Secrets and variables → Actions**で、次のリポジトリシークレットを追加します。

- `CLOUDFLARE_API_TOKEN`：権限を限定したトークン
- `CLOUDFLARE_ACCOUNT_ID`：CloudflareのアカウントID

**Settings → Environments**で、次のEnvironmentを作成します。

- `production-introduction`
- `production-demo`

本番デプロイの前に承認を必須にしたい場合は、必須レビュアーまたはデプロイブランチ保護を設定します。シークレットをリポジトリシークレットではなく、同じ名前のEnvironmentシークレットとして両方のEnvironmentへ個別に保存しても構いません。

### 5. 設定をプッシュする

実際のD1 ID、ワークフロー、設定、ロックファイル、アプリケーションのファイルをコミットし、`main`へプッシュします。`ci`が成功すると、デプロイワークフローが2つのWorkersを公開します。最初のプッシュ後は、ワークフローを手動実行することもできます。

## ローカルでのデプロイ検証

デプロイAPIへ接続せずに、2つのアップロードバンドルを検証します。

```sh
just deploy-check
```

本番用D1 IDが設定されていることを検証します。

```sh
pnpm run deploy:validate
```

これらのコマンドが何かを公開することはありません。CIでは、両方のサイトに対して`wrangler deploy --dry-run`を実行します。

## カスタムドメイン

最初のデプロイでは、両方の`workers.dev` URLを有効なままにします。動作確認後、アプリケーションコードを変更せずにCloudflare Dashboardからカスタムドメインを割り当てられます。ドメインもコードで管理する場合は、それぞれのWrangler設定に明示的な`routes`を追加し、対象Zoneに限定した**Workers Routes / Edit**権限をAPIトークンへ追加してください。

## Deno Deployの初期設定

このリポジトリは、`console.deno.com`で提供される現在のプラットフォームを対象としています。Deploy Classicおよび`deployctl`は使用しません。

1. `console.deno.com`へサインインし、organization slug `maya0513`を作成または確認します。
2. application slug `zogan-deno`を作成します。ローカルのcloneからすべてのビルド設定を非対話で指定して作成する場合は、認証後に次のコマンドを実行します。

```sh
deno deploy create . \
  --json \
  --non-interactive \
  --org maya0513 \
  --app zogan-deno \
  --source local \
  --do-not-use-detected-build-config \
  --install-command "deno install --frozen --node-modules-dir=manual" \
  --build-command "deno task deno:example:build" \
  --runtime-mode dynamic \
  --entrypoint examples/deno/server.tsx \
  --build-timeout 5 \
  --build-memory-limit 1024 \
  --region global
```

以後は、リポジトリに含まれる`deno.json`をorganization、application、インストール、ビルド、動的ランタイム設定の正本とします。createコマンドは最初のデプロイも実行するため、applicationがまだ存在しない場合に限り実行してください。

3. organization設定で、`zogan-deno`のデプロイに必要な最小限の権限を持つorganization tokenを発行します。
4. GitHub repositoryにEnvironment `production-deno`を作成します。`DENO_DEPLOY_TOKEN`をEnvironmentシークレットとして追加し、必要に応じて必須レビュアーまたはデプロイブランチ保護を設定します。
5. 完成した変更を`main`へプッシュします。CIが成功すると、`.github/workflows/deploy.yml`がサンプルを再ビルドし、次のコマンドを実行します。

```sh
deno deploy --json --non-interactive --org maya0513 --app zogan-deno --prod
```

想定する本番URLは<https://zogan-deno.maya0513.deno.net>です。ローカルテスト、JSRのdry-run、サンプルのビルドではトークンを必要としません。
