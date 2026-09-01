import fs from 'node:fs';
import path from 'node:path';
import { buildEncryptedChunkFile, decodeXorB64Utf8 } from '../chunk-crypto.mjs';
import { hashString } from './d1-cli.mjs';

export function decryptChunkRaw(raw) {
  if (raw?.encrypted === true && raw.encAlg === 'xor-b64-v1' && typeof raw.payload === 'string') {
    return JSON.parse(decodeXorB64Utf8(raw.payload));
  }
  return raw;
}

export function readChunkFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const inner = decryptChunkRaw(raw);
  return { raw, inner, stores: Array.isArray(inner.stores) ? inner.stores : [] };
}

export function computeBbox(stores) {
  if (!stores.length) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const s of stores) {
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  if (!Number.isFinite(minLat)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

export function stripSourceSlug(store) {
  const { source_slug, ...rest } = store;
  return rest;
}

export function writeChunkFile(filePath, stores, chunkIndex) {
  const bodyObj = buildEncryptedChunkFile(stores, chunkIndex);
  const body = JSON.stringify(bodyObj);
  fs.writeFileSync(filePath, body, 'utf8');
  return { body, hash: hashString(body) };
}

export async function fetchText(url) {
  const res = await fetch(url, { headers: { Accept: '*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

export async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export async function pullDeployData(baseUrl, outDir, options = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const manifest = await fetchJson(`${base}/manifest.json`);
  fs.mkdirSync(outDir, { recursive: true });

  const chunks = manifest.chunks || [];
  const concurrency = Math.max(1, Number(options.concurrency) || 4);
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (chunk) => {
        const dest = path.join(outDir, chunk.file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, await fetchText(`${base}/${chunk.file}`), 'utf8');
      })
    );
    process.stdout.write(`  pulled ${Math.min(i + concurrency, chunks.length)}/${chunks.length} chunks\r`);
  }
  process.stdout.write('\n');

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return manifest;
}

export function loadManifest(outDir) {
  const manifestPath = path.join(outDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export function saveManifest(outDir, manifest) {
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

export function countAllStores(manifest, outDir) {
  let total = 0;
  for (const chunk of manifest.chunks || []) {
    const { stores } = readChunkFile(path.join(outDir, chunk.file));
    total += stores.length;
  }
  return total;
}

function leftPad(n, width) {
  return String(n).padStart(width, '0');
}

function chunkMetaByFile(manifest) {
  const map = new Map();
  for (const chunk of manifest.chunks || []) map.set(chunk.file, chunk);
  return map;
}

function listSlugChunks(manifest, slug) {
  const prefix = `${slug}/`;
  return (manifest.chunks || []).filter((c) => String(c.file || '').startsWith(prefix));
}

function nextChunkFileName(slugChunks) {
  let maxIdx = -1;
  for (const chunk of slugChunks) {
    const m = String(chunk.file || '').match(/chunk_(\d+)\.json$/);
    if (m) maxIdx = Math.max(maxIdx, Number(m[1]));
  }
  return `chunk_${leftPad(maxIdx + 1, 5)}.json`;
}

export function patchDeleteInManifest(manifest, outDir, placeKeys, options = {}) {
  const toDelete = new Set(placeKeys.map((pk) => String(pk || '').trim()).filter(Boolean));
  const affectedFiles = new Map();

  for (const chunk of manifest.chunks || []) {
    const { stores } = readChunkFile(path.join(outDir, chunk.file));
    for (const store of stores) {
      const pk = String(store.placeKey || '');
      if (!toDelete.has(pk)) continue;
      if (!affectedFiles.has(chunk.file)) affectedFiles.set(chunk.file, new Set());
      affectedFiles.get(chunk.file).add(pk);
    }
  }

  const notFound = [...toDelete].filter((pk) => {
    for (const keys of affectedFiles.values()) {
      if (keys.has(pk)) return false;
    }
    return true;
  });

  let removed = 0;
  const changedChunks = [];

  for (const chunk of manifest.chunks || []) {
    const keysToRemove = affectedFiles.get(chunk.file);
    if (!keysToRemove) continue;

    const filePath = path.join(outDir, chunk.file);
    const { stores, inner } = readChunkFile(filePath);
    const filtered = stores.filter((s) => !keysToRemove.has(String(s.placeKey || '')));
    removed += stores.length - filtered.length;

    const chunkIndex = inner.chunkIndex ?? chunk.id ?? 0;
    const { hash } = writeChunkFile(filePath, filtered, chunkIndex);
    chunk.hash = hash;
    if (options.includeBbox !== false) chunk.bbox = computeBbox(filtered);
    changedChunks.push(chunk);
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.storeCount = countAllStores(manifest, outDir);
  return { removed, notFound, changedChunks, manifest };
}

export function patchAddToManifest(manifest, outDir, newStores, options = {}) {
  const CHUNK_SIZE = Math.max(1, Number(options.chunkSize) || 2500);
  const slug = String(options.sourceSlug || newStores[0]?.source_slug || 'ugc');
  const exportStores = newStores.map(stripSourceSlug);
  if (!exportStores.length) {
    return { added: 0, changedChunks: [], manifest, overflow: [] };
  }

  const slugChunks = listSlugChunks(manifest, slug);
  const metaByFile = chunkMetaByFile(manifest);
  let pending = [...exportStores];
  let added = 0;
  const changedChunks = [];
  let globalSeq = Number(options.globalSeqStart ?? manifest.chunks?.length ?? 0);

  function touchChunk(chunk, stores, chunkIndex) {
    const filePath = path.join(outDir, chunk.file);
    const { hash } = writeChunkFile(filePath, stores, chunkIndex);
    chunk.hash = hash;
    if (options.includeBbox !== false) chunk.bbox = computeBbox(stores);
    changedChunks.push(chunk);
  }

  if (slugChunks.length) {
    const lastChunk = slugChunks[slugChunks.length - 1];
    const filePath = path.join(outDir, lastChunk.file);
    const { stores, inner } = readChunkFile(filePath);
    const room = CHUNK_SIZE - stores.length;
    if (room > 0) {
      const part = pending.splice(0, room);
      const merged = stores.concat(part);
      added += part.length;
      touchChunk(lastChunk, merged, inner.chunkIndex ?? lastChunk.id ?? 0);
    }
  }

  while (pending.length) {
    const part = pending.splice(0, CHUNK_SIZE);
    added += part.length;
    const fileName = slugChunks.length ? nextChunkFileName(slugChunks) : 'chunk_00000.json';
    const rel = `${slug}/${fileName}`;
    const slugDir = path.join(outDir, slug);
    fs.mkdirSync(slugDir, { recursive: true });
    const nextId =
      (manifest.chunks || []).reduce((max, c) => Math.max(max, Number(c.id) || 0), -1) + 1;
    const chunk = { id: nextId, file: rel, hash: '' };
    manifest.chunks = manifest.chunks || [];
    manifest.chunks.push(chunk);
    slugChunks.push(chunk);
    touchChunk(chunk, part, globalSeq++);
    metaByFile.set(rel, chunk);
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.chunkCount = (manifest.chunks || []).length;
  manifest.storeCount = countAllStores(manifest, outDir);
  return { added, changedChunks, manifest, overflow: pending };
}

export function parseKeyList(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
