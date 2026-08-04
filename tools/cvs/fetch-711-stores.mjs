#!/usr/bin/env node
/** Fetch 7-ELEVEN stores from emap.pcsc.com.tw */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse711ServicesFromXml } from './services.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RAW_DIR = path.join(ROOT, 'data/cvs/raw');
const EMAP_URL = 'https://emap.pcsc.com.tw/EMapSDK.aspx';
const AREA_URL = 'https://emap.pcsc.com.tw/lib/areacode.js';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://emap.pcsc.com.tw/emap.aspx',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
}

function parseAreaCodeJs(text) {
  const areas = [];
  const re = /new AreaNode\('([^']*)',\s*new bu\([^)]+\),\s*'(\d+)'\)/g;
  let m;
  while ((m = re.exec(text))) {
    const city = m[1].trim();
    if (!city) continue;
    areas.push({ city, code: m[2] });
  }
  return areas;
}

async function postForm(body) {
  const res = await fetch(EMAP_URL, { method: 'POST', headers: HEADERS, body });
  if (!res.ok) throw new Error(`711 HTTP ${res.status}`);
  return res.text();
}

async function fetchTowns(cityId) {
  const text = await postForm(`commandid=GetTown&cityid=${encodeURIComponent(cityId)}&leftMenuChecked=`);
  const towns = [];
  const re = /<TownName>([^<]+)<\/TownName>/g;
  let m;
  while ((m = re.exec(text))) towns.push(m[1].trim());
  return towns;
}

function parseStoresXml(xml, city, town) {
  const parts = xml.split('<GeoPosition>');
  const list = [];
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].split('</GeoPosition>')[0] || '';
    const code = tag(chunk, 'POIID');
    const nameRaw = tag(chunk, 'POIName');
    const lat = parseFloat(tag(chunk, 'Y')) / 1e6;
    const lng = parseFloat(tag(chunk, 'X')) / 1e6;
    if (!code || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const services = parse711ServicesFromXml(chunk);
    const hours = services.includes('open_24h') ? '24小時' : tag(chunk, 'StoreOpenTime') || undefined;
    const imageTitle = tag(chunk, 'StoreImageTitle') || '';
    list.push({
      storeId: `711_${code}`,
      name: /7-ELEVEN|7-11/i.test(nameRaw) ? `${nameRaw}門市` : `7-ELEVEN ${nameRaw}門市`,
      brandId: '711',
      lat,
      lng,
      address: tag(chunk, 'Address') || `${city}${town}`,
      phone: tag(chunk, 'Telno') || '',
      city,
      town,
      services,
      sourceImageTitle: imageTitle,
      hours,
      source: '711_official',
      sourceUpdatedAt: new Date().toISOString().slice(0, 10),
      status: 'open',
      sourceStoreCode: code
    });
  }
  return list;
}

export async function fetchAll711Stores(options = {}) {
  const delayMs = options.delayMs ?? 120;
  const cacheOnly = process.env.CVS_711_CACHE_ONLY === '1';
  fs.mkdirSync(RAW_DIR, { recursive: true });

  if (cacheOnly) {
    const snap = path.join(RAW_DIR, '711-stores.json');
    if (fs.existsSync(snap)) {
      const data = JSON.parse(fs.readFileSync(snap, 'utf8'));
      return Array.isArray(data) ? data : data.stores || [];
    }
    throw new Error('CVS_711_CACHE_ONLY=1 but data/cvs/raw/711-stores.json missing');
  }

  const areaText = await (await fetch(AREA_URL, { headers: HEADERS })).text();
  const areas = parseAreaCodeJs(areaText);
  const all = [];
  for (const area of areas) {
    let towns = [];
    try {
      towns = await fetchTowns(area.code);
    } catch (e) {
      console.warn(`711 towns failed ${area.city}:`, e.message);
    }
    await sleep(delayMs);
    for (const town of towns) {
      process.stdout.write(`711 ${area.city}/${town}...\r`);
      try {
        const xml = await postForm(
          `commandid=SearchStore&city=${encodeURIComponent(area.city)}&town=${encodeURIComponent(town)}`
        );
        all.push(...parseStoresXml(xml, area.city, town));
      } catch (e) {
        console.warn(`711 fetch failed ${area.city}/${town}:`, e.message);
      }
      await sleep(delayMs);
    }
  }
  process.stdout.write('\n');
  fs.writeFileSync(path.join(RAW_DIR, '711-stores.json'), JSON.stringify(all, null, 2), 'utf8');
  return all;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  fetchAll711Stores()
    .then((s) => console.log(`711 stores: ${s.length}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
