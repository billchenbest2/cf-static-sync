#!/usr/bin/env node
/** Re-parse data/cvs/raw/*.json with latest service maps -> split brand JSON + manifest */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse711ServicesFromTitle, parseFamilyServices } from './services.mjs';
import { mergeCvsStores, writeSplitCvsData } from './store-merge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RAW = path.join(ROOT, 'data/cvs/raw');
const OUT_DIR = path.join(ROOT, 'data/cvs');

function loadJson(name) {
  const fp = path.join(RAW, name);
  if (!fs.existsSync(fp)) return [];
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return Array.isArray(data) ? data : data.stores || [];
}

function reprocess711(list) {
  return list.map((s) => {
    const title = s.sourceImageTitle || s.sourceServicesRaw || '';
    const services = title
      ? parse711ServicesFromTitle(title)
      : Array.isArray(s.services)
        ? s.services
        : [];
    return { ...s, services, sourceUpdatedAt: new Date().toISOString().slice(0, 10) };
  });
}

function reprocessFamily(list) {
  return list.map((s) => {
    const raw = s.sourceAll != null ? s.sourceAll : s.sourceServicesRaw || '';
    const services = raw
      ? parseFamilyServices(raw, s.twoice)
      : parseFamilyServices('', s.twoice);
    return { ...s, services, sourceUpdatedAt: new Date().toISOString().slice(0, 10) };
  });
}

const lists = [];
const s711 = loadJson('711-stores.json');
const sFamily = loadJson('family-stores.json');
if (s711.length) lists.push(reprocess711(s711));
if (sFamily.length) lists.push(reprocessFamily(sFamily));
for (const name of ['hilife-stores.json', 'ok-stores.json', 'simple-stores.json']) {
  const part = loadJson(name);
  if (part.length) lists.push(part);
}

const stores = mergeCvsStores(lists);
const svcCount = {};
for (const s of stores) {
  for (const id of s.services || []) svcCount[id] = (svcCount[id] || 0) + 1;
}
const manifest = writeSplitCvsData(stores, OUT_DIR);
console.log(`Reprocessed ${stores.length} stores (split by brand) -> ${OUT_DIR}`);
console.log('brandCounts:', manifest.brandCounts);
console.log('top services:', Object.entries(svcCount).sort((a, b) => b[1] - a[1]).slice(0, 20));
