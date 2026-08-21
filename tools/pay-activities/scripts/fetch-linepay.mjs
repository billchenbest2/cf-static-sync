/**
 * Fetch LINE Pay marketing activities into data/linepay-activities.json
 * Usage: node scripts/fetch-linepay.mjs
 *
 * Public CMS API (no LINE login required):
 *   GET https://web-tw-pay.line.me/cms-api/v1/events?offset=&limit=
 *   GET https://web-tw-pay.line.me/cms-api/v1/events?tagIds=
 *   GET https://web-tw-pay.line.me/cms-api/v1/tags
 *   GET https://web-tw-pay.line.me/cms-api/v1/events/{key}
 *
 * Also follows landpress externalUrl hubs to discover PROTECTED nested events.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseQuotaFull } from '../viewer/quota-full.js';
import { normalizeBankName } from '../viewer/banks.js';
import { upsertPlatform } from './platform-catalog.mjs';
import {
  loadEndedCache,
  useCachedIfEnded,
  finalizeAndSave,
  logCacheSummary,
} from './activity-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.PAY_DATA_DIR || path.join(ROOT, 'data');
const OUT_PATH = path.join(DATA_DIR, 'linepay-activities.json');

const ORIGIN = 'https://web-tw-pay.line.me';
const LIST_URL = `${ORIGIN}/cms-api/v1/events`;
const EVENT_PAGE = `${ORIGIN}/cms/event`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FETCH_OPTS = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json,text/plain,*/*',
    'Accept-Language': 'zh-TW,zh;q=0.9',
    Referer: EVENT_PAGE,
  },
};

const KNOWN_MERCHANTS = [
  '7-ELEVEN',
  '7-11',
  '全家便利商店',
  '全家',
  '美廉社',
  '寶雅',
  '康是美',
  '屈臣氏',
  '家樂福',
  '大潤發',
  '全聯',
  'momo',
  'PChome',
  '博客來',
  'Klook',
  'Hahow',
  '永豐',
  '樂天百貨',
  'LOTTE MART',
  '星巴克',
  '麥當勞',
  '必勝客',
  '肯德基',
  '夜市',
];

function bankNameOf(text) {
  return normalizeBankName(text);
}

