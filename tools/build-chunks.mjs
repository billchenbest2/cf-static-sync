import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEncryptedChunkFile, decodeXorB64Utf8 } from './chunk-crypto.mjs';
import { hashString, runWranglerD1Query, getMetaDbName, getStoresDbName } from './lib/d1-cli.mjs';
import { shouldExportStore, storeToExportShape } from './lib/store-schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHUNK_SIZE = parseInt(process.env.EXPORT_CHUNK_SIZE || '2500', 10) || 2500;
const REMOTE = !process.argv.includes('--local');
const CHUNK_PATH_OBFUSCATE =
  process.env.CHUNK_PATH_OBFUSCATE === '1' || String(process.env.CHUNK_PATH_OBFUSCATE || '').toLowerCase() === 'true';
const QUERY_PAGE = parseInt(process.env.EXPORT_QUERY_PAGE || '1000', 10) || 1000;

function runWranglerJson(dbName, sql) {
  return runWranglerD1Query(dbName, sql, REMOTE);
}

function queryStoresPaged(dbName, stores) {
  // Keyset pagination on the placeKey primary key. Avoids OFFSET, which forces
  // SQLite to re-scan all skipped rows every page (O(n^2) rows_read on D1).
  let lastKey = '';
  while (true) {
    const cursor = lastKey.replace(/'/g, "''");
    const rows = runWranglerJson(
      dbName,
      `SELECT * FROM stores WHERE placeKey > '${cursor}' AND lower(status) NOT IN ('removed','deleted') ORDER BY placeKey LIMIT ${QUERY_PAGE};`
    );
    if (!rows.length) break;
    for (const row of rows) {
      const s = storeToExportShape(row);
      if (!shouldExportStore(s)) continue;
      stores.push({ ...s, source_slug: row.source_slug || 'ugc' });
    }
    lastKey = rows[rows.length - 1].placeKey;
    process.stdout.write(`  ${dbName}: ${stores.length} loaded\r`);
    if (rows.length < QUERY_PAGE) break;
  }
}

function listShardIds() {
  const ids = new Set();
  let offset = 0;
  const page = 8000;
  while (true) {
    const rows = runWranglerJson(
      getMetaDbName(),
      `SELECT DISTINCT shard_id FROM place_shard LIMIT ${page} OFFSET ${offset};`
    );
    if (!rows.length) break;
    for (const r of rows) ids.add(Number(r.shard_id));
    if (rows.length < page) break;
    offset += page;
  }
  return [...ids].sort((a, b) => a - b);
}

function queryAllStores() {
  const stores = [];
  const shardIds = listShardIds();
  const targets = shardIds.length ? shardIds : [0];
  for (const sid of targets) {
    queryStoresPaged(getStoresDbName(sid), stores);
  }
  process.stdout.write('\n');
  return stores;
}

function queryDicts() {
  const categories = runWranglerJson(getMetaDbName(), 'SELECT id, label FROM category_dict ORDER BY id;');
  const payments = runWranglerJson(getMetaDbName(), 'SELECT id, label FROM payment_dict ORDER BY id;');
  return {
    categories: categories.map((r) => ({ id: String(r.id), label: String(r.label) })),
    paymentMethods: payments.map((r) => ({ id: String(r.id), label: String(r.label) }))
  };
}

function leftPad(n, width) {
  return String(n).padStart(width, '0');
}

function writeChunksGrouped(stores, outDir) {
  const groups = new Map();
  for (const s of stores) {
    const slug = String(s.source_slug || 'ugc');
    if (!groups.has(slug)) groups.set(slug, []);
    const { source_slug, ...rest } = s;
    groups.get(slug).push(rest);
  }

  const chunks = [];
  let globalId = 0;
  let globalSeq = 0;
  const sortedSlugs = [...groups.keys()].sort();
  let bundleIdx = 0;

  for (const slug of sortedSlugs) {
    const list = groups.get(slug);
    const dirName = CHUNK_PATH_OBFUSCATE ? `b${String(bundleIdx++).padStart(3, '0')}` : slug;
    const slugDir = path.join(outDir, dirName);
    fs.mkdirSync(slugDir, { recursive: true });
    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const part = list.slice(i, i + CHUNK_SIZE);
      const fileName = `chunk_${leftPad(i / CHUNK_SIZE, 5)}.json`;
      const rel = `${dirName}/${fileName}`;
      const bodyObj = buildEncryptedChunkFile(part, globalSeq++);
      const body = JSON.stringify(bodyObj);
      fs.writeFileSync(path.join(slugDir, fileName), body, 'utf8');
      chunks.push({ id: globalId++, file: rel, hash: hashString(body) });
    }
  }

  return chunks;
}

function smokeTestDecrypt(outDir, chunks) {
  if (!chunks.length) return;
  const first = chunks[0];
  const filePath = path.join(outDir, first.file);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const plain = JSON.parse(decodeXorB64Utf8(raw.payload));
  if (!Array.isArray(plain.stores)) throw new Error('smoke decrypt failed');
}

async function main() {
  const outDir = process.env.OUTPUT_DIR || path.resolve(__dirname, '../site/dist');
  fs.mkdirSync(outDir, { recursive: true });

  for (const ent of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (ent.name === '_headers') continue;
    const p = path.join(outDir, ent.name);
    if (ent.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else if (ent.isFile() && ent.name.endsWith('.json')) fs.unlinkSync(p);
  }

  console.log('Querying D1...');
  const stores = queryAllStores();
  const dicts = queryDicts();
  console.log(`Exporting ${stores.length} rows...`);

  const chunks = writeChunksGrouped(stores, outDir);
  smokeTestDecrypt(outDir, chunks);

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    chunkEncoding: 'xor-b64-v1',
    chunkCount: chunks.length,
    chunks,
    categories: dicts.categories,
    paymentMethods: dicts.paymentMethods
  };

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  console.log(`Wrote ${chunks.length} chunks to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
