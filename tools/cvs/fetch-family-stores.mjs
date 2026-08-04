#!/usr/bin/env node
/** Fetch FamilyMart stores from api.map.com.tw */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFamilyServices } from './services.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RAW_DIR = path.join(ROOT, 'data/cvs/raw');
const BASE = 'https://api.map.com.tw/net/familyShop.aspx';
const FAMILY_KEY = '6F30E8BF706D653965BDE302661D1241F8BE9EBC';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.family.com.tw/Marketing/inquiry',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
};

const CITIES = [
  '基隆市',
  '台北市',
  '新北市',
  '桃園市',
  '新竹市',
  '新竹縣',
  '苗栗縣',
  '台中市',
  '彰化縣',
  '南投縣',
  '雲林縣',
  '嘉義市',
  '嘉義縣',
  '台南市',
  '高雄市',
  '屏東縣',
  '宜蘭縣',
  '花蓮縣',
  '台東縣',
  '澎湖縣',
  '金門縣',
  '連江縣'
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseJsonp(text, fnName) {
  const s = String(text || '').trim();
  const prefix = `${fnName}(`;
  if (!s.startsWith(prefix)) {
    const start = s.indexOf('[');
    const end = s.lastIndexOf(']');
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    return [];
  }
  const inner = s.slice(prefix.length, s.lastIndexOf(')'));
  return JSON.parse(inner);
}

async function postFamily(params) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: HEADERS,
    body: new URLSearchParams({ ...params, key: FAMILY_KEY, type: '' })
  });
  if (!res.ok) throw new Error(`Family HTTP ${res.status}`);
  return res.text();
}

async function fetchTowns(city) {
  const text = await postFamily({
    searchType: 'ShowTownList',
    city,
    area: '',
    road: '',
    fun: 'showTownList'
  });
  const rows = parseJsonp(text, 'showTownList');
  return rows.map((r) => String(r.town || r.Town || '').trim()).filter(Boolean);
}

function normalizeFamilyStore(row, city, town) {
  const code = String(row.pkey || row.PKEY || row.storeid || '').trim();
  const nameRaw = String(row.NAME || row.name || '').trim();
  const lat = parseFloat(row.py ?? row.lat ?? row.latitude);
  const lng = parseFloat(row.px ?? row.lng ?? row.longitude);
  if (!code || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const svcRaw = row.all || row.SERVICES || row.services || '';
  const twoice = row.twoice ?? null;
  const services = parseFamilyServices(String(svcRaw), twoice);
  return {
    storeId: `family_${code}`,
    name: /^全家/.test(nameRaw) ? nameRaw : `全家${nameRaw}`,
    brandId: 'family',
    lat,
    lng,
    address: String(row.addr || row.address || `${city}${town}`).trim(),
    phone: String(row.TEL || row.tel || '').trim(),
    city,
    town,
    services,
    sourceAll: String(svcRaw || ''),
    twoice,
    source: 'family_official',
    sourceUpdatedAt: new Date().toISOString().slice(0, 10),
    status: 'open',
    sourceStoreCode: code
  };
}

export async function fetchAllFamilyStores(options = {}) {
  const delayMs = options.delayMs ?? 200;
  const cacheOnly = process.env.CVS_FAMILY_CACHE_ONLY === '1';
  fs.mkdirSync(RAW_DIR, { recursive: true });

  if (cacheOnly) {
    const snap = path.join(RAW_DIR, 'family-stores.json');
    if (fs.existsSync(snap)) {
      const data = JSON.parse(fs.readFileSync(snap, 'utf8'));
      return Array.isArray(data) ? data : data.stores || [];
    }
    throw new Error('CVS_FAMILY_CACHE_ONLY=1 but data/cvs/raw/family-stores.json missing');
  }

  const all = [];
  for (const city of CITIES) {
    let towns = [];
    try {
      towns = await fetchTowns(city);
    } catch (e) {
      console.warn(`Family towns failed ${city}:`, e.message);
    }
    await sleep(delayMs);
    if (!towns.length) towns = [''];
    for (const town of towns) {
      process.stdout.write(`Family ${city}/${town || '*'}...\r`);
      try {
        const text = await postFamily({
          searchType: 'ShopList',
          city,
          area: town,
          road: '',
          fun: 'showStoreList'
        });
        const rows = parseJsonp(text, 'showStoreList');
        for (const row of rows) {
          const s = normalizeFamilyStore(row, city, town);
          if (s) all.push(s);
        }
      } catch (e) {
        console.warn(`Family fetch failed ${city}/${town}:`, e.message);
      }
      await sleep(delayMs);
    }
  }
  process.stdout.write('\n');
  fs.writeFileSync(path.join(RAW_DIR, 'family-stores.json'), JSON.stringify(all, null, 2), 'utf8');
  return all;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1].replace(/\\/g, '/')))) {
  fetchAllFamilyStores()
    .then((s) => console.log(`Family stores: ${s.length}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