async function fetchJson(url, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, FETCH_OPTS);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const data = await res.json();
      if (data.returnCode && data.returnCode !== '0000') {
        throw new Error(`${data.returnCode}: ${data.returnMessage || 'API error'} (${url})`);
      }
      return data;
    } catch (e) {
      lastErr = e;
      const retryable =
        /terminated|UND_ERR|ECONNRESET|ETIMEDOUT|socket|fetch failed|HTTP 5\d\d/i.test(
          String(e?.message || e?.cause?.message || e)
        );
      if (!retryable || attempt === retries) break;
      const wait = 500 * attempt * attempt;
      console.warn(`\n  retry ${attempt}/${retries} after ${wait}ms: ${e.message}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function isoToYmd(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function buildPeriodFromIso(startIso, endIso) {
  const start = isoToYmd(startIso);
  const end = isoToYmd(endIso);
  const now = new Date();
  let status = 'unknown';
  if (startIso && endIso) {
    const s = new Date(startIso);
    const e = new Date(endIso);
    if (now < s) status = 'upcoming';
    else if (now > e) status = 'ended';
    else status = 'active';
  }
  return { start, end, status, periodSource: 'api' };
}

function isJunkMerchant(name) {
  const n = String(name || '').trim();
  if (!n || n.length < 2) return true;
  if (/^(LINE Pay|LINE POINTS|LINE|指定店家|TWQR|任一付款方法|點數回饋)$/i.test(n)) return true;
  if (/活動期間|每LINE Pay|回饋點數|最高限得|不計入/.test(n)) return true;
  if (n.length > 24) return true;
  return false;
}

function walkMetaText(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const x of node) walkMetaText(x, out);
    return out;
  }
  for (const key of ['data', 'title', 'text', 'name']) {
    if (typeof node[key] === 'string' && node[key].trim()) out.push(node[key].trim());
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') walkMetaText(v, out);
  }
  return out;
}

function flattenDetailText(detailInfo) {
  const parts = [];
  if (detailInfo?.title) parts.push(detailInfo.title);
  if (detailInfo?.ogDesc) parts.push(detailInfo.ogDesc);
  if (detailInfo?.target) parts.push(detailInfo.target);
  if (detailInfo?.targetDescription) parts.push(detailInfo.targetDescription);
  if (detailInfo?.periodNotice) parts.push(detailInfo.periodNotice);
  parts.push(...walkMetaText(detailInfo?.meta));
  for (const a of detailInfo?.announcements || []) {
    if (a?.title) parts.push(a.title);
    if (a?.content) parts.push(a.content);
  }
  return parts.join('\n').replace(/\s+/g, ' ').trim();
}

function pctFromText(text) {
  const s = String(text || '');
  if (/貸款|手續費|利率|利息|年費|服務費/.test(s)) return null;
  const patterns = [
    /最高(?:享)?\s*(\d+(?:\.\d+)?)\s*%/,
    /享\s*(\d+(?:\.\d+)?)\s*%\s*(?:回饋|街口幣|折抵|全盈儲值金|悠遊幣|Fa點|icash點|OPENPOINT|LINE\s*POINTS)/i,
    /(\d+(?:\.\d+)?)\s*%\s*(?:回饋|街口幣|全盈儲值金|悠遊幣|Fa點|OPENPOINT|LINE\s*POINTS)/i,
    /(?:回饋|加碼)\s*(\d+(?:\.\d+)?)\s*%/,
    /(?:筆筆|每筆)\s*(\d+(?:\.\d+)?)\s*%/,
    /贈\s*(\d+(?:\.\d+)?)\s*%/,
    /(\d+(?:\.\d+)?)\s*%\s*(?:現金回饋|點數回饋|限量回饋|起(?!\d))/,
    /享\s*(\d+(?:\.\d+)?)\s*%/,
    /(\d+(?:\.\d+)?)\s*%(?!\d)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) { const v = Number(m[1]); if (v > 0 && v <= 100) return v; }
  }
  return null;
}

function extractRewards(title, fullText) {
  const rewards = [];
  const seen = new Set();
  const body = String(fullText || '');
  const skipLine = /綜合計算|實際回饋以|注意事項/;

  const push = (label, detail, pct, role) => {
    if (pct != null && (!(pct > 0) || pct > 100)) return;
    const key = `${role}:${label}:${pct ?? 'x'}:${String(detail).slice(0, 40)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rewards.push({ label, detail, ...(pct != null ? { pct } : {}), role });
  };

  const lines = body
    .split(/\n|。|；/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 6 && l.length <= 280 && !skipLine.test(l));

  for (const line of lines) {
    const cardM = line.match(
      /(?:綁定|使用)?(.{0,24}?)(信用卡|簽帳卡|簽帳金融卡|金融卡|聯名卡).{0,80}?(\d+(?:\.\d+)?)\s*%/
    );
    if (cardM) {
      const bank = bankNameOf(cardM[1] + line) || bankNameOf(line);
      if (bank) {
        push(bank, line, Number(cardM[3]), 'card');
        continue;
      }
    }
    const accM = line.match(/(?:連結|綁定)(.{0,20}?)(?:銀行)?(?:帳戶|活期).{0,80}?(\d+(?:\.\d+)?)\s*%/);
    if (accM) {
      const bank = bankNameOf(accM[1] + line) || bankNameOf(line);
      if (bank) push(bank, line, Number(accM[2]), 'account');
    }
  }

  const BASE_PATTERNS_LINE = [
    /(?:筆筆|每筆交易|每筆消費|每筆)\s*享\s*(\d+(?:\.\d+)?)\s*%\s*LINE\s*POINTS/i,
    /享\s*(\d+(?:\.\d+)?)\s*%\s*LINE\s*POINTS/i,
    /LINE\s*POINTS\s*(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*%\s*LINE\s*POINTS/i,
    /(\d+(?:\.\d+)?)\s*%\s*回饋/,
    /回饋\s*(\d+(?:\.\d+)?)\s*%/,
    /消費享\s*(\d+(?:\.\d+)?)\s*%/,
    /每筆消費回饋\s*(\d+(?:\.\d+)?)\s*%/,
  ];
  let bodyBaseMatch = null;
  for (const pat of BASE_PATTERNS_LINE) {
    bodyBaseMatch = body.match(pat);
    if (bodyBaseMatch) break;
  }
  if (!bodyBaseMatch) {
    bodyBaseMatch =
      title.match(/最高(?:LINE POINTS\s*)?(\d+(?:\.\d+)?)%/) ||
      title.match(/LINE POINTS\s*(\d+(?:\.\d+)?)%/i) ||
      title.match(/(\d+(?:\.\d+)?)%\s*回饋/);
  }

  const basePct = bodyBaseMatch ? Number(bodyBaseMatch[1]) : null;
  if (basePct != null && basePct <= 50) {
    const already = rewards.some((r) => r.pct === basePct);
    if (!already) push('LINE Pay 基本回饋', title, basePct, 'base');
  }

  const pointsM =
    body.match(/LINE POINTS\s*(\d+)\s*點/) ||
    title.match(/LINE POINTS\s*(\d+)\s*點/) ||
    title.match(/現折\s*(\d+)\s*元/);
  if (!rewards.length && pointsM) {
    push('主活動', title, null, 'base');
  }

  if (!rewards.length) {
    const pct = pctFromText(title);
    rewards.push({ label: '優惠', detail: title, ...(pct != null ? { pct } : {}), role: 'base' });
  }
  return rewards.slice(0, 10);
}

function extractMerchants(title, target, fullText) {
  const found = [];
  const push = (name) => {
    const n = String(name || '').trim().replace(/\s+/g, ' ');
    if (isJunkMerchant(n)) return;
    if (n === '7-11') {
      if (!found.includes('7-ELEVEN')) found.push('7-ELEVEN');
      return;
    }
    if (!found.includes(n)) found.push(n);
  };

  if (target) push(target);

  const bracket = String(title || '').match(/【([^】]{2,40})】/);
  if (bracket) {
    const name = bracket[1].replace(/\s*x\s*.*$/i, '').replace(/官網|官方線上商城|台灣官網/g, '').trim();
    push(name || bracket[1]);
  }

  const blob = `${title}\n${target || ''}\n${String(fullText || '').slice(0, 2000)}`;
  for (const brand of KNOWN_MERCHANTS) {
    if (blob.includes(brand)) push(brand);
  }
  return found;
}

function extractScopeHints(fullText, tags) {
  const hints = [];
  const blob = String(fullText || '');
  if (/TWQR|掃碼/.test(blob)) hints.push('TWQR掃碼');
  if (/信用卡|簽帳金融卡|金融卡/.test(blob)) hints.push('信用卡／金融卡');
  if (/LINE POINTS/.test(blob)) hints.push('LINE POINTS');
  if (/購好券/.test(blob)) hints.push('購好券');
  for (const t of tags || []) {
    const text = t.text || t.key;
    if (text && !hints.includes(text)) hints.push(text);
  }
  return hints.slice(0, 8);
}

const CMS_EVENT_KEY_RE =
  /(?:web-tw-pay\.line\.me\/cms\/event\/(?:template[\d.]+|display)\/|linepay-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const LANDPRESS_HOST_RE = /landpress\.line\.me/i;

function isLandpressUrl(url) {
  return typeof url === 'string' && LANDPRESS_HOST_RE.test(url);
}

function mergeListItem(map, item, source) {
  if (!item?.key) return false;
  const prev = map.get(item.key);
  if (!prev) {
    map.set(item.key, { ...item, _discoverSources: [source] });
    return true;
  }
  const sources = new Set(prev._discoverSources || []);
  sources.add(source);
  map.set(item.key, {
    ...prev,
    ...item,
    externalUrl: item.externalUrl || prev.externalUrl,
    tags: item.tags?.length ? item.tags : prev.tags,
    _discoverSources: [...sources],
  });
  return false;
}

async function fetchListPage(query) {
  const qs = new URLSearchParams(query).toString();
  return fetchJson(`${LIST_URL}?${qs}`);
}

async function fetchPagedList(label, baseQuery = {}) {
  const map = new Map();
  const limit = 100;
  let total = null;
  for (let offset = 0; ; offset += limit) {
    process.stdout.write(`  ${label} offset ${offset}...`);
    const data = await fetchListPage({ ...baseQuery, offset: String(offset), limit: String(limit) });
    const batch = data.info?.data || [];
    const pag = data.info?.pagination;
    if (total == null && pag?.total != null) total = Number(pag.total);
    let added = 0;
    for (const item of batch) {
      if (mergeListItem(map, item, label)) added++;
    }
    console.log(
      ` ${batch.length} rows, +${added} (unique ${map.size}${total != null ? ` / ${total}` : ''})`
    );
    if (batch.length < limit) break;
    if (total != null && offset + limit >= total) break;
    await sleep(280);
  }
  return map;
}

async function fetchAllTags() {
  try {
    const data = await fetchJson(`${ORIGIN}/cms-api/v1/tags`);
    return Array.isArray(data.info) ? data.info : [];
  } catch (e) {
    console.warn(`  tags fetch failed: ${e.message}`);
    return [];
  }
}

async function fetchAllListItems() {
  const byKey = await fetchPagedList('list');

  const tags = await fetchAllTags();
  console.log(`  tags: ${tags.length}`);
  for (const tag of tags) {
    if (tag?.id == null) continue;
    const label = `tag:${tag.id}`;
    const tagged = await fetchPagedList(label, { tagIds: String(tag.id) });
    let added = 0;
    for (const item of tagged.values()) {
      if (mergeListItem(byKey, item, label)) added++;
    }
    if (added) console.log(`  ${label} merged +${added} new (unique ${byKey.size})`);
    await sleep(150);
  }

  return [...byKey.values()];
}

async function fetchDetail(key) {
  const data = await fetchJson(`${LIST_URL}/${encodeURIComponent(key)}`);
  return data.info || null;
}

function extractCmsKeysFromHtml(html) {
  const keys = new Set();
  if (!html) return keys;
  for (const m of html.matchAll(CMS_EVENT_KEY_RE)) {
    if (m[1]) keys.add(m[1].toLowerCase());
  }
  // Fallback: only keep UUIDs that appear near cms/event paths
  for (const m of html.matchAll(/cms\/event\/(?:template[\d.]+|display)\/([0-9a-f-]{36})/gi)) {
    keys.add(m[1].toLowerCase());
  }
  return keys;
}

async function fetchLandpressCmsKeys(url) {
  const keys = new Set();
  if (!isLandpressUrl(url)) return keys;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': FETCH_OPTS.headers['User-Agent'],
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9',
        },
      });
      if (!res.ok) {
        console.warn(`  landpress HTTP ${res.status}: ${url}`);
        return keys;
      }
      const html = await res.text();
      for (const k of extractCmsKeysFromHtml(html)) keys.add(k);
      return keys;
    } catch (e) {
      lastErr = e;
      await sleep(400 * attempt);
    }
  }
  console.warn(`  landpress err ${url}: ${lastErr?.message || lastErr}`);
  return keys;
}

