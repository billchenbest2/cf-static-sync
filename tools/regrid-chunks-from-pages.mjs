/**
 * Rebuild map chunks using lat/lng geo grid from existing Pages bundle (no D1).
 *
 *   node regrid-chunks-from-pages.mjs --pull --deploy
 *   node regrid-chunks-from-pages.mjs --stats-only --pull
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { decodeXorB64Utf8 } from './chunk-crypto.mjs';
import {
  collectAllStoresFromDeployData,
  loadManifest,
  pullDeployData,
  saveManifest
} from './lib/chunk-patch.mjs';
import { DEFAULT_GRID, estimateChunkCount, writeChunksGeoGrid } from './lib/geo-grid-chunks.mjs';
import { buildSearchIndexFromDeployDir } from './lib/search-index-build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUTPUT_DIR || path.resolve(__dirname, '../site/dist');
const PAGES_BASE = process.env.PAGES_BASE || 'https://paymentmaptw-data.pages.dev';
const PAGES_PROJECT = process.env.PAGES_PROJECT_NAME || 'paymentmaptw-data';
const CHUNK_PATH_OBFUSCATE =
  process.env.CHUNK_PATH_OBFUSCATE === '1' || String(process.env.CHUNK_PATH_OBFUSCATE || '').toLowerCase() === 'true';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function smokeTestDecrypt(outDir, chunks) {
  if (!chunks.length) return;
  const first = chunks[0];
  const raw = JSON.parse(fs.readFileSync(path.join(outDir, first.file), 'utf8'));
  const plain = JSON.parse(decodeXorB64Utf8(raw.payload));
  if (!Array.isArray(plain.stores)) throw new Error('smoke decrypt failed');
}

function clearMapArtifacts(outDir) {
  for (const ent of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (ent.name === '_headers' || ent.name === 'gas') continue;
    const p = path.join(outDir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'search') {
        fs.rmSync(p, { recursive: true, force: true });
        continue;
      }
      fs.rmSync(p, { recursive: true, force: true });
    } else if (ent.isFile() && (ent.name.endsWith('.json') || ent.name === 'search-manifest.json')) {
      fs.unlinkSync(p);
    }
  }
}

function deployPages() {
  const workerDir = process.env.WRANGLER_CWD || path.resolve(__dirname, '../wrangler');
  const cmd = `npx wrangler pages deploy "${OUT_DIR}" --project-name=${PAGES_PROJECT} --branch=main --commit-dirty=true`;
  const res = spawnSync(cmd, {
    cwd: workerDir,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    env: process.env
  });
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'pages deploy failed');
  process.stdout.write(res.stdout || '');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (hasFlag('--pull') || !fs.existsSync(path.join(OUT_DIR, 'manifest.json'))) {
    console.log(`Pulling map bundle from ${PAGES_BASE} ...`);
    await pullDeployData(PAGES_BASE, OUT_DIR);
  }

  const oldManifest = loadManifest(OUT_DIR);
  const stores = collectAllStoresFromDeployData(OUT_DIR, oldManifest);
  console.log(`Collected ${stores.length} stores from ${oldManifest.chunks?.length || 0} legacy chunks`);

  const stats = estimateChunkCount(stores, DEFAULT_GRID);
  console.log(
    `Geo grid plan (${DEFAULT_GRID.latStep}° x ${DEFAULT_GRID.lngStep}°): ${stats.gridCells} cells → ${stats.chunks} chunks`
  );

  if (hasFlag('--stats-only')) return;

  const dicts = {
    categories: oldManifest.categories || [],
    paymentMethods: oldManifest.paymentMethods || []
  };

  clearMapArtifacts(OUT_DIR);

  const { chunks, grid } = writeChunksGeoGrid(stores, OUT_DIR, {
    grid: DEFAULT_GRID,
    obfuscate: CHUNK_PATH_OBFUSCATE
  });
  smokeTestDecrypt(OUT_DIR, chunks);

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    chunkEncoding: 'xor-b64-v1',
    chunkLayout: 'geo',
    chunkCount: chunks.length,
    storeCount: stores.length,
    grid,
    chunks,
    categories: dicts.categories,
    paymentMethods: dicts.paymentMethods,
    searchManifest: 'search-manifest.json'
  };

  saveManifest(OUT_DIR, manifest);
  console.log(`Wrote ${chunks.length} geo-grid chunks (${grid.gridCells} grid cells)`);

  console.log('Rebuilding encrypted search index...');
  const { searchManifest } = await buildSearchIndexFromDeployDir(OUT_DIR, { linkMainManifest: true });
  console.log(`Search index: ${searchManifest.entryCount} entries, ${searchManifest.shardCount} shards`);

  if (hasFlag('--deploy')) {
    console.log(`Deploying to ${PAGES_PROJECT}...`);
    deployPages();
    console.log('Deploy complete.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
