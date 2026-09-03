/**
 * Fetch iPASS MONEY marketing activities into data/ipass-activities.json
 * Usage:
 *   node scripts/fetch-ipass.mjs
 *   node scripts/fetch-ipass.mjs --refresh
 *
 * Scrapes https://www.i-pass.com.tw/Preferential?type=0&page=N
 * then each detail page, using cheerio for HTML parsing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseQuotaFull } from '../viewer/quota-full.js';
import { enrichIpassActivity, ipassTwqrMerchants } from '../viewer/ipass-addons.js';
import { normalizeBankName } from '../viewer/banks.js';
import { load as cheerioLoad } from 'cheerio';
import { upsertPlatform } from './platform-catalog.mjs';
import {
  loadEndedCache,
  loadActivityIndex,
  useCachedIfEnded,
  finalizeAndSave,
  logCacheSummary,
} from './activity-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.PAY_DATA_DIR || path.join(ROOT, 'data');
const OUT_PATH = path.join(DATA_DIR, 'ipass-activities.json');

const LIST_BASE = 'https://www.i-pass.com.tw/Preferential?type=0';
const DETAIL_BASE = 'https://www.i-pass.com.tw';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FETCH_OPTS = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9',
  },
};

async function fetchHtml(url) {
  const res = await fetch(url, FETCH_OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractJsRedirect(html) {
  const m = String(html || '').match(/var\s+redirectUrl\s*=\s*'([^']+)'/);
  if (!m) return null;
  try {
    const decoded = decodeURIComponent(m[1]);
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    return null;
  }
  return null;
}

async function fetchHtmlFollow(url) {
  const html = await fetchHtml(url);
  const next = extractJsRedirect(html);
  if (!next || next === url) return html;
  return fetchHtml(next);
}

function isJunkMerchant(name) {
  const n = String(name || '').trim();
  if (!n || n.length < 2) return true;
  if (/^(repost[-_].*|logo\d*|pic|icon|share|facebook|twitter|instagram|youtube|line)$/i.test(n)) return true;
  if (/圖示|社群|分享/.test(n)) return true;
  if (n.length > 16) return true;
  if (/綁定|開立|完成任務|最高享/.test(n) && !/^TWQR/.test(n)) return true;
  return false;
}

// Parse date string like "2026/7/1 (三)" or "2026.8.14" -> "YYYY/MM/DD"
function normalizeDate(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/\./g, '/');
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}/${String(m[2]).padStart(2, '0')}/${String(m[3]).padStart(2, '0')}`;
}

function buildPeriod(startRaw, endRaw) {
  const start = normalizeDate(startRaw);
  const end = normalizeDate(endRaw);
  const now = new Date();
  let status = 'unknown';
  if (start && end) {
    const s = new Date(start.replace(/\//g, '-'));
    const e = new Date(end.replace(/\//g, '-') + 'T23:59:59');
    if (now < s) status = 'upcoming';
    else if (now > e) status = 'ended';
    else status = 'active';
  }
  return { start, end, status };
}

// Extract percentage rewards from activity text
const IPASS_BANK_KW = ['銀行', '富邦', '國泰', '玉山', '台新', '聯邦', '兆豐', '星展',
  '新光', '遠東', '樂天', '永豐', '元大', 'LINE Bank'];
function bankNameOfIpass(text) {
  for (const kw of IPASS_BANK_KW) {
    const m = String(text || '').match(new RegExp(`([\\u4e00-\\u9fff]{0,6}${kw}[\\u4e00-\\u9fff]{0,4})`));
    if (m) return m[1];
  }
  return null;
}

const PCT_PATTERNS_IPASS = [
  /(?:筆筆|每筆交易|每筆消費|每筆)\s*享\s*(\d+(?:\.\d+)?)\s*%/,
  /享\s*(\d+(?:\.\d+)?)\s*%\s*(?:iPASS|回饋|點數)/i,
  /(\d+(?:\.\d+)?)\s*%\s*iPASS\s*MONEY/i,
  /最高?享?\s*(\d+(?:\.\d+)?)\s*%/,
  /回饋\s*(\d+(?:\.\d+)?)\s*%/,
  /(\d+(?:\.\d+)?)\s*%\s*回饋/,
];

function extractRewardsFromText(text) {
  const rewards = [];
  if (!text) return rewards;

  const lines = text
    .split(/\n|。|；|！(?=\s|$)/)
    .map((l) => l.trim())
    .filter(l => l.length >= 6);

  const seen = new Set();
  for (const line of lines) {
    let pct = null;
    for (const pat of PCT_PATTERNS_IPASS) {
      const m = line.match(pat);
      if (m) { pct = Number(m[1]); break; }
    }
    if (!pct || pct <= 0 || pct > 100) continue;

    // 判斷 role
    const isCard = /信用卡|簽帳卡/.test(line) && !/帳戶/.test(line);
    const isAcc = /帳戶|銀行/.test(line) && !/信用卡/.test(line);
    const role = isCard ? 'card' : isAcc ? 'account' : 'base';
    const bank = bankNameOfIpass(line);

    // label 優先用【】括號，其次銀行名，最後平台名
    const bracketM = line.match(/【([^】]{2,20})】/);
    const label = bracketM ? bracketM[1]
      : (role !== 'base' && bank) ? bank
      : 'iPASS MONEY 基本回饋';

    const key = `${role}:${label}:${pct}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rewards.push({ label, detail: line, pct, role });
  }
  return rewards;
}

// Parse list page, return array of { title, url, dateRange, tags }
function parseListPage(html) {
  const $ = cheerioLoad(html);
  const items = [];

  // Each activity card
  $('article, .activity-item, .card').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('a[href*="/Preferential/Detail/"]').first();
    if (!$a.length) return;
    const href = $a.attr('href') || '';
    const url = href.startsWith('http') ? href : `${DETAIL_BASE}${href}`;
    const title = ($el.find('h3, h2, h4').first().text() || $a.text()).trim();
    if (!title) return;

    const dateText = $el.text();
    const dateMatch = dateText.match(
      /(\d{4}\/\d{1,2}\/\d{1,2})(?:\s*\([^)]+\))?\s*[~～]\s*(\d{4}\/\d{1,2}\/\d{1,2})/
    );

    items.push({
      title: title.replace(/\s+/g, ' '),
      url,
      startRaw: dateMatch?.[1] || null,
      endRaw: dateMatch?.[2] || null,
    });
  });

  // Fallback: scan all links to /Preferential/Detail/
  if (items.length === 0) {
    $('a[href*="/Preferential/Detail/"]').each((_, a) => {
      const $a = $(a);
      const href = $a.attr('href') || '';
      const url = href.startsWith('http') ? href : `${DETAIL_BASE}${href}`;
      const title = $a.closest('div, section, li').find('h3, h2').first().text().trim()
        || $a.text().trim();
      if (!title || items.find((i) => i.url === url)) return;

      const containerText = $a.closest('div, section, li').text();
      const dateMatch = containerText.match(
        /(\d{4}\/\d{1,2}\/\d{1,2})(?:\s*\([^)]+\))?\s*[~～]\s*(\d{4}\/\d{1,2}\/\d{1,2})/
      );
      items.push({
        title: title.replace(/\s+/g, ' '),
        url,
        startRaw: dateMatch?.[1] || null,
        endRaw: dateMatch?.[2] || null,
      });
    });
  }

  return items;
}

// Parse a detail page, return enriched activity data
function parseDetailPage(html, listItem) {
  const $ = cheerioLoad(html);

  // Remove nav/footer noise
  $('nav, footer, header, .menu, .footer, .header, script, style').remove();

  // Get main content area
  const $main = $('main, .content, article, #content, .activity-content').first();
  const contentEl = $main.length ? $main : $('body');

  const fullText = contentEl.text().replace(/\s+/g, ' ').trim();

  // Extract date from detail page (may override list page dates)
  const dateMatch = fullText.match(
    /(\d{4}[\/\.]\d{1,2}[\/\.]\d{1,2})(?:\s*[\-~～]\s*)(\d{4}[\/\.]\d{1,2}[\/\.]\d{1,2})/
  );
  const startRaw = dateMatch?.[1] || listItem.startRaw;
  const endRaw = dateMatch?.[2] || listItem.endRaw;

  // Extract activity name from h1/h2
  const pageTitle = $('h1, h2').first().text().trim() || listItem.title;

  // Build rewards array from structured content
  const rewards = [];
  const seen = new Set();

  // Only consider 【BankName】 sections that explicitly mention payment methods
  // (bank account, credit card) — avoids treating activity titles/section headers as bank names
  const PAYMENT_KEYWORDS = /銀行|信用卡|簽帳卡|帳戶|存款|聯邦|王道|玉山|台新|國泰|樂天|樂天銀行|新光|富邦|兆豐|中信|星展|永豐|遠東|渣打|unicard|CUBE|聯邦信用卡/;
  const bankMatches = [...fullText.matchAll(/【([^】]{2,20})】([^【]{0,300})/g)];
  for (const bm of bankMatches) {
    const bank = normalizeBankName(bm[1]) || bm[1].trim();
    const detail = bm[0].replace(/\s+/g, ' ').trim();
    // Must contain payment-related keywords in the surrounding text
    if (!PAYMENT_KEYWORDS.test(detail)) continue;
    if (!/銀行|信用卡|帳戶|Unicard|CUBE|Richart|LINE/i.test(bank)) continue;
    // Must have a valid percentage
    const pctM = detail.match(/(\d+(?:\.\d+)?)\s*%\s*回饋/);
    const pct = pctM ? Number(pctM[1]) : null;
    if (!pct || pct <= 0 || pct > 40) continue;
    if (seen.has(bank)) continue;
    seen.add(bank);
    const isCard = /信用卡|簽帳卡|unicard|CUBE/.test(detail);
    const isAccount = /帳戶|存款|銀行帳/.test(detail) && !isCard;
    if (!isCard && !isAccount) continue; // skip ambiguous entries
    const role = isCard ? 'card' : 'account';
    rewards.push({ label: bank, detail, pct, role });
  }

  // Extract main activity reward from title percentage (most reliable)
  const titlePctM = listItem.title.match(/最高享?\s*(\d+(?:\.\d+)?)\s*%/);
  if (titlePctM) {
    const pct = Number(titlePctM[1]);
    if (pct > 0 && pct <= 100) {
      if (!rewards.some(r => r.role === 'base'))
        rewards.unshift({ label: 'iPASS MONEY 基本回饋', detail: listItem.title, pct, role: 'base' });
    }
  } else {
    // fallback: first % mentioned in the content with 回饋 keyword
    const mainPctM = fullText.match(/享(?:一卡通綠點)?\s*(\d+(?:\.\d+)?)\s*%\s*回饋/);
    if (mainPctM) {
      const pct = Number(mainPctM[1]);
      if (pct > 0 && pct <= 100) {
        if (!rewards.some(r => r.role === 'base'))
          rewards.unshift({ label: 'iPASS MONEY 基本回饋', detail: listItem.title, pct, role: 'base' });
      }
    }
  }

  // Extract merchants from text (logo alt text + listed merchants)
  const merchants = [];
  $('img[alt]').each((_, img) => {
    const alt = $(img).attr('alt') || '';
    if (alt.length >= 2 && alt.length <= 20 && !isJunkMerchant(alt) && !/logo|Logo|icon|圖示/.test(alt)) {
      merchants.push(alt.trim());
    }
  });

  // Extract from "指定店家" or "適用通路" sections
  const storeMatch = fullText.match(/(?:指定店家|精選通路|適用通路)[：:]\s*([^。\n]{2,100})/);
  if (storeMatch) {
    storeMatch[1].split(/[、,，]/).forEach((s) => {
      const name = s.trim().replace(/[（(].*$/, '').trim();
      if (name.length >= 2 && name.length <= 20 && !isJunkMerchant(name)) merchants.push(name);
    });
  }

  const uniqueMerchants = [...new Set([
    ...merchants,
    ...ipassTwqrMerchants(fullText),
  ])].filter((m) => m.length >= 2 && !isJunkMerchant(m));

  // Scope hints
  const scopeHints = [];
  if (/TWQR/.test(fullText)) scopeHints.push('TWQR掃碼');
  if (/付款碼/.test(fullText)) scopeHints.push('付款碼');
  if (/指定店家/.test(fullText)) scopeHints.push('指定店家');

  const searchText = [
    pageTitle,
    listItem.title,
    ...uniqueMerchants,
    ...rewards.map((r) => `${r.label} ${r.detail}`),
    ...scopeHints,
  ]
    .join(' ')
    .toLowerCase();

  return {
    pageTitle,
    period: buildPeriod(startRaw, endRaw),
    merchants: uniqueMerchants,
    rewards,
    scopeHints,
    searchText,
    rawText: fullText.slice(0, 12000),
  };
}

async function fetchAllListItems() {
  const allItems = [];
  let page = 1;
  while (true) {
    const url = `${LIST_BASE}&page=${page}`;
    process.stdout.write(`  list page ${page}...`);
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.log(` error: ${e.message}`);
      break;
    }
    const items = parseListPage(html);
    if (items.length === 0) {
      console.log(' (empty, stopping)');
      break;
    }
    console.log(` ${items.length} items`);
    allItems.push(...items);
    // Check if there's a next page
    const $ = cheerioLoad(html);
    const hasNext = $('a, button').toArray().some((el) => {
      const text = $(el).text().trim();
      return text === String(page + 1) || $(el).attr('href')?.includes(`page=${page + 1}`);
    });
    if (!hasNext) break;
    page++;
    await sleep(500);
  }
  // Deduplicate by URL
  const seen = new Set();
  return allItems.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function main() {
  console.log('iPASS MONEY activity fetch\n');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('[1/2] Fetching list pages...');
  const listItems = await fetchAllListItems();
  console.log(`  Total: ${listItems.length} activities\n`);

  if (listItems.length === 0) {
    console.error('No activities found. The page structure may have changed.');
    process.exit(1);
  }

  console.log('[2/2] Fetching detail pages (always fetch active; body-hash compare)...');
  const endedCache = loadEndedCache(OUT_PATH);
  const prevIndex = loadActivityIndex(OUT_PATH);
  console.log(`  prev activities: ${prevIndex.size}, ended cache: ${endedCache.size}\n`);

  const activities = [];
  let skippedFetch = 0;
  for (let i = 0; i < listItems.length; i++) {
    const item = listItems[i];
    const slug = item.url.split('/').pop();
    const id = `ipass-${slug}`;
    const listPeriod = buildPeriod(item.startRaw, item.endRaw);
    const cachedHit = useCachedIfEnded(endedCache, id, listPeriod);
    if (cachedHit.skip) {
      activities.push({ ...cachedHit.cached, _fromCache: true });
      skippedFetch++;
      process.stdout.write(`\r  ${i + 1}/${listItems.length}: [cached] ${item.title.slice(0, 32)}   `);
      continue;
    }

    const listMeta = {
      title: item.title,
      name: item.title,
      startDate: item.startRaw || '',
      endDate: item.endRaw || '',
      externalUrl: item.url,
      updateDate: '',
    };

    process.stdout.write(`\r  ${i + 1}/${listItems.length}: ${item.title.slice(0, 40)}   `);

    let detail = null;
    try {
      const html = await fetchHtmlFollow(item.url);
      detail = parseDetailPage(html, item);
    } catch (e) {
      process.stdout.write(` [err: ${e.message}]`);
    }
    await sleep(300);

    const period = detail?.period || buildPeriod(item.startRaw, item.endRaw);
    const title = item.title || detail?.pageTitle;
    const quotaFull = parseQuotaFull(title, item.title, detail?.searchText, detail?.rawText);

    const row = enrichIpassActivity({
      id,
      platform: 'ipass',
      source: 'ipass_money',
      slug,
      url: item.url,
      title,
      period,
      merchants: detail?.merchants || [],
      rewards: detail?.rewards || [],
      scopeHints: detail?.scopeHints || [],
      searchText: detail?.searchText || title.toLowerCase(),
      quotaFull,
      fetchedAt: new Date().toISOString(),
      raw: detail
        ? { text: detail.rawText, list: listMeta }
        : { list: listMeta },
    });
    activities.push(row);
  }
  console.log('');

  const { payload, stats } = finalizeAndSave(OUT_PATH, {
    meta: {
      source: 'https://www.i-pass.com.tw/Preferential?type=0',
    },
    activities,
    endedCache,
    skippedFetch,
  });
  upsertPlatform('ipass');
  console.log(`\nSaved ${payload.activities.length} activities -> ${OUT_PATH}`);
  logCacheSummary(stats);

  const ongoing = payload.activities.filter((a) => a.period.status === 'active');
  const ended = payload.activities.filter((a) => a.period.status === 'ended');
  console.log(`  ongoing: ${ongoing.length}, ended: ${ended.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