async function discoverLandpressNested(listItems, scrapedUrls = new Set()) {
  const known = new Set(listItems.map((i) => i.key));
  const nestedKeys = new Set();
  const landpressUrls = new Set();

  for (const item of listItems) {
    const ext = item.externalUrl;
    if (isLandpressUrl(ext)) landpressUrls.add(ext);
  }

  console.log(`  landpress hubs: ${landpressUrls.size}`);
  let i = 0;
  for (const url of landpressUrls) {
    i++;
    if (scrapedUrls.has(url)) continue;
    scrapedUrls.add(url);
    process.stdout.write(`\r  landpress ${i}/${landpressUrls.size}: ${url.slice(0, 64)}   `);
    const keys = await fetchLandpressCmsKeys(url);
    for (const k of keys) {
      if (!known.has(k)) nestedKeys.add(k);
    }
    await sleep(200);
  }
  console.log('');

  const added = [];
  for (const key of nestedKeys) {
    try {
      const detail = await fetchDetail(key);
      await sleep(120);
      if (!detail?.key) continue;
      const stub = {
        key: detail.key,
        name: detail.name,
        title: detail.title,
        type: detail.type,
        target: detail.target,
        ogDesc: detail.ogDesc,
        startDate: detail.startDate,
        endDate: detail.endDate,
        tags: detail.tags,
        externalUrl: detail.externalUrl,
        visibility: detail.visibility,
        activated: detail.activated,
        _discoverSources: ['landpress'],
        _prefetchedDetail: detail,
      };
      listItems.push(stub);
      known.add(key);
      added.push(key);
      console.log(
        `  + nested ${key.slice(0, 8)} [${detail.visibility || '?'}] ${(detail.title || '').slice(0, 40)}`
      );
    } catch (e) {
      console.warn(`  nested detail fail ${key}: ${e.message}`);
    }
  }
  return added;
}

