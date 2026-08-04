#!/usr/bin/env node
/**
 * Fetch Hi-Life stores via VIP app API (GET store.aspx?district=) + optional webapi service flags.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHiLifeServices } from './services.mjs';
import { fetchAllHiLifeAppStores } from './hilife-app-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RAW_DIR = path.join(ROOT, 'data/cvs/raw');
/** Legacy OSM/APK artifacts superseded by app API district fetch. */
const LEGACY_HILIFE_RAW = ['hilife-osm.json', 'hilife-apk-scan.json', 'hilife-api-data.jwt'];

function cleanupLegacyHiLifeRaw() {
  for (const name of LEGACY_HILIFE_RAW) {
    const p = path.join(RAW_DIR, name);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log('Removed legacy', name);
    }
  }
  const apkDir = path.join(RAW_DIR, 'apk');
  if (fs.existsSync(apkDir)) {
    fs.rmSync(apkDir, { recursive: true, force: true });
    console.log('Removed legacy apk/');
  }
}

const BASE = 'https://www.hilife.com.tw';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseSetCookie(headers) {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  const jar = new Map();
  for (const line of raw) {
    const part = String(line).split(';')[0];
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return jar;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchWithCookies(url, jar, init = {}) {
  const headers = { 'User-Agent': UA, ...(init.headers || {}) };
  const ck = cookieHeader(jar);
  if (ck) headers.Cookie = ck;
  const res = await fetch(url, { ...init, headers });
  for (const [k, v] of parseSetCookie(res.headers)) jar.set(k, v);
  return res;
}

async function fetchWebApiServiceFlags() {
  const snap = path.join(RAW_DIR, 'hilife-webapi-flags.json');
  if (process.env.CVS_HILIFE_WEBAPI_CACHE_ONLY === '1' && fs.existsSync(snap)) {
    return JSON.parse(fs.readFileSync(snap, 'utf8'));
  }
  if (process.env.CVS_HILIFE_SKIP_WEBAPI === '1') return {};

  const jar = new Map();
  await fetchWithCookies(`${BASE}/storeInquiry_street.aspx`, jar);
  await fetchWithCookies(`${BASE}/webapi/api/AntiForgery/GetAntiForgeryToken`, jar);
  const xsrf = jar.get('X-XSRF-TOKEN') || '';
  if (!xsrf) {
    console.warn('Hi-Life webapi XSRF missing; skipping service flag merge');
    return {};
  }

  async function hiLifePost(apiPath, body) {
    const res = await fetchWithCookies(`${BASE}/webapi/api/${apiPath}`, jar, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: BASE,
        Referer: `${BASE}/storeInquiry_street.aspx`,
        'X-XSRF-TOKEN': xsrf
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!text.trim().startsWith('{')) return null;
    const json = JSON.parse(text);
    return json?.StatusCode === 0 ? json : null;
  }

  const dist = await hiLifePost('DistrictList/GetDistrictList', {});
  if (!dist?.Entries?.length) {
    console.warn('Hi-Life webapi district list empty; skipping service flag merge');
    return {};
  }

  const flagsById = {};
  const delayMs = 280;
  for (const city of dist.Entries) {
    const towns = city.towns?.length ? city.towns : [{ town_id: '', town_name: '' }];
    for (const town of towns) {
      process.stdout.write(`Hi-Life webapi ${city.city_name}${town.town_name || ''}...\r`);
      const json = await hiLifePost('ShopServices/GetShopServices', {
        City_Id: city.city_id,
        Town_Id: town.town_id || '',
        Shop_Id: '',
        Services: [],
        Shop_Name: ''
      });
      for (const row of json?.Entries || []) {
        flagsById[String(row.shop_id)] = row;
      }
      await sleep(delayMs);
    }
  }
  process.stdout.write('\n');
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(snap, JSON.stringify(flagsById, null, 2), 'utf8');
  console.log(`Hi-Life webapi service flags: ${Object.keys(flagsById).length}`);
  return flagsById;
}

function parseCityTown(address, fallbackCity, fallbackTown) {
  const m = String(address || '').match(/(\d{3,5})?(?:台|臺)?(.{2,3}[縣市])(.{1,4}[區鄉鎮市])/);
  if (m) return { city: m[2].replace(/臺/g, '台'), town: m[3] };
  return { city: fallbackCity || '', town: fallbackTown || '' };
}

function normalize(row, flagsRow) {
  const code = String(row.id || '').trim();
  const lat = parseFloat(row.latitude);
  const lng = parseFloat(row.longitude);
  if (!code || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const nameRaw = String(row.name || '').trim();
  const { city, town } = parseCityTown(row.address, row._cityName, row._townName);
  const services = parseHiLifeServices({ ...flagsRow, ...row });
  return {
    storeId: `hilife_${code}`,
    name: /^萊爾富/.test(nameRaw) ? nameRaw : `萊爾富${nameRaw}`,
    brandId: 'hilife',
    lat,
    lng,
    address: String(row.address || '').trim(),
    phone: String(row.phone || '').trim(),
    city,
    town,
    services,
    source: flagsRow ? 'hilife_app+webapi' : 'hilife_app',
    sourceUpdatedAt: new Date().toISOString().slice(0, 10),
    status: 'open',
    sourceStoreCode: code,
    coordProvider: 'hilife_app'
  };
}

export async function fetchAllHiLifeStores(options = {}) {
  const cacheOnly = process.env.CVS_HILIFE_CACHE_ONLY === '1';
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const snap = path.join(RAW_DIR, 'hilife-stores.json');
  if (cacheOnly) {
    if (!fs.existsSync(snap)) throw new Error('CVS_HILIFE_CACHE_ONLY=1 but hilife-stores.json missing');
    const data = JSON.parse(fs.readFileSync(snap, 'utf8'));
    return Array.isArray(data) ? data : data.stores || [];
  }

  const appById = await fetchAllHiLifeAppStores({ delayMs: options.appDelayMs ?? 180 });
  const flagsById = await fetchWebApiServiceFlags();

  const all = [];
  for (const row of appById.values()) {
    const flags = flagsById[String(row.id)] || null;
    const store = normalize(row, flags);
    if (store) all.push(store);
  }
  console.log(`Hi-Life export: ${all.length} stores with coords`);

  fs.writeFileSync(snap, JSON.stringify(all, null, 2), 'utf8');
  cleanupLegacyHiLifeRaw();
  return all;
}
