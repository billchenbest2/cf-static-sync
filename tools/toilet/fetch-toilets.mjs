#!/usr/bin/env node
/**
 * Orchestrator: fetch MOENV FAC_P_07 -> normalize -> merge sites -> write data/toilet
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMoenvToilets } from './fetch-moenv.mjs';
import { normalizeAll } from './normalize.mjs';
import { mergeToiletSites, writeToiletData } from './merge-sites.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'data/toilet');

async function main() {
  let raw;
  try {
    raw = await fetchMoenvToilets();
  } catch (e) {
    console.warn('[toilet] live fetch failed, trying cache:', e.message || e);
    raw = await fetchMoenvToilets({ cacheOnly: true });
  }

  const { units, filtered } = normalizeAll(raw);
  const reportPath = path.join(OUT_DIR, 'filtered-report.json');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(filtered, null, 2), 'utf8');
  console.log(
    '[toilet] units',
    units.length,
    'filtered',
    filtered.noCoordinates.length + filtered.unknownCounty.length + filtered.invalidData.length,
    'repairedCoords',
    filtered.repairedCoords
  );

  const sites = mergeToiletSites(units);
  const manifest = writeToiletData(sites, OUT_DIR);
  console.log('[toilet] sites', manifest.count, 'counties', Object.keys(manifest.counties).length);
  console.log('[toilet] wrote', OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