function buildActivityRecord(item, detail) {
  const title = detail?.title || item.title || item.name || item.key;
  const url =
    item.externalUrl ||
    detail?.externalUrl ||
    `${ORIGIN}/cms/event/template1.3/${item.key}`;
  const fullText = detail
    ? flattenDetailText(detail)
    : [item.title, item.ogDesc, item.target, item.targetDescription].filter(Boolean).join('\n');
  const merchants = extractMerchants(title, detail?.target || item.target, fullText);
  const rewards = extractRewards(title, fullText);
  const scopeHints = extractScopeHints(fullText, detail?.tags || item.tags);
  const searchText = [title, item.ogDesc, ...merchants, ...rewards.map((r) => `${r.label} ${r.detail}`), ...scopeHints]
    .join(' ')
    .toLowerCase();
  const quotaFull = parseQuotaFull(title, item.title, searchText, fullText);

  return {
    id: `linepay-${item.key}`,
    platform: 'linepay',
    source: 'linepay',
    slug: item.key,
    url,
    title,
    period: buildPeriodFromIso(detail?.startDate || item.startDate, detail?.endDate || item.endDate),
    merchants,
    rewards,
    scopeHints,
    searchText,
    quotaFull,
    official: true,
    fetchedAt: new Date().toISOString(),
    raw: {
      text: fullText.slice(0, 12000),
      list: {
        name: item.name,
        target: item.target,
        ogDesc: item.ogDesc,
        startDate: item.startDate,
        endDate: item.endDate,
        tags: item.tags,
        externalUrl: item.externalUrl || null,
        visibility: item.visibility || detail?.visibility || null,
        discoverSources: item._discoverSources || [],
      },
    },
  };
}

