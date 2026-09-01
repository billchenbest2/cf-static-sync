import fs from 'node:fs';
import path from 'node:path';
import { buildEncryptedSearchShardFile } from '../chunk-crypto.mjs';
import { hashString } from './d1-cli.mjs';
import { loadManifest, pullDeployData, readChunkFile } from './chunk-patch.mjs';

const SHARD_SIZE = parseInt(process.env.SEARCH_SHARD_SIZE || '5000', 10) || 5000;

function normalizeSearchStr(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSearchCompact(s) {
  const base = normalizeSearchStr(s || '');
  if (!base) return '';
  let norm = base;
  try {
    norm = norm.normalize('NFKC');
  } catch {
    /* ignore */
  }
  return norm.replace(/[^a-z0-9\u00c0-\u024f\u3400-\u9fff]+/gi, '');
}

function categoryLabelMap(categories) {
  const map = new Map();
  for (const c of categories || []) {
    if (c && c.id) map.set(String(c.id), String(c.label || c.id));
  }
  return map;
}

export function buildSearchHaystack(store, catMap) {
  const parts = [store.name || ''];
  const ids = Array.isArray(store.categoryIds) ? store.categoryIds : [];
  for (const id of ids) {
    const label = catMap.get(String(id));
    if (label) parts.push(label);
  }
  if (store.notes) parts.push(String(store.notes));
  return normalizeSearchCompact(parts.join(' '));
}

export function storeToSearchEntry(store, chunkId, catMap) {
  const pk = String(store.placeKey || '').trim();
  if (!pk) return null;
  const lat = Number(store.lat);
  const lng = Number(store.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const status = String(store.status || 'open').toLowerCase();
  if (status === 'removed' || status === 'deleted') return null;
  return {
    k: pk,
    n: String(store.name || '').slice(0, 120),
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    h: buildSearchHaystack(store, catMap),
    c: Number(chunkId)
  };
}

export function collectSearchEntriesFromDeployData(outDir, manifest) {
  const catMap = categoryLabelMap(manifest.categories);
  const entries = [];
  const seen = new Set();
  for (const chunk of manifest.chunks || []) {
    const chunkId = Number(chunk.id);
    const { stores } = readChunkFile(path.join(outDir, chunk.file));
    for (const store of stores) {
      const entry = storeToSearchEntry(store, chunkId, catMap);
      if (!entry || seen.has(entry.k)) continue;
      seen.add(entry.k);
      entries.push(entry);
    }
  }
  entries.sort((a, b) => a.k.localeCompare(b.k));
  return entries;
}

function leftPad(n, width) {
  return String(n).padStart(width, '0');
}

export function writeSearchIndex(outDir, entries) {
  const searchDir = path.join(outDir, 'search');
  fs.mkdirSync(searchDir, { recursive: true });

  for (const ent of fs.readdirSync(searchDir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith('.json')) {
      fs.unlinkSync(path.join(searchDir, ent.name));
    }
  }

  const shards = [];
  for (let i = 0; i < entries.length; i += SHARD_SIZE) {
    const part = entries.slice(i, i + SHARD_SIZE);
    const shardIndex = Math.floor(i / SHARD_SIZE);
    const fileName = `shard_${leftPad(shardIndex, 5)}.json`;
    const rel = `search/${fileName}`;
    const bodyObj = buildEncryptedSearchShardFile(part, shardIndex);
    const body = JSON.stringify(bodyObj);
    fs.writeFileSync(path.join(searchDir, fileName), body, 'utf8');
    shards.push({
      id: shardIndex,
      file: rel,
      hash: hashString(body),
      entryCount: part.length
    });
  }

  const searchManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    encoding: 'xor-b64-v1',
    entryCount: entries.length,
    shardCount: shards.length,
    shards
  };

  fs.writeFileSync(path.join(outDir, 'search-manifest.json'), JSON.stringify(searchManifest), 'utf8');
  return searchManifest;
}

export async function buildSearchIndexFromDeployDir(outDir, options = {}) {
  let manifest = loadManifest(outDir);
  if (options.pullFrom) {
    await pullDeployData(options.pullFrom, outDir);
    manifest = loadManifest(outDir);
  }
  const entries = collectSearchEntriesFromDeployData(outDir, manifest);
  const searchManifest = writeSearchIndex(outDir, entries);
  if (options.linkMainManifest !== false) {
    manifest.searchManifest = 'search-manifest.json';
    manifest.searchEntryCount = entries.length;
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  }
  return { entries, searchManifest, storeManifest: manifest };
}
