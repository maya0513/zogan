# zogan introduction site

The static introduction site explains zogan's Cache, Page, Fragment, and Island boundaries, its browser-owned navigation and form baseline, and its first setup. It is intentionally separate from the Workers + D1 application in `examples/shop`.

```sh
pnpm exec vp run @zogan/site#dev
pnpm exec vp run @zogan/site#build
pnpm exec vp run @zogan/site#e2e
pnpm exec vp run @zogan/site#deploy:dry
```

The production build is emitted to `examples/site/dist` and uses relative asset URLs so it can be hosted below a subpath.
Production is deployed as the `zogan` Cloudflare Worker using Workers Static Assets.
