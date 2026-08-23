import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import {
  parseCubeModel,
  parseRichartHtml,
  mergeRichartWithLegacy,
  parseUnicardHtml,
  parseCtbcLinepayHtml,
  parseHsbcHtml,
  parseUbotHtml,
  resolveUbotHtmlUrl,
  UBOT_CARD_URL,
  parseTableMiles,
  parseCathayAirmilesModel,
  parseOpenpointMiles,
  parseEsunMilesEntries,
  parseDbsMilesCategories,
  parseHsbcFlyMiles,
  parseHsbcTravelCardData,
  HSBC_TRAVEL_TIER_URLS,
  HSBC_TRAVEL_INDEX_URL,
  DBS_MILES_PAGE_CONFIG,
  validateParsedOutput,
  mergeCubeWithLegacy,
  mergeCathayAsiaMilesWithLegacy,
  stableJsonStringify,
  parseCathayAsiaMilesHtml,
  parseCathayAsiaMilesModel,
  isCtbcBotChallengeHtml,
  looksLikeCtbcCalHtml,
  parseEsunStarluxHtml,
  parseCtbcCalHtml,
  parseDbsAovMerchants,
  mergeDbsAovCrawledData,
} from './parsers.mjs';

const ROOT = path.resolve(process.cwd());
const OUTPUT_ROOT = process.env.CRAWLER_OUTPUT_DIR
  ? path.resolve(process.env.CRAWLER_OUTPUT_DIR)
  : ROOT;
/** Prefer this tree when merging with legacy (e.g. CardSwitch checkout). */
const LEGACY_ROOT = process.env.CRAWLER_LEGACY_ROOT
  ? path.resolve(process.env.CRAWLER_LEGACY_ROOT)
  : ROOT;
const PREVIEW_MODE = Boolean(process.env.CRAWLER_OUTPUT_DIR);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const SOURCES = {
  cubeModel:
    'https://www.cathay-cube.com.tw/cathaybk/personal/product/credit-card/cards/cube-list.model.json',
  richart: 'https://mkp.taishinbank.com.tw/s/2025/RichartCard_2025/index.html',
  unicard:
    'https://www.esunbank.com/zh-tw/personal/credit-card/intro/bank-card/unicard',
  ctbcLinepay:
    'https://www.ctbcbank.com/content/dam/minisite/long/creditcard/LINEPay/store.html',
  hsbc: 'https://www.hsbc.com.tw/credit-cards/products/liveplus/',
  ubot: UBOT_CARD_URL,
  taishinMiles:
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vTWMlf7b4nsU3YseeBEM9HQHBLYd5wL0YueDuI9uJP5yIsduWVcxYeq8zUyJFOTdsUdGJLVlS94yLjw/pubhtml/sheet?headers=false&gid=1389283058',
  cathayMiles:
    'https://www.cathay-cube.com.tw/cathaybk/personal/event/overview/credit-card/bonus/point-exchange/airmiles.model.json',
  openpointMiles: 'https://www.7-11.com.tw/openpoint_event1/22_exchange/index.html',
  esunMilesApi:
    'https://rewards.esunbank.com.tw/reward/webapi/Product/GetProductlist',
  dbsMilesBonus:
    'https://www.dbs.com.tw/personal-zh/cards/rewards/bonus_redeem_mileage',
  dbsMilesCash:
    'https://www.dbs.com.tw/personal-zh/cards/rewards/cash-redeem-mileage',
  dbsMilesFly:
    'https://www.dbs.com.tw/personal-zh/cards/rewards/fly_redeem_mileage',
  dbsMilesPchome:
    'https://www.dbs.com.tw/personal-zh/cards/rewards/pchome-redeem-mileage',
  hsbcFlyMiles:
    'https://shop.hsbc.com.tw/installments/creditcard/rewards/fly.html',
  cathayAsiaMiles:
    'https://www.cathay-cube.com.tw/cathaybk/personal/product/credit-card/cards/asia-miles',
  cathayAsiaMilesModel:
    'https://www.cathay-cube.com.tw/cathaybk/personal/product/credit-card/cards/asia-miles.model.json',
  esunStarlux:
    'https://www.esunbank.com/zh-tw/personal/credit-card/intro/co-branded-card/starlux-card',
  ctbcCal:
    'https://www.ctbcbank.com/content/dam/minisite/long/creditcard/CTBCCI/index.html',
  dbsAov: 'https://www.dbs.com.tw/personal-zh/cards/dbs-aov/index.html',
};

