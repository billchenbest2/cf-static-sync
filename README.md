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
| **CVS stores ingest (monthly)** | 2nd of month 03:00 UTC, manual |
| **Toilet sites ingest (monthly)** | 3rd of month 03:00 UTC, manual |

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
| `PAYMENTMAPTW_FRONTEND_PAGES_PROJECT` | Optional. Frontend Pages project name (default: `paymentmaptw`) |
| `MOENV_API_KEY` | Optional. Environment Ministry open-data API key for toilet ingest (falls back to data.gov.tw published resource key) |

**Monthly** (`gas-stations-monthly.yml`) commits:

- `data/gas/stations.json`
- `data/gas/raw/cpc-stations.xml`
- `data/gas/raw/fpcc-*.html`
- `data/gas/raw/smile-stations.xlsx`

FPCC HTML snapshots are also kept in this repo under `fpcc-cache/` as a fallback when FPCC blocks GitHub Actions datacenter IPs. The workflow seeds that cache before ingest and applies patched fetch scripts from `tools/gas/`.

**Weekly** (`gas-prices-weekly.yml`) commits:

- `data/gas/official-prices.json`
- `data/gas/costco-prices.json`

**Monthly** (`cvs-stores-monthly.yml`) fetches 7-ELEVEN, FamilyMart, Hi-Life, and OK Mart, commits `data/cvs/manifest.json` + `stores-*.json`, removes legacy Hi-Life OSM/APK raw files, then deploys the frontend via `wrangler pages deploy` (direct upload to `paymentmaptw` Pages project).

**Monthly** (`toilets-monthly.yml`) fetches MOENV `FAC_P_07` (全國公廁建檔資料), merges same-address units into sites, commits `data/toilet/manifest.json` + `sites-*.json`, then deploys frontend. Optional secret `MOENV_API_KEY` (falls back to data.gov.tw published resource key).

**PAT setup (one-time):** GitHub → Settings → Developer settings → Fine-grained token → Repository access: PaymentMapTW app repo only → Permissions: Contents **Read and write**. Add both secrets under **cf-static-sync** repo → Settings → Secrets.

## Chunk layout (geo grid)

Map chunks are grouped by **lat/lng grid bands** (`CHUNK_LAYOUT=geo`, default), not by county or `source_slug`. Each manifest entry includes `bbox` and `gridKeys`. Patch adds route new stores to the correct grid cell.

| Tool | Purpose |
|------|---------|
| `build-chunks.mjs` | Full D1 export → geo grid chunks |
| `sync-chunks.mjs` / `patch-chunks.mjs` | Incremental patch (geo-aware when manifest has `chunkLayout: geo`) |
| `regrid-chunks-from-pages.mjs` | Re-slice existing Pages bundle without D1 |
| `build-search-index.mjs` | Encrypted search shards from map chunks |

Grid defaults: origin `(21.5°, 118.0°)`, step `0.48° × 0.52°`. Override via `GRID_LAT_*` / `GRID_LNG_*` env vars.

## Chunk sync modes

| Mode | Command | D1 usage |
|------|---------|----------|
| **patch** (default) | `node sync-chunks.mjs` | Pull Pages bundle; optional 1 config read + key-only row fetch for adds |
| **full** | `SYNC_MODE=full node sync-chunks.mjs` | Full D1 export via `build-chunks.mjs` |

Manual patch examples:

```bash
cd tools
node patch-chunks.mjs --pull --delete pk_a,pk_b --deploy
node patch-chunks.mjs --add-from-d1 pk_new   # reads only listed keys from D1
SYNC_MODE=patch PATCH_DELETE_KEYS=pk_a node sync-chunks.mjs
FORCE_FULL_REBUILD=1 node sync-chunks.mjs    # legacy full export
```

Worker debounced publish sends `client_payload.deleted_place_keys` / `added_place_keys` from meta config `static_publish_delta`. CI pulls the live Pages bundle and patches only affected chunks.

## Local dry run

```bash
cd tools && npm ci
node ../scripts/gen-wrangler-config.mjs   # needs D1_* env vars
mkdir -p ../site/dist && cp ../site/_headers ../site/dist/
CHUNK_XOR_SEED=... D1_META_DB=... D1_STORES_PREFIX=... \
  WRANGLER_CWD=../wrangler OUTPUT_DIR=../site/dist CHUNK_LAYOUT=geo CHUNK_PATH_OBFUSCATE=1 \
  node build-chunks.mjs
```

## License

MIT

## Pay activities → CardSwitch

Monthly crawl/OCR/AI; commits `data/pay/` on CardSwitch.

See `tools/pay-pipeline/README.md`. Secrets: `GEMINI_API_KEY`, `CARDSWITCH_REPO`, `PAYMENTMAPTW_APP_TOKEN`.
