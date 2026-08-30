# CardSwitch card / miles crawler (hosted in cf-static-sync)

Migrated from `CardSwitch/automation/github-crawler`.

## Local crawl (does not touch CardSwitch git)

```bash
cd tools/cardswitch-crawler
node --test crawler-parse.test.mjs

# Write into cf-static-sync/data/cardswitch, merge legacy from a local CardSwitch checkout
CRAWLER_OUTPUT_DIR=../../data/cardswitch \
CRAWLER_LEGACY_ROOT="../../../CardSwitch-main" \
  node run.mjs
```

## Publish to a CardSwitch checkout

```bash
CARDSWITCH_CRAWL_DIR=../../data/cardswitch \
CARDSWITCH_DIR=../../../CardSwitch-main \
  node publish-to-cardswitch.mjs
```

## GitHub Actions

Workflow: `.github/workflows/cardswitch-card-crawler.yml`

- Schedule: daily 02:20 Taipei
- Secrets (same as pay activities pipeline):
  - `CARDSWITCH_REPO` (e.g. `billchenbest/CardSwitch`)
  - `PAYMENTMAPTW_APP_TOKEN`
  - optional `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
- Writes cache to `data/cardswitch/` on this repo, then copies into CardSwitch `cards/` + `miles_data/`
- Every crawled JSON is stamped with `updatedAt` (root arrays become `{ "updatedAt", "items" }`). Content-only diffs ignore the timestamp. `data-versions.json` lists all file stamps for CardSwitch cache checks.