const MILES_OUTPUT = {
  taishin: 'miles_data/taishin_miles_data.json',
  esun: 'miles_data/esun_miles_data.json',
  cathay: 'miles_data/cathay_miles_data.json',
  openpoint: 'miles_data/openpoint_miles_data.json',
  dbs: 'miles_data/dbs_miles_data.json',
  hsbc: 'miles_data/hsbc_miles_data.json',
};

const changeLog = {
  updated: [],
  unchanged: [],
  skipped: [],
};

async function main() {
  try {
    if (PREVIEW_MODE) {
      console.log(`Preview mode: writing to ${OUTPUT_ROOT}`);
    }
    changeLog.updated = [];
    changeLog.unchanged = [];
    changeLog.skipped = [];
    await runCrawler();
    await publishChangeSummary();
  } catch (error) {
    await publishChangeSummary();
    const msg = `Card crawler failed\n${String(error?.stack || error)}`;
    await sendTelegram(msg);
    throw error;
  }
}

async function runCrawler() {
  const cube = await crawlCube();
  await writeJson('cards/builtin/cathay/data.json', cube);

  const richart = await crawlRichart();
  await writeJson('cards/builtin/taishin/data.json', richart);

  try {
    const unicard = await crawlUnicard();
    await writeJson('cards/builtin/esun/data.json', unicard);
  } catch (error) {
    if (error?.code === 'UNICARD_OUT_OF_RANGE') {
      changeLog.skipped.push('cards/builtin/esun/data.json');
      console.log(`skipped (out of date range): cards/builtin/esun/data.json`);
    } else {
      throw error;
    }
  }

  const ctbc = await crawlCtbcLinepay();
  await writeJson('cards/builtin/ctbcLinepay/data.json', ctbc);

  const hsbc = await crawlHsbc();
  await writeJson('cards/builtin/hsbc/data.json', hsbc);

  const ubot = await crawlUbot();
  await writeJson('cards/builtin/ubot/data.json', ubot);

  try {
    const cathayAsiaMiles = await crawlCathayAsiaMiles();
    await writeJson('cards/builtin/cathayAsiaMiles/data.json', cathayAsiaMiles);
  } catch (error) {
    changeLog.skipped.push('cards/builtin/cathayAsiaMiles/data.json');
    console.log(`skipped (crawl failed): cards/builtin/cathayAsiaMiles/data.json — ${error?.message || error}`);
  }

  try {
    const esunStarlux = await crawlEsunStarlux();
    await writeJson('cards/builtin/esunStarlux/data.json', esunStarlux);
  } catch (error) {
    changeLog.skipped.push('cards/builtin/esunStarlux/data.json');
    console.log(`skipped (crawl failed): cards/builtin/esunStarlux/data.json — ${error?.message || error}`);
  }

  try {
    const hsbcTravel = await crawlHsbcTravel();
    await writeJson('cards/builtin/hsbcTravel/data.json', hsbcTravel);
  } catch (error) {
    changeLog.skipped.push('cards/builtin/hsbcTravel/data.json');
    console.log(`skipped (crawl failed): cards/builtin/hsbcTravel/data.json — ${error?.message || error}`);
  }

  try {
    const ctbcCal = await crawlCtbcCal();
    await writeJson('cards/builtin/ctbcCal/data.json', ctbcCal);
  } catch (error) {
    changeLog.skipped.push('cards/builtin/ctbcCal/data.json');
    console.log(`skipped (crawl failed): cards/builtin/ctbcCal/data.json — ${error?.message || error}`);
  }

  try {
    const dbsAov = await crawlDbsAov();
    await writeJson('cards/builtin/dbsAov/data.json', dbsAov);
  } catch (error) {
    changeLog.skipped.push('cards/builtin/dbsAov/data.json');
    console.log(`skipped (crawl failed): cards/builtin/dbsAov/data.json — ${error?.message || error}`);
  }

  const miles = await crawlMiles();
  for (const [key, relPath] of Object.entries(MILES_OUTPUT)) {
    if (miles[key]) {
      await writeJson(relPath, miles[key]);
      continue;
    }
    changeLog.skipped.push(relPath);
    console.log(`skipped (crawl failed): ${relPath}`);
  }
}