async function main() {
  console.log('LINE Pay activity fetch\n');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('[1/4] Fetching event list (all pages + tags)...');
  const listItems = await fetchAllListItems();
  console.log(`  Total list: ${listItems.length}\n`);
  if (!listItems.length) {
    console.error('No activities found.');
    process.exit(1);
  }

  console.log('[2/4] Discovering nested CMS events from landpress hubs...');
  const scrapedLandpress = new Set();
  const nestedAdded = await discoverLandpressNested(listItems, scrapedLandpress);
  console.log(`  nested added: ${nestedAdded.length} (list now ${listItems.length})\n`);

  console.log('[3/4] Fetching details for active / upcoming...');
  const endedCache = loadEndedCache(OUT_PATH);
  console.log(`  ended cache: ${endedCache.size} (will skip re-fetch)\n`);

  const activities = [];
  let skippedFetch = 0;
  for (let i = 0; i < listItems.length; i++) {
    const item = listItems[i];
    const id = `linepay-${item.key}`;
    const period = buildPeriodFromIso(item.startDate, item.endDate);
    const cachedHit = useCachedIfEnded(endedCache, id, period);
    if (cachedHit.skip) {
      activities.push({ ...cachedHit.cached, _fromCache: true });
      skippedFetch++;
      continue;
    }

    const needDetail = period.status === 'active' || period.status === 'upcoming';

    let detail = item._prefetchedDetail || null;
    if (needDetail && !detail) {
      process.stdout.write(`\r  detail ${i + 1}/${listItems.length}: ${(item.title || '').slice(0, 36)}   `);
      try {
        detail = await fetchDetail(item.key);
        await sleep(120);
      } catch (e) {
        process.stdout.write(` [err: ${e.message}]`);
      }
    }

    // Hub pages may only expose landpress URL after detail fetch
    if (needDetail) {
      const ext = item.externalUrl || detail?.externalUrl;
      if (isLandpressUrl(ext) && !scrapedLandpress.has(ext)) {
        scrapedLandpress.add(ext);
        const keys = await fetchLandpressCmsKeys(ext);
        for (const key of keys) {
          if (listItems.some((x) => x.key === key)) continue;
          try {
            const nestedDetail = await fetchDetail(key);
            await sleep(120);
            if (!nestedDetail?.key) continue;
            listItems.push({
              key: nestedDetail.key,
              name: nestedDetail.name,
              title: nestedDetail.title,
              type: nestedDetail.type,
              target: nestedDetail.target,
              ogDesc: nestedDetail.ogDesc,
              startDate: nestedDetail.startDate,
              endDate: nestedDetail.endDate,
              tags: nestedDetail.tags,
              externalUrl: nestedDetail.externalUrl,
              visibility: nestedDetail.visibility,
              activated: nestedDetail.activated,
              _discoverSources: ['landpress-followed'],
              _prefetchedDetail: nestedDetail,
            });
            console.log(
              `\n  + late nested ${key.slice(0, 8)} [${nestedDetail.visibility || '?'}] ${(nestedDetail.title || '').slice(0, 40)}`
            );
          } catch (e) {
            console.warn(`\n  late nested fail ${key}: ${e.message}`);
          }
        }
      }
    }

    activities.push(buildActivityRecord(item, detail));
  }
  console.log('');

  console.log('[4/4] Saving...');
  const { payload, stats } = finalizeAndSave(OUT_PATH, {
    meta: {
      source: EVENT_PAGE,
    },
    activities,
    endedCache,
    skippedFetch,
  });
  upsertPlatform('linepay');

  const ongoing = payload.activities.filter((a) => a.period.status === 'active');
  const upcoming = payload.activities.filter((a) => a.period.status === 'upcoming');
  const ended = payload.activities.filter((a) => a.period.status === 'ended');
  console.log(`\nSaved ${payload.activities.length} activities -> ${OUT_PATH}`);
  logCacheSummary(stats);
  console.log(`  active: ${ongoing.length}, upcoming: ${upcoming.length}, ended: ${ended.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
