/** Merge same-location toilet units into site records + write county shards. */
import fs from 'node:fs';
import path from 'node:path';
import {
  gradeRank,
  hasChangingTable,
  hashId,
  normalizeAddressKey
} from './normalize.mjs';

const TYPE_ORDER = ['female', 'male', 'mixed', 'family', 'accessible'];
/** Nearby same-name units within this radius are one site (handles noisy lat/lng). */
const MERGE_RADIUS_M = 120;

function haversineM(a, b) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function nameKey(unit) {
  return String(unit.city || '') + '|' + String(unit.baseName || unit.name || '').trim();
}

function shouldMerge(a, b) {
  if (nameKey(a) !== nameKey(b)) return false;
  const addrA = normalizeAddressKey(a.address);
  const addrB = normalizeAddressKey(b.address);
  if (addrA && addrA === addrB) return true;
  return haversineM(a, b) <= MERGE_RADIUS_M;
}

function unionFindCluster(units) {
  const n = units.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (i, j) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shouldMerge(units[i], units[j])) unite(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(units[i]);
  }
  return [...groups.values()];
}

export function mergeToiletSites(units) {
  const byName = new Map();
  for (const u of units) {
    const key = nameKey(u);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(u);
  }

  const clusters = [];
  for (const list of byName.values()) {
    if (list.length === 1) clusters.push(list);
    else clusters.push(...unionFindCluster(list));
  }

  const sites = [];
  for (const list of clusters) {
    const types = new Set();
    let best = list[0];
    let bestRank = gradeRank(best.grade);
    let baby = false;
    let latSum = 0;
    let lngSum = 0;
    let addrPick = list[0];
    const unitsOut = [];
    const sourceIds = [];

    for (const u of list) {
      types.add(u.type);
      const r = gradeRank(u.grade);
      if (r > bestRank) {
        bestRank = r;
        best = u;
      }
      latSum += u.lat;
      lngSum += u.lng;
      if (String(u.address || '').length > String(addrPick.address || '').length) {
        addrPick = u;
      }
      const unitRec = {
        sourceId: u.sourceId,
        name: u.name,
        type: u.type,
        gradeZh: u.gradeZh,
        hasDiaper: !!u.hasDiaper
      };
      if (hasChangingTable({ ...u, ...unitRec })) {
        baby = true;
        unitRec.hasDiaper = true;
      }
      unitsOut.push(unitRec);
      if (u.sourceId) sourceIds.push(u.sourceId);
    }

    const typeList = TYPE_ORDER.filter((t) => types.has(t));
    for (const t of types) {
      if (!typeList.includes(t)) typeList.push(t);
    }

    const amenities = [];
    if (baby) amenities.push('baby_changing');

    sourceIds.sort();
    const siteId = 'toilet_' + hashId(sourceIds.length ? sourceIds : [nameKey(best) + list.length]);
    sites.push({
      siteId,
      name: best.baseName || String(best.name || '').trim(),
      lat: latSum / list.length,
      lng: lngSum / list.length,
      address: addrPick.address || best.address,
      city: best.city,
      town: addrPick.village || addrPick.town || best.village || best.town || '',
      grade: best.grade,
      gradeZh: best.gradeZh,
      category: best.category,
      categoryZh: best.categoryZh,
      types: typeList,
      amenities,
      units: unitsOut,
      administration: best.administration,
      manager: best.manager,
      countyEn: best.countyEn,
      source: 'moenv_fac_p_07',
      sourceUpdatedAt: new Date().toISOString().slice(0, 10),
      status: 'open',
      unitCount: unitsOut.length
    });
  }

  sites.sort((a, b) => String(a.siteId).localeCompare(String(b.siteId)));
  return sites;
}

export function writeToiletData(sites, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const byCounty = {};
  for (const s of sites) {
    const id = s.countyEn || 'Unknown';
    if (!byCounty[id]) byCounty[id] = [];
    byCounty[id].push(s);
  }

  for (const name of fs.readdirSync(outDir)) {
    if (/^sites-.+\.json$/.test(name)) {
      fs.unlinkSync(path.join(outDir, name));
    }
  }

  const counties = {};
  const countyCounts = {};
  for (const [countyEn, list] of Object.entries(byCounty)) {
    const file = 'sites-' + countyEn.toLowerCase() + '.json';
    const slim = list.map(({ countyEn: _c, ...rest }) => rest);
    fs.writeFileSync(path.join(outDir, file), JSON.stringify(slim), 'utf8');
    counties[countyEn] = { url: '/data/toilet/' + file, count: list.length };
    countyCounts[countyEn] = list.length;
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    count: sites.length,
    unitHint: sites.reduce((n, s) => n + (s.unitCount || 0), 0),
    countyCounts,
    counties,
    source: {
      id: 'FAC_P_07',
      name: '全國公廁建檔資料',
      provider: '環境部環境管理署'
    }
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}