const DEFAULT_FETCH_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
};
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, init = {}, options = {}) {
  const retries = options.retries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 30000;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      if (!resp.ok && RETRYABLE_HTTP_STATUSES.has(resp.status) && attempt < retries) {
        lastError = new Error(`fetch failed ${resp.status} ${url}`);
        console.warn(
          `[fetch retry ${attempt}/${retries}] ${url}: HTTP ${resp.status}`,
        );
        await sleep(retryDelayMs * attempt);
        continue;
      }
      return resp;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const reason =
          error?.name === 'AbortError'
            ? `timeout after ${timeoutMs}ms`
            : error?.message || error;
        console.warn(`[fetch retry ${attempt}/${retries}] ${url}: ${reason}`);
        await sleep(retryDelayMs * attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function getTextWithLenientHttps(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers: {
          ...headers,
          'Accept-Encoding': 'identity',
          Connection: 'close',
        },
        insecureHTTPParser: true,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const status = Number(res.statusCode || 0);
          if (status < 200 || status >= 300) {
            reject(new Error(`getTextWithLenientHttps failed ${status} ${url}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`getTextWithLenientHttps timeout ${url}`));
    });
    req.end();
  });
}

async function fetchText(url, options = {}) {
  const init = {
    headers: { ...DEFAULT_FETCH_HEADERS, ...(options.headers || {}) },
  };
  try {
    const resp = await fetchWithRetry(url, init, options);
    if (!resp.ok) throw new Error(`fetchText failed ${resp.status} ${url}`);
    return await resp.text();
  } catch (error) {
    if (options.fallbackHttps === false) throw error;
    console.warn(`[fetchText fallback https] ${url}: ${error?.message || error}`);
    return getTextWithLenientHttps(url, init.headers);
  }
}

async function fetchSheetHtml(url) {
  const variants = [url, url.replace('/pubhtml/sheet?', '/pubhtml?')];
  let lastError;
  for (const variant of variants) {
    try {
      return await fetchText(variant);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function fetchJson(url, init, options = {}) {
  const resp = await fetchWithRetry(url, init, options);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`fetchJson failed ${resp.status} ${url}\n${body.slice(0, 300)}`);
  }
  return await resp.json();
}

async function readJsonFile(relPath) {
  const candidates = [
    path.join(OUTPUT_ROOT, relPath),
    path.join(LEGACY_ROOT, relPath),
  ];
  if (ROOT !== OUTPUT_ROOT && ROOT !== LEGACY_ROOT) {
    candidates.push(path.join(ROOT, relPath));
  }
  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      /* try next */
    }
  }
  return null;
}

async function writeJson(relPath, data) {
  const filePath = path.join(OUTPUT_ROOT, relPath);
  const next = `${JSON.stringify(data, null, 2)}\n`;
  let prev = '';
  let prevData = null;
  try {
    prev = await fs.readFile(filePath, 'utf8');
    prevData = JSON.parse(prev);
  } catch {
    prev = '';
    prevData = null;
  }
  const contentSame = prev && stableJsonStringify(prevData) === stableJsonStringify(data);
  if (contentSame) {
    changeLog.unchanged.push(relPath);
    console.log(`unchanged: ${relPath}`);
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, next, 'utf8');
  changeLog.updated.push(relPath);
  console.log(`updated: ${relPath}`);
}

function getSummaryPath() {
  const custom = process.env.CRAWLER_SUMMARY_PATH;
  if (custom) return path.resolve(custom);
  return path.join(ROOT, '.last-run-summary.json');
}

async function publishChangeSummary() {
  const summary = {
    mode: PREVIEW_MODE ? 'preview' : 'production',
    outputRoot: OUTPUT_ROOT,
    updated: [...changeLog.updated],
    unchanged: [...changeLog.unchanged],
    skipped: [...changeLog.skipped],
    finishedAt: new Date().toISOString(),
  };

  console.log(`\n=== Card crawler change summary (${summary.mode}) ===`);
  console.log(`Updated (${summary.updated.length}):`);
  if (summary.updated.length) {
    for (const file of summary.updated) console.log(`  - ${file}`);
  } else {
    console.log('  (none)');
  }
  console.log(`Unchanged (${summary.unchanged.length}):`);
  if (summary.unchanged.length) {
    for (const file of summary.unchanged) console.log(`  - ${file}`);
  } else {
    console.log('  (none)');
  }
  if (summary.skipped.length) {
    console.log(`Skipped (${summary.skipped.length}):`);
    for (const file of summary.skipped) console.log(`  - ${file}`);
  }
  console.log(`Done. updated_files=${summary.updated.length}`);

  const summaryPath = getSummaryPath();
  await fs.mkdir(path.dirname(summaryPath), { recursive: true });
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`summary written: ${summaryPath}`);

  if (PREVIEW_MODE) {
    const previewSummary = path.join(OUTPUT_ROOT, 'crawler-summary.json');
    await fs.writeFile(previewSummary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## Card crawler files',
      '',
      `### Updated (${summary.updated.length})`,
      ...(summary.updated.length ? summary.updated.map((file) => `- \`${file}\``) : ['- (none)']),
      '',
      `### Unchanged (${summary.unchanged.length})`,
      ...(summary.unchanged.length
        ? summary.unchanged.map((file) => `- \`${file}\``)
        : ['- (none)']),
    ];
    if (summary.skipped.length) {
      lines.push(
        '',
        `### Skipped (${summary.skipped.length})`,
        ...summary.skipped.map((file) => `- \`${file}\``),
      );
    }
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
  }
}

async function crawlCube() {
  const model = await fetchJson(SOURCES.cubeModel, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' },
  });
  const parsed = parseCubeModel(model);
  const legacy = await readJsonFile('cards/builtin/cathay/data.json');
  const out = mergeCubeWithLegacy(parsed, legacy || {});
  const errors = validateParsedOutput('cube', out);
  if (errors.length) throw new Error(`cube validation failed: ${errors.join('; ')}`);
  return out;
}

async function crawlRichart() {
  const html = await fetchText(SOURCES.richart);
  const parsed = parseRichartHtml(html);
  const legacy = await readJsonFile('cards/builtin/taishin/data.json');
  return mergeRichartWithLegacy(parsed, legacy || {});
}

async function crawlUnicard() {
  const html = await fetchText(SOURCES.unicard);
  return parseUnicardHtml(html);
}

async function crawlCtbcLinepay() {
  const html = await fetchText(SOURCES.ctbcLinepay);
  const out = parseCtbcLinepayHtml(html, SOURCES.ctbcLinepay);
  const errors = validateParsedOutput('ctbcLinepay', out);
  if (errors.length) throw new Error(`ctbc validation failed: ${errors.join('; ')}`);
  return out;
}

async function crawlHsbc() {
  const html = await fetchText(SOURCES.hsbc);
  const out = parseHsbcHtml(html);
  const errors = validateParsedOutput('hsbc', out);
  if (errors.length) throw new Error(`hsbc validation failed: ${errors.join('; ')}`);
  return out;
}

async function crawlHsbcTravel() {
  const [infiniteHtml, signatureHtml, lightHtml, indexHtml] = await Promise.all([
    fetchText(HSBC_TRAVEL_TIER_URLS.infinite),
    fetchText(HSBC_TRAVEL_TIER_URLS.signature),
    fetchText(HSBC_TRAVEL_TIER_URLS.light),
    fetchText(HSBC_TRAVEL_INDEX_URL),
  ]);
  const out = parseHsbcTravelCardData({
    infiniteHtml,
    signatureHtml,
    lightHtml,
    indexHtml,
  });
  const errors = validateParsedOutput('hsbc-travel', out);
  if (errors.length) throw new Error(`hsbc travel validation failed: ${errors.join('; ')}`);
  if (out._crawlerWarnings?.length) {
    console.log(`hsbc travel warnings: ${out._crawlerWarnings.join('; ')}`);
  }
  return out;
}

async function crawlUbot() {
  const html = await fetchText(resolveUbotHtmlUrl(SOURCES.ubot));
  const out = parseUbotHtml(html);
  const errors = validateParsedOutput('ubot', out);
  if (errors.length) throw new Error(`ubot validation failed: ${errors.join('; ')}`);
  return out;
}

async function crawlCathayAsiaMiles() {
  const existing = await readJsonFile('cards/builtin/cathayAsiaMiles/data.json');
  const model = await fetchJson(SOURCES.cathayAsiaMilesModel);
  const parsed = parseCathayAsiaMilesModel(model, SOURCES.cathayAsiaMiles);
  const out = mergeCathayAsiaMilesWithLegacy(parsed, existing || {});
  const errors = validateParsedOutput('cathay-asia-miles', out);
  if (errors.length) throw new Error(`cathay asia miles validation failed: ${errors.join('; ')}`);
  return out;
}

async function crawlEsunStarlux() {
  const html = await fetchText(SOURCES.esunStarlux);
  const out = parseEsunStarluxHtml(html, SOURCES.esunStarlux);
  const errors = validateParsedOutput('esun-starlux', out);
  if (errors.length) throw new Error(`esun starlux validation failed: ${errors.join('; ')}`);
  return out;
}

async function crawlCtbcCal() {
  const existing = await readJsonFile('cards/builtin/ctbcCal/data.json');
  try {
    const html = await fetchText(SOURCES.ctbcCal);
    if (isCtbcBotChallengeHtml(html) || !looksLikeCtbcCalHtml(html)) {
      throw new Error('ctbc cal fetch blocked by bot challenge');
    }
    const out = parseCtbcCalHtml(html, SOURCES.ctbcCal);
    const errors = validateParsedOutput('ctbc-cal', out);
    if (errors.length) throw new Error(`ctbc cal validation failed: ${errors.join('; ')}`);
    return out;
  } catch (error) {
    if (existing) {
      console.log(`ctbc cal: kept existing data.json — ${error?.message || error}`);
      return existing;
    }
    throw error;
  }
}

async function crawlDbsAov() {
  const html = await fetchText(SOURCES.dbsAov);
  const merchants = parseDbsAovMerchants(html);
  if (!merchants.length) throw new Error('dbs aov: no lifestyle merchants parsed');
  const existing = await readJsonFile('cards/builtin/dbsAov/data.json');
  return mergeDbsAovCrawledData(existing, merchants, SOURCES.dbsAov);
}

async function crawlMiles() {
  const failures = [];
  const result = { taishin: null, cathay: null, openpoint: null, esun: null, dbs: null, hsbc: null };

  async function tryMilesSource(key, fn) {
    try {
      result[key] = await fn();
    } catch (error) {
      failures.push({ key, error });
      console.error(`[miles:${key}]`, error?.message || error);
    }
  }

  await Promise.all([
    tryMilesSource('taishin', async () => {
      const html = await fetchSheetHtml(SOURCES.taishinMiles);
      return parseTableMiles(html, 'taishin');
    }),
    tryMilesSource('cathay', async () => {
      const model = await fetchJson(SOURCES.cathayMiles, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' },
      });
      const rows = parseCathayAirmilesModel(model);
      const errors = validateParsedOutput('miles-row', rows);
      if (errors.length) throw new Error(`cathay miles validation failed: ${errors.join('; ')}`);
      return rows;
    }),
    tryMilesSource('openpoint', async () => {
      const html = await fetchText(SOURCES.openpointMiles);
      return parseOpenpointMiles(html);
    }),
    tryMilesSource('esun', async () => {
      const [esun22, esun23, esun24] = await Promise.all(
        [22, 23, 24].map((id) => fetchEsunMilesCategory(id)),
      );
      return [...esun22, ...esun23, ...esun24];
    }),
    tryMilesSource('dbs', async () => {
      const htmlById = Object.fromEntries(
        await Promise.all(
          DBS_MILES_PAGE_CONFIG.map(async (category) => {
            const sourceKey = `dbsMiles${category.id.charAt(0).toUpperCase()}${category.id.slice(1)}`;
            const url = SOURCES[sourceKey];
            const html = await fetchText(url);
            return [category.id, html];
          }),
        ),
      );
      const out = parseDbsMilesCategories(htmlById);
      const errors = validateParsedOutput('dbs-miles', out);
      if (errors.length) throw new Error(`dbs miles validation failed: ${errors.join('; ')}`);
      return out;
    }),
    tryMilesSource('hsbc', async () => {
      const html = await fetchText(SOURCES.hsbcFlyMiles, {
        retries: 5,
        retryDelayMs: 2000,
      });
      const out = parseHsbcFlyMiles(html);
      const errors = validateParsedOutput('hsbc-miles', out);
      if (errors.length) throw new Error(`hsbc miles validation failed: ${errors.join('; ')}`);
      return out;
    }),
  ]);

  if (failures.length) {
    const summary = failures
      .map(({ key, error }) => `${key}: ${error?.message || error}`)
      .join('\n');
    await sendTelegram(`Miles crawler partial failure (${failures.length}):\n${summary}`);
  }
  if (failures.length === 6) {
    throw new Error(
      `All miles sources failed:\n${failures.map(({ key, error }) => `${key}: ${error?.message || error}`).join('\n')}`,
    );
  }
  return result;
}

async function fetchEsunMilesCategory(categoryId) {
  const payload = {
    Type: 1,
    ProductCategoryID: categoryId,
    SortPoint: 0,
    SortStartDT: 0,
    FilterPointGradeStart: 0,
    FilterPointGradeEnd: 0,
    PageIndex: 1,
    PageSize: 20,
    ProductType: 3,
    Fillter: {},
  };
  const requestHeaders = {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://rewards.esunbank.com.tw',
    Referer: 'https://rewards.esunbank.com.tw/',
    'Content-Type': 'application/json',
    src: 'null',
  };
  const body = JSON.stringify(payload);

  let status = 0;
  let text = '';
  try {
    const resp = await fetch(SOURCES.esunMilesApi, {
      method: 'POST',
      headers: requestHeaders,
      body,
    });
    status = resp.status;
    text = await resp.text();
  } catch (error) {
    // Some responses from this endpoint intermittently violate strict HTTP parsing
    // (e.g. malformed header folding). Retry with a lenient HTTP parser.
    const fallback = await postJsonWithLenientParser(SOURCES.esunMilesApi, body, requestHeaders);
    status = fallback.status;
    text = fallback.text;
  }

  if (status < 200 || status >= 300) throw new Error(`esun api ${categoryId} failed: ${status}`);
  if (text.trim().startsWith('<!DOCTYPE')) throw new Error(`esun api ${categoryId} blocked by html`);
  const data = JSON.parse(text);
  if (String(data?.StatusCode || '') !== '0000') {
    throw new Error(`esun api ${categoryId} status=${data?.StatusCode}`);
  }
  const entries = Array.isArray(data?.Entries) ? data.Entries : [];
  return parseEsunMilesEntries(entries);
}

function postJsonWithLenientParser(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
        'Accept-Encoding': 'identity',
        Connection: 'close',
      },
      insecureHTTPParser: true,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: Number(res.statusCode || 0),
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message.slice(0, 3900),
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error('Telegram notify failed:', err);
  }
}

await main();
