import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  loadManifest,
  parseKeyList,
  patchAddToManifest,
  patchDeleteInManifest,
  pullDeployData,
  saveManifest
} from './lib/chunk-patch.mjs';
import { getStoresDbName, runWranglerD1Query } from './lib/d1-cli.mjs';
import { shouldExportStore, storeToExportShape } from './lib/store-schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUTPUT_DIR || path.resolve(__dirname, '../site/dist');
const PAGES_BASE = process.env.PAGES_BASE || 'https://paymentmaptw-data.pages.dev';
const PAGES_PROJECT = process.env.PAGES_PROJECT_NAME || 'paymentmaptw-data';
const REMOTE = !process.argv.includes('--local');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return '';
  return String(process.argv[idx + 1] || '').trim();
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function queryStoresByPlaceKeys(placeKeys) {
  if (!placeKeys.length) return [];
  const inList = placeKeys.map((pk) => `'${String(pk).replace(/'/g, "''")}'`).join(',');
  const rows = runWranglerD1Query(
    getStoresDbName(0),
    `SELECT placeKey, name, lat, lng, googleMapsUrl, categoryIds, payments, iconId, notes, cashAccepted, cardNetworks, status, reportSource, reportedAt, schemaVersion, reporterHash, source_slug FROM stores WHERE placeKey IN (${inList});`,
    REMOTE
  );
  const stores = [];
  for (const row of rows) {
    const s = storeToExportShape(row);
    if (!shouldExportStore(s)) continue;
    stores.push({ ...s, source_slug: row.source_slug || 'ugc' });
  }
  return stores;
}

function deployPages() {
  const wranglerCwd = process.env.WRANGLER_CWD || path.resolve(__dirname, '../wrangler');
  const cmd = `npx wrangler pages deploy "${OUT_DIR}" --project-name=${PAGES_PROJECT} --branch=main`;
  const res = spawnSync(cmd, {
    cwd: wranglerCwd,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    env: process.env
  });
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'pages deploy failed');
  process.stdout.write(res.stdout || '');
}

async function main() {
  const deleteKeys = parseKeyList(argValue('--delete'));
  const addKeys = parseKeyList(argValue('--add-from-d1'));
  const dryRun = hasFlag('--dry-run');

  if (hasFlag('--pull') || !fs.existsSync(path.join(OUT_DIR, 'manifest.json'))) {
    console.log(`Pulling bundle from ${PAGES_BASE} ...`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await pullDeployData(PAGES_BASE, OUT_DIR);
  }

  let manifest = loadManifest(OUT_DIR);
  const beforeCount = manifest.storeCount ?? null;

  if (deleteKeys.length) {
    const result = patchDeleteInManifest(manifest, OUT_DIR, deleteKeys);
    manifest = result.manifest;
    console.log(`Delete patch: removed=${result.removed}, changedChunks=${result.changedChunks.length}`);
    if (result.notFound.length) console.warn('  not found:', result.notFound.join(', '));
  }

  if (addKeys.length) {
    const stores = queryStoresByPlaceKeys(addKeys);
    const result = patchAddToManifest(manifest, OUT_DIR, stores);
    manifest = result.manifest;
    console.log(`Add patch: added=${result.added}, changedChunks=${result.changedChunks.length}`);
  }

  if (!deleteKeys.length && !addKeys.length) {
    throw new Error('Specify --delete and/or --add-from-d1');
  }

  console.log(`Store count: ${beforeCount ?? '?'} -> ${manifest.storeCount}`);

  if (dryRun) {
    console.log('Dry run — no writes.');
    return;
  }

  saveManifest(OUT_DIR, manifest);

  if (hasFlag('--deploy')) {
    console.log(`Deploying to ${PAGES_PROJECT} ...`);
    deployPages();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
