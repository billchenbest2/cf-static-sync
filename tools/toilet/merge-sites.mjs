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

function roundCoord(n) {
  return Math.round(Number(n) * 1e4) / 1e4;
}

function mergeKey(unit) {
  const addr = normalizeAddressKey(unit.address);
  const base = String(unit.baseName || unit.name || '').trim();
  return [addr, roundCoord(unit.lat), roundCoord(unit.lng), base].join('::');
}

export function mergeToiletSites(units) {
  const groups = new Map();
  for (const u of units) {
    const key = mergeKey(u);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }

  const sites = [];
  for (const [key, list] of groups) {
    const types = new Set();
    let best = list[0];
    let bestRank = gradeRank(best.grade);
    let baby = false;
    const unitsOut = [];

    for (const u of list) {
      types.add(u.type);
      const r = gradeRank(u.grade);
      if (r > bestRank) {
        bestRank = r;
        best = u;
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
    }

    const typeList = TYPE_ORDER.filter((t) => types.has(t));
    for (const t of types) {
      if (!typeList.includes(t)) typeList.push(t);
    }

    const amenities = [];
    if (baby) amenities.push('baby_changing');

    const siteId = 'toilet_' + hashId([key]);
    sites.push({
      siteId,
      name: best.baseName || String(best.name || '').trim(),
      lat: best.lat,
      lng: best.lng,
      address: best.address,
      city: best.city,
      town: best.village || best.town || '',
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
