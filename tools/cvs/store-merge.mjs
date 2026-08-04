/** Merge CVS store lists; dedupe by storeId. */
import fs from 'node:fs';
import path from 'node:path';

const BRAND_FILES = {
  '711': 'stores-711.json',
  family: 'stores-family.json',
  hilife: 'stores-hilife.json',
  ok: 'stores-ok.json',
  simple: 'stores-simple.json'
};

export function mergeCvsStores(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const store of list || []) {
      if (!store || !store.storeId) continue;
      const prev = byId.get(store.storeId);
      if (!prev) {
        byId.set(store.storeId, { ...store });
        continue;
      }
      const services = [...new Set([...(prev.services || []), ...(store.services || [])])].sort();
      byId.set(store.storeId, {
        ...prev,
        ...store,
        services,
        phone: store.phone || prev.phone,
        hours: store.hours || prev.hours
      });
    }
  }
  return [...byId.values()].sort((a, b) => String(a.storeId).localeCompare(String(b.storeId)));
}

export function countByBrand(stores) {
  const counts = {};
  for (const s of stores) {
    const id = s.brandId || 'other';
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

/** Write per-brand JSON arrays + data/cvs/manifest.json */
export function writeSplitCvsData(stores, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const brandCounts = countByBrand(stores);
  const byBrand = {};
  for (const s of stores) {
    const id = s.brandId || 'other';
    if (!byBrand[id]) byBrand[id] = [];
    byBrand[id].push(s);
  }
  const brands = {};
  for (const [id, list] of Object.entries(byBrand)) {
    const file = BRAND_FILES[id] || `stores-${id}.json`;
    const url = `/data/cvs/${file}`;
    fs.writeFileSync(path.join(outDir, file), JSON.stringify(list), 'utf8');
    brands[id] = { url, count: list.length };
  }
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    count: stores.length,
    brandCounts,
    brands
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}
