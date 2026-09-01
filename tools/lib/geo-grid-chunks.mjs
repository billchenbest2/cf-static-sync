import fs from 'node:fs';
import path from 'node:path';
import { buildEncryptedChunkFile } from '../chunk-crypto.mjs';
import { computeBbox } from './chunk-patch.mjs';
import { hashString } from './d1-cli.mjs';

export const DEFAULT_GRID = {
  latOrigin: parseFloat(process.env.GRID_LAT_ORIGIN || '21.5'),
  lngOrigin: parseFloat(process.env.GRID_LNG_ORIGIN || '118.0'),
  latStep: parseFloat(process.env.GRID_LAT_STEP || '0.48'),
  lngStep: parseFloat(process.env.GRID_LNG_STEP || '0.52')
};

const CHUNK_SIZE = parseInt(process.env.EXPORT_CHUNK_SIZE || '2500', 10) || 2500;

function leftPad(n, width) {
  return String(n).padStart(width, '0');
}

export function getGridKey(lat, lng, grid = DEFAULT_GRID) {
  const latBand = Math.floor((Number(lat) - grid.latOrigin) / grid.latStep);
  const lngBand = Math.floor((Number(lng) - grid.lngOrigin) / grid.lngStep);
  return `${latBand}_${lngBand}`;
}

export function parseGridKey(key) {
  const parts = String(key || '').split('_');
  return { latBand: Number(parts[0]), lngBand: Number(parts[1]) };
}

export function gridKeyToBbox(gridKey, grid = DEFAULT_GRID) {
  const { latBand, lngBand } = parseGridKey(gridKey);
  if (!Number.isFinite(latBand) || !Number.isFinite(lngBand)) return null;
  return {
    minLat: grid.latOrigin + latBand * grid.latStep,
    maxLat: grid.latOrigin + (latBand + 1) * grid.latStep,
    minLng: grid.lngOrigin + lngBand * grid.lngStep,
    maxLng: grid.lngOrigin + (lngBand + 1) * grid.lngStep
  };
}

export function groupStoresByGrid(stores, grid = DEFAULT_GRID) {
  const groups = new Map();
  for (const store of stores) {
    const lat = Number(store.lat);
    const lng = Number(store.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const gridKey = getGridKey(lat, lng, grid);
    if (!groups.has(gridKey)) groups.set(gridKey, []);
    groups.get(gridKey).push(store);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => String(a.placeKey || '').localeCompare(String(b.placeKey || '')));
  }
  return groups;
}

export function estimateChunkCount(stores, grid = DEFAULT_GRID) {
  const groups = groupStoresByGrid(stores, grid);
  let chunks = 0;
  for (const list of groups.values()) {
    chunks += Math.max(1, Math.ceil(list.length / CHUNK_SIZE));
  }
  return { gridCells: groups.size, chunks, stores: stores.length };
}

/**
 * Write map chunks grouped by lat/lng grid bands.
 * @returns {{ chunks: object[], grid: object, chunkSize: number }}
 */
export function writeChunksGeoGrid(stores, outDir, options = {}) {
  const grid = options.grid || DEFAULT_GRID;
  const obfuscate = !!options.obfuscate;
  const groups = groupStoresByGrid(stores, grid);
  const sortedGridKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  const chunks = [];
  let globalId = 0;
  let globalSeq = 0;
  let bundleIdx = 0;

  for (const gridKey of sortedGridKeys) {
    const list = groups.get(gridKey);
    const dirName = obfuscate ? `b${String(bundleIdx++).padStart(3, '0')}` : `g/${gridKey}`;
    const slugDir = path.join(outDir, dirName);
    fs.mkdirSync(slugDir, { recursive: true });

    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const part = list.slice(i, i + CHUNK_SIZE);
      const fileName = `chunk_${leftPad(Math.floor(i / CHUNK_SIZE), 5)}.json`;
      const rel = `${dirName}/${fileName}`;
      const bodyObj = buildEncryptedChunkFile(part, globalSeq++);
      const body = JSON.stringify(bodyObj);
      fs.writeFileSync(path.join(slugDir, fileName), body, 'utf8');
      const bbox = computeBbox(part);
      chunks.push({
        id: globalId++,
        file: rel,
        hash: hashString(body),
        bbox,
        gridKeys: [gridKey]
      });
    }
  }

  return {
    chunks,
    grid: {
      layout: 'geo',
      latOrigin: grid.latOrigin,
      lngOrigin: grid.lngOrigin,
      latStep: grid.latStep,
      lngStep: grid.lngStep,
      gridCells: sortedGridKeys.length
    },
    chunkSize: CHUNK_SIZE
  };
}

export function findChunksForGridKey(manifest, gridKey) {
  return (manifest.chunks || []).filter((c) => {
    if (Array.isArray(c.gridKeys) && c.gridKeys.includes(gridKey)) return true;
    const file = String(c.file || '');
    return file.startsWith(`g/${gridKey}/`);
  });
}
