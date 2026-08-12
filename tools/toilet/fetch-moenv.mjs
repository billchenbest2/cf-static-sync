#!/usr/bin/env node
/**
 * Fetch nationwide public toilet records from MOENV FAC_P_07.
 * Prefers MOENV_API_KEY; falls back to data.gov.tw published resource key;
 * TOILET_CACHE_ONLY=1 reads raw snapshot only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RAW_DIR = path.join(ROOT, 'data/toilet/raw');
const RAW_FILE = path.join(RAW_DIR, 'moenv-toilets.json');

const API_BASE = 'https://data.moenv.gov.tw/api/v2/fac_p_07';
/** Published on data.gov.tw dataset 30794 JSON resource (not a secret). */
const PUBLIC_FALLBACK_KEY = 'b7df779e-71a6-4148-8379-5afbd441d803';

function resolveApiKey() {
  const fromEnv = String(process.env.MOENV_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  return PUBLIC_FALLBACK_KEY;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchMoenvToilets(options = {}) {
  const cacheOnly = options.cacheOnly === true || process.env.TOILET_CACHE_ONLY === '1';
  fs.mkdirSync(RAW_DIR, { recursive: true });

  if (cacheOnly) {
    if (!fs.existsSync(RAW_FILE)) {
      throw new Error('TOILET_CACHE_ONLY=1 but missing ' + RAW_FILE);
    }
    const cached = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
    console.log('[toilet] cache-only loaded', cached.length, 'records');
    return cached;
  }

  const apiKey = resolveApiKey();
  const all = [];
  let offset = 0;
  const limit = Number(process.env.TOILET_PAGE_LIMIT || 1000) || 1000;
  const delayMs = Number(process.env.TOILET_FETCH_DELAY_MS || 800) || 800;

  while (true) {
    const url =
      API_BASE +
      '?language=zh&limit=' +
      limit +
      '&offset=' +
      offset +
      '&api_key=' +
      encodeURIComponent(apiKey);
    console.log('[toilet] fetch offset', offset);
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'PaymentMapTW-toilet-ingest/1.0' }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('MOENV API HTTP ' + res.status + ' ' + body.slice(0, 200));
    }
    const data = await res.json();
    let records;
    let total = null;
    if (Array.isArray(data)) {
      records = data;
    } else if (data && Array.isArray(data.records)) {
      records = data.records;
      total = data.total != null ? Number(data.total) : null;
    } else {
      throw new Error('Unexpected MOENV response shape');
    }
    if (!records.length) break;
    all.push(...records);
    offset += limit;
    if (total != null && all.length >= total) break;
    if (records.length < limit) break;
    await sleep(delayMs);
  }

  fs.writeFileSync(RAW_FILE, JSON.stringify(all), 'utf8');
  console.log('[toilet] wrote raw', all.length, '->', RAW_FILE);
  return all;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  fetchMoenvToilets()
    .then((rows) => {
      console.log('done', rows.length);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
