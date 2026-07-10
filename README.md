# Edge Static Sync

Small utility repo: export rows from Cloudflare D1, pack them into encrypted JSON shards, and publish to a Cloudflare Pages project via Direct Upload.

## What it does

1. Query configured D1 databases (meta + data shards)
2. Build `manifest.json` and chunked static JSON under `site/dist/`
3. Deploy with `wrangler pages deploy` (no Git-connected Pages build)

## Triggers

- Scheduled (see workflow cron)
- Manual: Actions → **Publish static bundle** → Run workflow
- `repository_dispatch` event type: `static-publish`

## Required GitHub Secrets

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Pages deploy + D1 read |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account |
| `CHUNK_XOR_SEED` | XOR seed for chunk payload |
| `D1_META_NAME` | Meta D1 database name |
| `D1_META_ID` | Meta D1 database UUID |
| `D1_STORES_0_NAME` | Primary stores shard name |
| `D1_STORES_0_ID` | Primary stores shard UUID |
| `D1_STORES_PREFIX` | Prefix before `-0`, `-1`, … (e.g. `myapp-stores`) |
| `PAGES_PROJECT_NAME` | Target Pages project name |

Optional extra shards: `D1_STORES_1_NAME`, `D1_STORES_1_ID`, … up to `D1_STORES_9_*`.

## Local dry run

```bash
cd tools && npm ci
node ../scripts/gen-wrangler-config.mjs   # needs D1_* env vars
mkdir -p ../site/dist && cp ../site/_headers ../site/dist/
CHUNK_XOR_SEED=... D1_META_DB=... D1_STORES_PREFIX=... \
  WRANGLER_CWD=../wrangler OUTPUT_DIR=../site/dist CHUNK_PATH_OBFUSCATE=1 \
  node build-chunks.mjs
```

## License

MIT
