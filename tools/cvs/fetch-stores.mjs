#!/usr/bin/env node
/**
 * Fetch 7-11 + FamilyMart + Hi-Life + OK Mart stores, merge, write split brand JSON + manifest
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAll711Stores } from './fetch-711-stores.mjs';
import { fetchAllFamilyStores } from './fetch-family-stores.mjs';
import { fetchAllHiLifeStores } from './fetch-hilife-stores.mjs';
import { fetchAllOkStores } from './fetch-ok-stores.mjs';
import { fetchAllSimpleStores } from './fetch-simple-stores.mjs';
import { mergeCvsStores, writeSplitCvsData } from './store-merge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'data/cvs');

async function main() {
  const include711 = process.env.CVS_SKIP_711 !== '1';
  const includeFamily = process.env.CVS_SKIP_FAMILY !== '1';
  const includeHiLife = process.env.CVS_SKIP_HILIFE !== '1';
  const includeOk = process.env.CVS_SKIP_OK !== '1';
  const includeSimple = process.env.CVS_INCLUDE_SIMPLE === '1';
  const lists = [];
  if (include711) lists.push(await fetchAll711Stores());
  if (includeFamily) lists.push(await fetchAllFamilyStores());
  if (includeHiLife) lists.push(await fetchAllHiLifeStores());
  if (includeOk) lists.push(await fetchAllOkStores());
  if (includeSimple) lists.push(await fetchAllSimpleStores());
  const stores = mergeCvsStores(lists);
  const manifest = writeSplitCvsData(stores, OUT_DIR);
  console.log(`Wrote ${stores.length} stores (split by brand) -> ${OUT_DIR}`);
  console.log('brandCounts:', manifest.brandCounts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
