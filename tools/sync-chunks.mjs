import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadManifest,
  parseKeyList,
  patchAddToManifest,
  patchDeleteInManifest,
  pullDeployData,
  saveManifest
} from './lib/chunk-patch.mjs';
import { getMetaDbName, getStoresDbName, runWranglerD1Query } from './lib/d1-cli.mjs';
import { shouldExportStore, storeToExportShape } from './lib/store-schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUTPUT_DIR || path.resolve(__dirname, '../site/dist');
const PAGES_BASE = process.env.PAGES_BASE || 'https://paymentmaptw-data.pages.dev';
const REMOTE = !process.argv.includes('--local');

function envKeys(name) {
  return parseKeyList(process.env[name] || '');
}

function payloadKeys(clientPayload, field) {
  const raw = clientPayload && clientPayload[field];
  return parseKeyList(Array.isArray(raw) ? raw.join(',') : raw || '');
}

function resolveMode(clientPayload) {
  const fromPayload = String(clientPayload?.sync_mode || '').trim().toLowerCase();
  const fromEnv = String(process.env.SYNC_MODE || '').trim().toLowerCase();
  if (fromPayload === 'full' || fromEnv === 'full' || process.env.FORCE_FULL_REBUILD === '1') return 'full';
  if (fromPayload === 'patch' || fromEnv === 'patch') return 'patch';
  if (envKeys('PATCH_DELETE_KEYS').length || envKeys('PATCH_ADD_KEYS').length) return 'patch';
  if (payloadKeys(clientPayload, 'deleted_place_keys').length || payloadKeys(clientPayload, 'added_place_keys').length) {
    return 'patch';
  }
  return process.env.DEFAULT_SYNC_MODE === 'full' ? 'full' : 'patch';
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

async function readDeltaFromD1() {
  const rows = runWranglerD1Query(
    getMetaDbName(),
    `SELECT value FROM config WHERE key = 'static_publish_delta' LIMIT 1;`,
    REMOTE
  );
  const raw = String(rows[0]?.value || '').trim();
  if (!raw) return { deleted: [], added: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      deleted: parseKeyList((parsed.deleted || []).join(',')),
      added: parseKeyList((parsed.added || []).join(','))
    };
  } catch {
    return { deleted: [], added: [] };
  }
}

async function runPatch(deleteKeys, addKeys) {
  if (!deleteKeys.length && !addKeys.length) {
    console.log('Patch mode: no delete/add keys — skipping chunk rebuild (Pages bundle unchanged).');
    return { changed: false, deleteKeys, addKeys };
  }

  if (!fs.existsSync(path.join(OUT_DIR, 'manifest.json'))) {
    console.log(`No local manifest; pulling from ${PAGES_BASE} ...`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await pullDeployData(PAGES_BASE, OUT_DIR);
  }

  let manifest = loadManifest(OUT_DIR);
  const before = manifest.storeCount ?? null;

  if (deleteKeys.length) {
    const result = patchDeleteInManifest(manifest, OUT_DIR, deleteKeys);
    manifest = result.manifest;
    console.log(`Patch delete: removed=${result.removed}, changedChunks=${result.changedChunks.length}`);
    if (result.notFound.length) console.warn('  not found on Pages:', result.notFound.join(', '));
  }

  if (addKeys.length) {
    const stores = queryStoresByPlaceKeys(addKeys);
    const result = patchAddToManifest(manifest, OUT_DIR, stores);
    manifest = result.manifest;
    console.log(`Patch add: added=${result.added}, changedChunks=${result.changedChunks.length}, d1Rows=${stores.length}`);
  }

  console.log(`Store count: ${before ?? '?'} -> ${manifest.storeCount}`);
  saveManifest(OUT_DIR, manifest);
  return { changed: true, deleteKeys, addKeys, storeCount: manifest.storeCount };
}

async function main() {
  const clientPayload = (() => {
    const raw = process.env.GITHUB_EVENT_CLIENT_PAYLOAD || process.env.CLIENT_PAYLOAD || '';
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  })();

  const mode = resolveMode(clientPayload);
  console.log(`sync-chunks mode=${mode}`);

  if (mode === 'full') {
    console.log('Delegating to full build-chunks.mjs');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync('node', ['build-chunks.mjs'], {
      cwd: __dirname,
      stdio: 'inherit',
      env: process.env
    });
    process.exit(res.status ?? 1);
  }

  let deleteKeys = [
    ...envKeys('PATCH_DELETE_KEYS'),
    ...payloadKeys(clientPayload, 'deleted_place_keys')
  ];
  let addKeys = [...envKeys('PATCH_ADD_KEYS'), ...payloadKeys(clientPayload, 'added_place_keys')];

  if (!deleteKeys.length && !addKeys.length && process.env.READ_DELTA_FROM_D1 === '1') {
    const delta = await readDeltaFromD1();
    deleteKeys = delta.deleted;
    addKeys = delta.added;
    console.log(`Delta from D1 config: deleted=${deleteKeys.length}, added=${addKeys.length}`);
  }

  deleteKeys = [...new Set(deleteKeys)];
  addKeys = [...new Set(addKeys)];

  await runPatch(deleteKeys, addKeys);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
