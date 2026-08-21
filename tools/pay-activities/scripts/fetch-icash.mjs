/**
 * Fetch icash Pay marketing activities into data/icash-activities.json
 * Usage: node scripts/fetch-icash.mjs
 *
 * Source: https://www.icashpay.com.tw/advertMessage/index/page/N
 * Detail: /advertMessage/view/id/{id}
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load as cheerioLoad } from 'cheerio';
import { parseQuotaFull } from '../viewer/quota-full.js';
import { normalizeBankName } from '../viewer/banks.js';
import { upsertPlatform } from './platform-catalog.mjs';
import {
  loadEndedCache,
  loadActivityIndex,
  useCachedIfEnded,
  useCachedIfUnchanged,
  finalizeAndSave,
  logCacheSummary,
} from './activity-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.PAY_DATA_DIR || path.join(ROOT, 'data');
const OUT_PATH = path.join(DATA_DIR, 'icash-activities.json');

const ORIGIN = 'https://www.icashpay.com.tw';
const LIST_BASE = `${ORIGIN}/advertMessage/index/page/`;

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

const KNOWN_MERCHANTS = [
  '7-ELEVEN',
  '7-11',
  '全家便利商店',
  '全家',
  '萬家福',
  '樂家康',
  "Mia C'bon",
  'Mia Cbon',
  '美廉社',
  '寶雅',
  '康是美',
  '台灣中油',
  '中油',
  '微風',
  '誠品',
  'momo',
  'PChome',
  '博客來',
  '家樂福',
  '大潤發',
  '全聯',
  '屈臣氏',
  '星巴克',
  '麥當勂',
  '必勝客',
  '肯德基',
  '夜市',
];

function bankNameOf(text) {
  return normalizeBankName(text);
}

async function fetchHtml(url) {
  const res = await fetch(url, FETCH_OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/-/g, '/').replace(/\./g, '/');
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

function isJunkMerchant(name) {
  const n = String(name || '').trim();
  if (!n || n.length < 2) return true;
  if (/^(repost[-_].*|logo\d*|pic|icon|share|facebook|twitter|instagram|youtube|line)$/i.test(n)) return true;
  if (/圖示|社群|分享|活動內容|注意事項|查詢指定店家/.test(n)) return true;
  if (/^(icash Pay|icash|OPENPOINT|指定店家|TWQR)$/i.test(n)) return true;
  if (/活動期間|回饋上限|贈點上限|每戶|即可享|單筆可累贈|^\d+元$/.test(n)) return true;
  if (n.length > 20) return true;
  return false;
}

function parseDateRange(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const m = s.match(
    /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*[－\-~～]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/
  );
  if (m) {
    return {
      startRaw: `${m[1]}/${m[2]}/${m[3]}`,
      endRaw: `${m[4]}/${m[5]}/${m[6]}`,
    };
  }
  const short = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*-\s*(\d{1,2})[-/.](\d{1,2})/);
  if (short) {
    return {
      startRaw: `${short[1]}/${short[2]}/${short[3]}`,
      endRaw: `${short[1]}/${short[4]}/${short[5]}`,
    };
  }
  return { startRaw: null, endRaw: null };
}

function parseListPage(html) {
  const $ = cheerioLoad(html);
  const items = [];
  $('a[href*="/advertMessage/view/id/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    const id = href.match(/\/id\/(\d+)/)?.[1];
    if (!id) return;
    const card = $a.closest('.post-card, .card-group, .card');
    const title =
      card.find('h3, h4, .card-title, .title').first().text().replace(/\s+/g, ' ').trim() ||
      $a.find('img').attr('alt') ||
      '';
    const url = href.startsWith('http') ? href : `${ORIGIN}${href}`;
    items.push({ id, title, url });
  });
  return items;
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
  const skipLine = /綜合計算|可疊加活動回饋所得|實際回饋以活動條件|月級挑戰/;

  const push = (label, detail, pct, role) => {
    if (pct != null && (!(pct > 0) || pct > 100)) return;
    const key = `${role}:${label}:${pct ?? 'x'}`;
    if (seen.has(key)) return;
    seen.add(key);
    rewards.push({ label, detail, ...(pct != null ? { pct } : {}), role });
  };

  const lines = body
    .split(/\n|。|；/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 6 && l.length <= 240 && !skipLine.test(l));

  for (const line of lines) {
    const cardM = line.match(/綁定(.{0,24}?)(信用卡|簽帳卡|聯名卡|金融卡).{0,80}?(\d+(?:\.\d+)?)\s*%/);
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
    // OPENPOINT 句型由下方 bodyBase 統一處理，此處略過避免重複
  }

  const BASE_PATTERNS_ICASH = [
    /(?:筆筆|每筆交易|每筆消費|每筆)\s*享\s*(\d+(?:\.\d+)?)\s*%\s*(?:icash點|Fa點|回饋)/i,
    /享\s*(\d+(?:\.\d+)?)\s*%\s*(?:icash點|Fa點)/i,
    /天天回饋\s*(\d+(?:\.\d+)?)\s*%\s*(?:icash點|Fa點|OPENPOINT)/i,
    /回饋\s*(\d+(?:\.\d+)?)\s*%\s*(?:icash點|Fa點|OPENPOINT)/i,
    /(\d+(?:\.\d+)?)\s*%\s*(?:icash點|Fa點|OPENPOINT)/i,
    /消費享\s*(\d+(?:\.\d+)?)\s*%/,
    /每筆消費回饋\s*(\d+(?:\.\d+)?)\s*%/,
  ];
  let bodyBaseMatch = null;
  for (const pat of BASE_PATTERNS_ICASH) {
    bodyBaseMatch = body.match(pat);
    if (bodyBaseMatch) break;
  }
  if (!bodyBaseMatch) {
    bodyBaseMatch =
      title.match(/最高回饋\s*(\d+(?:\.\d+)?)%/) ||
      title.match(/回饋\s*(\d+(?:\.\d+)?)%/) ||
      title.match(/(\d+(?:\.\d+)?)%/);
  }

  const basePct = bodyBaseMatch ? Number(bodyBaseMatch[1]) : null;
  if (basePct != null && basePct <= 50) {
    const already = rewards.some((r) => r.pct === basePct);
    if (!already) push('icash Pay 基本回饋', title, basePct, 'base');
  }

  if (!rewards.length) {
    const pct = pctFromText(title);
    rewards.push({ label: '優惠', detail: title, ...(pct != null ? { pct } : {}), role: 'base' });
  }
  return rewards.slice(0, 10);
}

function extractMerchants(title, fullText) {
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

  const main = String(fullText || '').split(/注意事項/)[0].slice(0, 2000);
  const blob = `${title}\n${main}`;
  for (const brand of KNOWN_MERCHANTS) {
    if (blob.includes(brand)) push(brand);
  }

  const storeMatch = blob.match(/(?:指定店家|精選通路|適用通路|指定通路)[：:]\s*([^。\n]{2,120})/);
  if (storeMatch) {
    storeMatch[1].split(/[、,，/／]/).forEach((s) => {
      const name = s.trim().replace(/[（(].*$/, '').trim();
      push(name);
    });
  }
  return found;
}

function parseDetailPage(html, listItem) {
  const $ = cheerioLoad(html);
  $('nav, footer, header, .menu, .footer, .header, script, style').remove();
  const $main = $('.content-block, .content, main, article, .post-content').first();
  const contentEl = $main.length ? $main : $('body');
  const fullText = contentEl.text().replace(/\s+/g, ' ').trim();
  const pageTitle = $('h1').first().text().trim() || listItem.title;
  const dates = parseDateRange(fullText);
  const rewards = extractRewards(pageTitle, fullText);
  const merchants = extractMerchants(pageTitle, fullText);
  const scopeHints = [];
  if (/TWQR/.test(fullText)) scopeHints.push('TWQR掃碼');
  if (/付款碼/.test(fullText)) scopeHints.push('付款碼');
  if (/掃碼/.test(fullText)) scopeHints.push('掃碼');
  if (/指定店家/.test(fullText)) scopeHints.push('指定店家');
  const searchText = [
    pageTitle,
    listItem.title,
    ...merchants,
    ...rewards.map((r) => `${r.label} ${r.detail}`),
    ...scopeHints,
  ]
    .join(' ')
    .toLowerCase();
  return {
    pageTitle,
    period: buildPeriod(dates.startRaw, dates.endRaw),
    merchants,
    rewards,
    scopeHints,
    searchText,
    rawText: fullText.slice(0, 12000),
  };
}

async function fetchAllListItems() {
  const byId = new Map();
  let page = 1;
  let emptyStreak = 0;
  while (page <= 20) {
    const url = `${LIST_BASE}${page}`;
    process.stdout.write(`  list page ${page}...`);
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.log(` error: ${e.message}`);
      break;
    }
    const items = parseListPage(html);
    let added = 0;
    for (const item of items) {
      if (byId.has(item.id)) continue;
      byId.set(item.id, item);
      added++;
    }
    console.log(` ${items.length} cards, +${added} new (total ${byId.size})`);
    if (added === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
    }
    page++;
    await sleep(350);
  }
  return [...byId.values()];
}

async function main() {
  console.log('icash Pay activity fetch\n');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('[1/2] Fetching list pages...');
  const listItems = await fetchAllListItems();
  console.log(`  Total: ${listItems.length} activities\n`);

  if (listItems.length === 0) {
    console.error('No activities found.');
    process.exit(1);
  }

  console.log('[2/2] Fetching detail pages (skip unchanged)...');
  const endedCache = loadEndedCache(OUT_PATH);
  const prevIndex = loadActivityIndex(OUT_PATH);
  console.log(`  prev activities: ${prevIndex.size}, ended cache: ${endedCache.size}\n`);

  const activities = [];
  let skippedFetch = 0;
  let skippedUnchanged = 0;
  for (let i = 0; i < listItems.length; i++) {
    const item = listItems[i];
    const id = `icash-${item.id}`;
    const cachedHit = useCachedIfEnded(endedCache, id);
    if (cachedHit.skip) {
      activities.push({ ...cachedHit.cached, _fromCache: true });
      skippedFetch++;
      process.stdout.write(`\r  ${i + 1}/${listItems.length}: [cached] ${(item.title || item.id).slice(0, 32)}   `);
      continue;
    }

    const listMeta = {
      title: item.title || '',
      name: item.title || '',
      startDate: '',
      endDate: '',
      externalUrl: item.url,
      updateDate: '',
    };
    const unchangedHit = useCachedIfUnchanged(prevIndex, id, listMeta, null);
    if (unchangedHit.skip) {
      activities.push(unchangedHit.cached);
      skippedFetch++;
      skippedUnchanged++;
      process.stdout.write(
        `\r  ${i + 1}/${listItems.length}: [unchanged] ${(item.title || item.id).slice(0, 28)}   `
      );
      continue;
    }

    process.stdout.write(`\r  ${i + 1}/${listItems.length}: ${(item.title || item.id).slice(0, 40)}   `);

    let detail = null;
    try {
      const html = await fetchHtml(item.url);
      detail = parseDetailPage(html, item);
    } catch (e) {
      process.stdout.write(` [err: ${e.message}]`);
    }
    await sleep(250);

    const period = detail?.period || buildPeriod(null, null);
    const title = detail?.pageTitle || item.title || `icash activity ${item.id}`;
    const quotaFull = parseQuotaFull(title, item.title, detail?.searchText, detail?.rawText);

    activities.push({
      id,
      platform: 'icash',
      source: 'icashpay',
      slug: item.id,
      url: item.url,
      title,
      period,
      merchants: detail?.merchants || [],
      rewards: detail?.rewards || [],
      scopeHints: detail?.scopeHints || [],
      searchText: detail?.searchText || title.toLowerCase(),
      quotaFull,
      official: true,
      fetchedAt: new Date().toISOString(),
      raw: detail
        ? { text: detail.rawText, list: listMeta }
        : { list: listMeta },
    });
  }
  console.log('');
  if (skippedUnchanged) console.log(`  unchanged active/upcoming reused: ${skippedUnchanged}`);

  const { payload, stats } = finalizeAndSave(OUT_PATH, {
    meta: {
      source: `${ORIGIN}/advertMessage/index/page/1`,
    },
    activities,
    endedCache,
    skippedFetch,
  });
  upsertPlatform('icash');
  console.log(`\nSaved ${payload.activities.length} activities -> ${OUT_PATH}`);
  logCacheSummary(stats);

  const ongoing = payload.activities.filter((a) => a.period.status === 'active');
  console.log(`Active: ${ongoing.length}, ended: ${payload.activities.filter((a) => a.period.status === 'ended').length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
