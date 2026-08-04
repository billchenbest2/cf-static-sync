#!/usr/bin/env node
/** Fetch OK Mart stores from okmart.com.tw store locator. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeServiceIds } from './services.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RAW_DIR = path.join(ROOT, 'data/cvs/raw');
const API = 'https://www.okmart.com.tw/convenient_shop_search/ShopSearch/ShopSearchList';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://www.okmart.com.tw/convenient_shop_search'
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseServices(text) {
  const ids = [];
  if (/廁所|洗手間/.test(text)) ids.push('toilet');
  if (/ATM/i.test(text)) ids.push('atm');
  if (/24/.test(text)) ids.push('open_24h');
  if (/WiFi|Wi-Fi/i.test(text)) ids.push('wifi');
  if (/咖啡/.test(text)) ids.push('coffee');
  return mergeServiceIds(ids);
}

function normalize(row) {
  const code = String(row.StoreID || row.storeId || row.id || '').trim();
  const lat = parseFloat(row.Latitude || row.lat || row.Y);
  const lng = parseFloat(row.Longitude || row.lng || row.X);
  if (!code || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const nameRaw = String(row.StoreName || row.name || '').trim();
  const svcText = String(row.Service || row.service || '');
  return {
    storeId: `ok_${code}`,
    name: /^OK/.test(nameRaw) ? nameRaw : `OK${nameRaw}`,
    brandId: 'ok',
    lat,
    lng,
    address: String(row.Address || row.address || '').trim(),
    phone: String(row.Tel || row.phone || '').trim(),
    city: String(row.City || row.city || '').trim(),
    town: String(row.Area || row.area || '').trim(),
    services: parseServices(svcText),
    source: 'ok_official',
    sourceUpdatedAt: new Date().toISOString().slice(0, 10),
    status: 'open',
    sourceStoreCode: code
  };
}

export async function fetchAllOkStores(options = {}) {
  const delayMs = options.delayMs ?? 300;
  const cacheOnly = process.env.CVS_OK_CACHE_ONLY === '1';
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const snap = path.join(RAW_DIR, 'ok-stores.json');
  if (cacheOnly) {
    if (!fs.existsSync(snap)) throw new Error('CVS_OK_CACHE_ONLY=1 but ok-stores.json missing');
    const data = JSON.parse(fs.readFileSync(snap, 'utf8'));
    return Array.isArray(data) ? data : data.stores || [];
  }
  const all = [];
  for (let page = 1; page <= 50; page++) {
    process.stdout.write(`OK page ${page}...\r`);
    try {
      const url = `${API}?page=${page}&rows=200`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) break;
      const json = await res.json();
      const rows = json.rows || json.data || json.Data || [];
      if (!rows.length) break;
      for (const row of rows) {
        const s = normalize(row);
        if (s) all.push(s);
      }
      if (rows.length < 200) break;
    } catch (e) {
      console.warn(`OK page ${page} failed:`, e.message);
      break;
    }
    await sleep(delayMs);
  }
  process.stdout.write('\n');
  fs.writeFileSync(snap, JSON.stringify(all, null, 2), 'utf8');
  return all;
}
