# Edge Static Sync

Small utility repo: export rows from Cloudflare D1, pack them into encrypted JSON shards, and publish to a Cloudflare Pages project via Direct Upload.

## What it does

1. Query configured D1 databases (meta + data shards)
2. Build `manifest.json` and chunked static JSON under `site/dist/`
3. Export `gas/community-prices.json` from D1 `gas_price_reports` (gas station price reports)
4. Deploy with `wrangler pages deploy` (no Git-connected Pages build)
5. **Monthly:** fetch CPC + FPCC + Smile stations and push `stations.json` to the private PaymentMapTW app repo
6. **Weekly:** fetch CPC official + Costco member prices and push price JSON to the app repo

## Triggers

| Workflow | When |
|----------|------|
| **Publish static bundle** | `repository_dispatch` (`static-publish`), manual |
| **Gas stations ingest (monthly)** | 1st of month 03:00 UTC, manual |
| **Gas official prices (weekly)** | Taiwan Mon 00:00 / 00:05 / 00:30 (UTC Sun 16:00 / 16:05 / 16:30), manual |

Manual runs: Actions → pick workflow → **Run workflow**

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

### Gas data push (private app repo)

| Secret | Purpose |
|--------|---------|
| `PAYMENTMAPTW_APP_REPO` | Private app repo slug, e.g. `your-org/PaymentMapTW-main` |
| `PAYMENTMAPTW_APP_TOKEN` | PAT or GitHub App token with **write** access to that repo |

**Monthly** (`gas-stations-monthly.yml`) commits:

- `data/gas/stations.json`
- `data/gas/raw/cpc-stations.xml`
- `data/gas/raw/fpcc-*.html`
- `data/gas/raw/smile-stations.xlsx`

**Weekly** (`gas-prices-weekly.yml`) commits:

- `data/gas/official-prices.json`
- `data/gas/costco-prices.json`

If the app repo uses Cloudflare Pages Git integration, a push triggers frontend redeploy automatically.

**PAT setup (one-time):** GitHub → Settings → Developer settings → Fine-grained token → Repository access: PaymentMapTW app repo only → Permissions: Contents **Read and write**. Add both secrets under **cf-static-sync** repo → Settings → Secrets.

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
