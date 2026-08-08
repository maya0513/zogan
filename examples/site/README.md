# zogan introduction site

The static introduction site explains zogan's purpose, rendering model, safety boundary, and first setup. It is intentionally separate from the Workers + D1 application in `examples/shop`.

```sh
pnpm --filter @zogan/site dev
pnpm --filter @zogan/site build
pnpm --filter @zogan/site e2e
pnpm --filter @zogan/site deploy:dry
```

The production build is emitted to `examples/site/dist` and uses relative asset URLs so it can be hosted below a subpath.
Production is deployed as the `zogan` Cloudflare Worker using Workers Static Assets. See the [deployment guide](../../docs/deployment.md) for GitHub Actions setup.
