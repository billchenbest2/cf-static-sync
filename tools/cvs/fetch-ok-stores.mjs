#!/usr/bin/env node
/** Fetch OK Mart stores from ecservice.okmart.com.tw ECMapInquiry API. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllOkEcRows } from './okmart-ec-api.mjs';
import { parseOkServices } from './services.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RAW_DIR = path.join(ROOT, 'data/cvs/raw');

function formatOkHours(bgn, end) {
  const b = String(bgn || '').trim();
  const e = String(end || '').trim();
  if (!b || !e) return '';
  const fmt = (t) => (t.length >= 4 ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : t);
  return `${fmt(e)}~${fmt(b)}`;
}

function decodeNotOperate(code) {
  const n = parseInt(String(code || ''), 10);
  if (!Number.isFinite(n) || n <= 0) return '';
  const days = [];
  const map = [
    [1, '週一'],
    [2, '週二'],
    [4, '週三'],
    [8, '週四'],
    [16, '週五'],
    [32, '週六'],
    [64, '週日']
  ];
  for (const [bit, label] of map) {
    if (n & bit) days.push(label);
  }
  return days.length ? `休${days.join('、')}` : '';
}

function normalize(row) {
  const code = String(row.STNO || row.stno || '').trim();
  const lat = parseFloat(row.POS_WEIDU || row.pos_weidu);
  const lng = parseFloat(row.POS_JING || row.pos_jing);
  if (!code || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const nameRaw = String(row.STNM || row.stnm || '').trim();
  const hours = formatOkHours(row.BGN_TIME, row.END_TIME);
  const closedNote = decodeNotOperate(row.NOT_OPERATE);
  const hoursText = [hours, closedNote].filter(Boolean).join('；');

  return {
    storeId: `ok_${code}`,
    name: /^OK/i.test(nameRaw) ? nameRaw : `OK${nameRaw}`,
    brandId: 'ok',
    lat,
    lng,
    address: String(row.STADR || row.stadr || '').trim(),
    phone: String(row.STTEL || row.sttel || '').trim(),
    city: String(row.STCITY || row.stcity || '').trim(),
    town: String(row.STCNTRY || row.stcntry || '').trim(),
    hours: hoursText,
    services: parseOkServices(row),
    source: 'ok_ecservice',
    sourceUpdatedAt: new Date().toISOString().slice(0, 10),
    status: 'open',
    sourceStoreCode: code
  };
}

export async function fetchAllOkStores(options = {}) {
  const delayMs = options.delayMs ?? 180;
  const cacheOnly = process.env.CVS_OK_CACHE_ONLY === '1';
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const snap = path.join(RAW_DIR, 'ok-stores.json');
  if (cacheOnly) {
    if (!fs.existsSync(snap)) throw new Error('CVS_OK_CACHE_ONLY=1 but ok-stores.json missing');
    const data = JSON.parse(fs.readFileSync(snap, 'utf8'));
    return Array.isArray(data) ? data : data.stores || [];
  }

  const cityFilter = process.env.CVS_OK_CITY
    ? process.env.CVS_OK_CITY.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const byStno = await fetchAllOkEcRows({ delayMs, cityFilter });
  const all = [];
  for (const row of byStno.values()) {
    const s = normalize(row);
    if (s) all.push(s);
  }
  all.sort((a, b) => a.storeId.localeCompare(b.storeId));
  fs.writeFileSync(snap, JSON.stringify(all, null, 2), 'utf8');
  return all;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  fetchAllOkStores()
    .then((rows) => console.log(`OK stores: ${rows.length}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
