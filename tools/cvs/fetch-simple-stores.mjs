#!/usr/bin/env node
/** Fetch Simple Mart stores from simplemart.com.tw store list. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeServiceIds } from './services.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RAW_DIR = path.join(ROOT, 'data/cvs/raw');
const API = 'https://www.simplemart.com.tw/shop/shop_ajax';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://www.simplemart.com.tw/shop',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseServices(text) {
  const ids = [];
  if (/廁所|洗手間/.test(text)) ids.push('toilet');
  if (/ATM/i.test(text)) ids.push('atm');
  if (/24/.test(text)) ids.push('open_24h');
  if (/生鮮/.test(text)) ids.push('fresh_food');
  if (/停車/.test(text)) ids.push('parking');
  return mergeServiceIds(ids);
}

function normalize(row) {
  const code = String(row.store_code || row.id || row.shop_id || '').trim();
  const lat = parseFloat(row.lat || row.latitude);
  const lng = parseFloat(row.lng || row.longitude);
  if (!code || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const nameRaw = String(row.store_name || row.name || '').trim();
  const svcText = String(row.service || row.services || '');
  return {
    storeId: `simple_${code}`,
    name: /^美廉社/.test(nameRaw) ? nameRaw : `美廉社${nameRaw}`,
    brandId: 'simple',
    lat,
    lng,
    address: String(row.address || '').trim(),
    phone: String(row.tel || row.phone || '').trim(),
    city: String(row.city || '').trim(),
    town: String(row.area || row.town || '').trim(),
    services: parseServices(svcText),
    source: 'simple_official',
    sourceUpdatedAt: new Date().toISOString().slice(0, 10),
    status: 'open',
    sourceStoreCode: code
  };
}

export async function fetchAllSimpleStores(options = {}) {
  const delayMs = options.delayMs ?? 300;
  const cacheOnly = process.env.CVS_SIMPLE_CACHE_ONLY === '1';
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const snap = path.join(RAW_DIR, 'simple-stores.json');
  if (cacheOnly) {
    if (!fs.existsSync(snap)) throw new Error('CVS_SIMPLE_CACHE_ONLY=1 but simple-stores.json missing');
    const data = JSON.parse(fs.readFileSync(snap, 'utf8'));
    return Array.isArray(data) ? data : data.stores || [];
  }
  const all = [];
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: HEADERS,
      body: new URLSearchParams({ action: 'get_all_stores' })
    });
    if (res.ok) {
      const json = await res.json();
      const rows = json.data || json.stores || json || [];
      for (const row of rows) {
        const s = normalize(row);
        if (s) all.push(s);
      }
    }
  } catch (e) {
    console.warn('Simple Mart fetch failed:', e.message);
  }
  await sleep(delayMs);
  fs.writeFileSync(snap, JSON.stringify(all, null, 2), 'utf8');
  return all;
}
