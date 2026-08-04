/**
 * Fetch Formosa-network stations from FPCC official station locator.
 * Source: https://www.fpcc.com.tw/tw/events/stations
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrandId } from './brands.mjs';
import { normalizeAddressKey } from './geocode-address.mjs';
import { parseFpccServices, parseFpccHours } from './services.mjs';
import { mergeExternalStations } from './station-merge.mjs';
import { closeFpccBrowser, fetchHtmlWithPlaywright } from './fetch-fpcc-playwright.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, '../../data/gas/raw');
const BASE = 'https://www.fpcc.com.tw/tw/events/stations';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const USER_AGENT = 'PaymentMapTW-gas-station-bot/1.0';

export const FPCC_CITIES = [
  '臺北市', '基隆市', '新北市', '連江縣', '宜蘭縣', '新竹縣', '桃園市', '苗栗縣',
  '臺中市', '彰化縣', '南投縣', '嘉義縣', '雲林縣', '臺南市', '高雄市', '澎湖縣',
  '金門縣', '屏東縣', '臺東縣', '花蓮縣', '新竹市', '嘉義市'
];

const PRODUCT_MAP = {
  '92無鉛汽油': '92',
  '95+無鉛汽油': '95',
  '98無鉛汽油': '98',
  '超級柴油': 'diesel'
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fpccCachePath(city) {
  return path.join(RAW_DIR, `fpcc-${city.replace(/[\\/]/g, '_')}.html`);
}

/** FPCC may return a captcha / empty shell to datacenter IPs (e.g. GitHub Actions). */
function isFpccBlockedHtml(html) {
  if (!html || html.length < 8000) return true;
  if (/安全驗證|Security Verification|captcha|cf-challenge/i.test(html)) return true;
  // Valid locator page (some counties legitimately have zero stations).
  if (/加油站查詢|台塑石化股份有限公司/i.test(html)) return false;
  return true;
}

function readFpccCache(city) {
  const cachePath = fpccCachePath(city);
  if (!fs.existsSync(cachePath)) return null;
  const html = fs.readFileSync(cachePath, 'utf8');
  if (isFpccBlockedHtml(html)) return null;
  return html;
}

async function fetchFpccCityHtmlPlaywright(city) {
  const url = `${BASE}/${encodeURIComponent(city)}/0/0/0`;
  return fetchHtmlWithPlaywright(url);
}

async function fetchFpccCityHtml(city) {
  const url = `${BASE}/${encodeURIComponent(city)}/0/0/0`;
  const attempts = [
    {
      label: 'chrome-referer',
      headers: {
        'User-Agent': CHROME_UA,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        Referer: 'https://www.fpcc.com.tw/tw/events/stations',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    },
    {
      label: 'bot-ua',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9'
      }
    }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const res = await fetch(url, { headers: attempt.headers, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (!isFpccBlockedHtml(html)) return html;
      lastError = new Error(`${attempt.label} blocked`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('fetch blocked');
}

function fpccStationId(lat, lng, address) {
  const base = `${lat},${lng},${normalizeAddressKey(address)}`;
  const hash = crypto.createHash('sha256').update(base).digest('hex').slice(0, 10);
  return `fpcc_${hash}`;
}

function parseCityTown(address) {
  const m = String(address || '').match(/^(.+?[縣市])(.+?[區鄉鎮市])/);
  if (!m) return { city: '', town: '' };
  return { city: m[1], town: m[2] };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseProductsFromSatlist(html, index) {
  const block = html.match(new RegExp(`id="satlist${index}"[\\s\\S]*?</li>`))?.[0] || '';
  const products = [];
  for (const [label, pid] of Object.entries(PRODUCT_MAP)) {
    const m = block.match(
      new RegExp(`data-title="${escapeRegExp(label)}"[^>]*>([\\s\\S]*?)<\\/div>`)
    );
    if (m && /◯/.test(m[1])) products.push(pid);
  }
  return products;
}

function parseServicesFromSatlist(html, index) {
  const block = html.match(new RegExp(`id="satlist${index}"[\\s\\S]*?</li>`))?.[0] || '';
  return parseFpccServices(block);
}

function parseFpccCityPage(html) {
  const list = [];
  const items = [
    ...html.matchAll(
      /class="li-item" data-id="([^"]+)"[\s\S]*?<h2>([^<]+)<\/h2>\s*<p>([^<]+)<\/p>\s*<p>([^<]*)<\/p>/g
    )
  ];
  items.forEach((m, index) => {
    const [latStr, lngStr] = String(m[1]).split(',');
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const name = String(m[2]).trim();
    const address = String(m[3]).replace(/\s+/g, '');
    const phone = String(m[4] || '').trim();
    const { city, town } = parseCityTown(address);
    const block = html.match(new RegExp(`id="satlist${index}"[\\s\\S]*?</li>`))?.[0] || '';
    const brandId = resolveBrandId(name, name);
    list.push({
      stationId: fpccStationId(lat, lng, address),
      name,
      lat,
      lng,
      address,
      phone,
      city,
      town,
      brandId: brandId === 'cpc' || brandId === 'other' ? 'formosa' : brandId,
      franchiseType: 'unknown',
      oilSupply: 'formosa',
      products: parseProductsFromSatlist(html, index),
      services: parseServicesFromSatlist(html, index),
      hours: parseFpccHours(block) || undefined,
      source: 'fpcc_official',
      sourceUpdatedAt: new Date().toISOString().slice(0, 10),
      status: 'open'
    });
  });
  return list;
}

export async function fetchAllFpccStations() {
  const all = [];
  fs.mkdirSync(RAW_DIR, { recursive: true });
  let liveOk = 0;
  let playwrightOk = 0;
  let cacheOk = 0;
  let failed = 0;
  const usePlaywright = process.env.FPCC_SKIP_PLAYWRIGHT !== '1';

  try {
    for (const city of FPCC_CITIES) {
      const cachePath = fpccCachePath(city);
      let html = '';
      let via = 'live';

      try {
        html = await fetchFpccCityHtml(city);
        if (isFpccBlockedHtml(html)) {
          html = '';
        } else {
          fs.writeFileSync(cachePath, html, 'utf8');
          liveOk++;
        }
      } catch (e) {
        console.warn(`FPCC ${city}: plain fetch failed (${e.message})`);
        html = '';
      }

      if (!html && usePlaywright) {
        try {
          const pwHtml = await fetchFpccCityHtmlPlaywright(city);
          if (!isFpccBlockedHtml(pwHtml)) {
            html = pwHtml;
            via = 'playwright';
            fs.writeFileSync(cachePath, html, 'utf8');
            playwrightOk++;
          } else {
            console.warn(`FPCC ${city}: playwright blocked`);
          }
        } catch (e) {
          console.warn(`FPCC ${city}: playwright failed (${e.message})`);
        }
      }

      if (!html) {
        const cached = readFpccCache(city);
        if (cached) {
          html = cached;
          via = 'cache';
          cacheOk++;
        } else {
          console.warn(`FPCC ${city}: no live/playwright/cache source`);
          failed++;
          await sleep(350);
          continue;
        }
      }

      const rows = parseFpccCityPage(html);
      const tag =
        via === 'cache' ? '(cache)' : via === 'playwright' ? '(playwright)' : '';
      console.log('FPCC', city, rows.length, tag);
      all.push(...rows);
      await sleep(via === 'playwright' ? 600 : 350);
    }
  } finally {
    await closeFpccBrowser();
  }

  console.log(
    `FPCC summary: live=${liveOk} playwright=${playwrightOk} cache=${cacheOk} failed=${failed} total=${all.length}`
  );
  if (all.length === 0) {
    throw new Error('FPCC ingest produced 0 stations (live/playwright blocked and no cache)');
  }
  return all;
}

export function mergeFpccStations(cpcStations, fpccStations) {
  return mergeExternalStations(cpcStations, fpccStations, 'FPCC');
}
