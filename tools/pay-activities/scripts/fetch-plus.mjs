/**
 * Fetch 全盈+PAY marketing activities into data/plus-activities.json
 * Usage: node scripts/fetch-plus.mjs
 *
 * Source: RyzoWEBA site API for event2023.pluspay.com.tw
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  preserveAiFields,
} from './activity-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.PAY_DATA_DIR || path.join(ROOT, 'data');
const OUT_PATH = path.join(DATA_DIR, 'plus-activities.json');

const SITE_DOMAIN = 'event2023.pluspay.com.tw';
const BASE = `https://${SITE_DOMAIN}`;
const API_URL = `${BASE}/api/weba/v3/site/publish/${SITE_DOMAIN}`;
const HOME_URL = `${BASE}/%E9%A6%96%E9%A0%81`;

const FETCH_OPTS = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json,text/plain,*/*',
    'Accept-Language': 'zh-TW,zh;q=0.9',
  },
};

const KNOWN_MERCHANTS = [
  '7-ELEVEN',
  '7-11',
  '全家便利商店',
  '全家',
  'FamilyMart',
  '美廉社',
  '萬家福',
  'momo',
  'PChome',
  '博客來',
  '屈臣氏',
  '康是美',
  '寶雅',
  '家樂福',
  '大潤發',
  '全聯',
  'ETmall',
  'friDay',
  '神腦',
  '燦坤',
  'PayPay',
  '台灣中油',
  '中油',
  '星巴克',
  '麥當勂',
  '必勝客',
  '肯德基',
];

function bankNameOf(text) {
  return normalizeBankName(text);
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  } else if (end) {
    const e = new Date(end.replace(/\//g, '-') + 'T23:59:59');
    status = now > e ? 'ended' : 'active';
  }
  return { start, end, status };
}

function parseDateRange(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const range = s.match(
    /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*[－\-~～]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/
  );
  if (range) {
    return {
      startRaw: `${range[1]}/${range[2]}/${range[3]}`,
      endRaw: `${range[4]}/${range[5]}/${range[6]}`,
    };
  }
  const single = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (single) {
    return {
      startRaw: `${single[1]}/${single[2]}/${single[3]}`,
      endRaw: `${single[1]}/${single[2]}/${single[3]}`,
    };
  }
  const openEnded = s.match(/即日起\s*[－\-~～]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (openEnded) {
    return {
      startRaw: null,
      endRaw: `${openEnded[1]}/${openEnded[2]}/${openEnded[3]}`,
    };
  }
  return { startRaw: null, endRaw: null };
}

function isJunkMerchant(name) {
  const n = String(name || '').trim();
  if (!n || n.length < 2) return true;
  if (/^(repost[-_].*|logo\d*|pic|icon|share|facebook|twitter|instagram|youtube|line)$/i.test(n)) return true;
  if (/圖示|社群|分享|活動內容|注意事項|文字輸入框|銀行活動|活動電商/.test(n)) return true;
  if (/^(全盈\+PAY|全盈|PAY|Fa點|指定店家|TWQR|PayPay)$/i.test(n)) return true;
  if (n.length > 20) return true;
  return false;
}

function collectAllComponents(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const x of node) collectAllComponents(x, out);
    return out;
  }
  if (node.id && node.type && node.data) out.push(node);
  for (const v of Object.values(node)) collectAllComponents(v, out);
  return out;
}

function pageFullText(page) {
  if (!page) return '';
  const all = collectAllComponents(page);
  return all
    .map((c) => stripHtml(c.data?.text || c.data?.content || c.data?.html || ''))
    .filter((t) => t.length > 2 && !/^文字輸入框/.test(t))
    .join('\n');
}

function buildPageMap(structure) {
  const map = new Map();
  for (const page of structure.mobile?.pageMenegent || []) {
    map.set(page.titleId, page);
    map.set(page.name, page);
  }
  return map;
}

function parseCardGroups(page) {
  const cards = [];
  const seen = new Set();
  for (const slide of page?.pageSlideList || []) {
    const all = collectAllComponents(slide);
    const groups = new Map();
    for (const c of all) {
      const parent = c.belongTo || 'root';
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(c);
    }

    for (const [parent, items] of groups) {
      if (parent === 'root') continue;
      const title = stripHtml(items.find((c) => c.data?.name === 'title')?.data?.text);
      const date = stripHtml(items.find((c) => c.data?.name === 'date')?.data?.text);
      if (!title || !date) continue;

      const dedupeKey = `${title}::${date}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const image = items.find((c) => c.type === 'image');
      const linkData =
        image?.data?.linkData ||
        items.find((c) => c.data?.linkData?.used)?.data?.linkData ||
        null;

      cards.push({
        parent,
        title,
        date,
        link: linkData?.link || '',
        pageId: linkData?.pageId && linkData.pageId !== 'none' ? linkData.pageId : null,
        linkType: linkData?.type || null,
        sourcePage: page?.name || null,
      });
    }
  }
  return cards;
}

function parseHomeCards(structure) {
  const home =
    structure.mobile?.pageMenegent?.find((p) => p.name === '\u9996\u9801') ||
    structure.mobile?.pageMenegent?.find((p) => p.name === '\u9996\u9801test');
  if (!home) return [];
  return parseCardGroups(home);
}

const SKIP_PAGE_NAMES = new Set(['\u9996\u9801', '\u9996\u9801test', 'Payment']);
const SKIP_PAGE_RE = /^(test|demo|pc\d+$)/i;
const HEADLINE_SKIP_RE =
  /注意事項|了解更多|文字輸入框|銀行活動|活動電商|首綁禮|立即申貸|立即繳費|本月最強回饋|優惠一站掌握|請用手機開啟|前往消費|回饋計算範例|四倍贈回饋算法|全家實體門市|全家以外/;

function extractHeadline(texts) {
  const candidates = texts.filter(
    (t) =>
      t.length >= 6 &&
      t.length <= 120 &&
      !/^\d{4}\//.test(t) &&
      !HEADLINE_SKIP_RE.test(t) &&
      /回饋|%|Fa點|儲值金|綁定|信用卡|帳戶|全家|PayPay|滿額|消費|優惠|會員日|抽好禮/.test(t)
  );
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const score = (t) =>
      (/【/.test(t) ? 3 : 0) + (/%/.test(t) ? 2 : 0) + (/最高/.test(t) ? 1 : 0) - t.length / 200;
    return score(b) - score(a);
  })[0];
}

function isActivityLikePage(page) {
  if (!page?.pageSlideList?.length) return false;
  if (SKIP_PAGE_NAMES.has(page.name) || SKIP_PAGE_RE.test(page.name)) return false;
  const text = pageFullText(page);
  if (!/回饋|%|Fa點|儲值金|綁定|信用卡|帳戶|PayPay|會員日/.test(text)) return false;
  return /\d{4}\/\d{1,2}\/\d{1,2}/.test(text);
}

function parseStandalonePages(structure, coveredPageIds) {
  const pages = [];
  for (const page of structure.mobile?.pageMenegent || []) {
    if (coveredPageIds.has(page.titleId)) continue;
    if (!isActivityLikePage(page)) continue;

    const texts = collectAllComponents(page)
      .map((c) => stripHtml(c.data?.text || c.data?.content || c.data?.html || ''))
      .filter((t) => t.length > 2);

    const headline = extractHeadline(texts);
    if (!headline) continue;

    pages.push({
      kind: 'page',
      title: headline,
      pageId: page.titleId,
      pageName: page.name,
      detailText: pageFullText(page),
      listDate: texts.find((t) => /\d{4}\/\d{1,2}\/\d{1,2}/.test(t)) || '',
    });
  }
  return pages;
}

function collectDateRanges(...texts) {
  const ranges = [];
  const seen = new Set();
  const push = (startRaw, endRaw) => {
    const key = `${startRaw || ''}|${endRaw || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    ranges.push({ startRaw, endRaw });
  };

  for (const text of texts) {
    const s = String(text || '');
    for (const m of s.matchAll(
      /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*[－\-~～]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g
    )) {
      push(`${m[1]}/${m[2]}/${m[3]}`, `${m[4]}/${m[5]}/${m[6]}`);
    }
    for (const m of s.matchAll(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*-\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g)) {
      push(`${m[1]}/${m[2]}/${m[3]}`, `${m[4]}/${m[5]}/${m[6]}`);
    }
    const openEnded = s.match(/即日起\s*[－\-~～]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (openEnded) {
      push(null, `${openEnded[1]}/${openEnded[2]}/${openEnded[3]}`);
    }
  }

  if (!ranges.length) {
    for (const text of texts) {
      const single = String(text || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (single) push(`${single[1]}/${single[2]}/${single[3]}`, `${single[1]}/${single[2]}/${single[3]}`);
    }
  }
  return ranges;
}

function pickBestPeriod(...texts) {
  const ranges = collectDateRanges(...texts);
  if (!ranges.length) return buildPeriod(null, null);

  const now = new Date();
  const scored = ranges.map((r) => {
    const period = buildPeriod(r.startRaw, r.endRaw);
    const start = period.start ? new Date(period.start.replace(/\//g, '-')) : null;
    const end = period.end ? new Date(period.end.replace(/\//g, '-') + 'T23:59:59') : null;
    const spanDays =
      start && end ? Math.max(1, Math.round((end - start) / 86400000) + 1) : 1;
    let score = 0;
    if (period.status === 'active') score += 100;
    else if (period.status === 'upcoming') score += 50;
    if (spanDays >= 7) score += 20;
    if (end && end >= now) score += 10;
    return { period, score, endMs: end ? end.getTime() : 0, spanDays };
  });
  scored.sort((a, b) => b.score - a.score || b.spanDays - a.spanDays || b.endMs - a.endMs);
  return scored[0].period;
}

function activityUrl(entry, pageMap) {
  if (entry.kind === 'page') {
    return `${BASE}/${encodeURIComponent(entry.pageName)}`;
  }
  const card = entry;
  const link = String(card.link || '').trim();
  if (link && !/^https?:\/\/(www\.)?pluspay\.com\.tw\/?$/i.test(link)) return link;
  if (card.pageId && pageMap.has(card.pageId)) {
    const page = pageMap.get(card.pageId);
    return `${BASE}/${encodeURIComponent(page.name)}`;
  }
  return HOME_URL;
}

function plusEntryId(entry) {
  // Prefer stable pageId so list-card title churn does not mint a new activity id.
  if (entry.pageId) return `plus-${entry.pageId}`;
  const slug = slugify(entry.title) || entry.parent || entry.pageName;
  return `plus-${String(slug).replace(/^title-/, '')}`;
}

function plusListPeriod(entry) {
  const listDate = entry.kind === 'page' ? entry.listDate : entry.date;
  const detailText = entry.kind === 'page' ? entry.detailText : '';
  return pickBestPeriod(listDate, entry.title, detailText);
}

function buildActivity(entry, pageMap) {
  const isPage = entry.kind === 'page';
  const cardTitle = isPage ? entry.title : entry.title;
  const listDate = isPage ? entry.listDate : entry.date;
  const detailPage = entry.pageId ? pageMap.get(entry.pageId) : isPage ? pageMap.get(entry.pageId) : null;
  const detailText = isPage ? entry.detailText : detailPage ? pageFullText(detailPage) : '';

  const pageTitle =
    extractHeadline(detailText.split('\n')) ||
    detailText
      .split('\n')
      .find(
        (l) =>
          l.length > 8 &&
          l.length < 120 &&
          !/^\d{4}\//.test(l) &&
          !HEADLINE_SKIP_RE.test(l)
      ) ||
    cardTitle;

  const period = pickBestPeriod(listDate, cardTitle, detailText);
  const fullText = `${cardTitle}\n${listDate}\n${detailText}`;
  const rewards = extractRewards(pageTitle, fullText);
  const merchants = extractMerchants(pageTitle, fullText);
  const scopeHints = [];
  if (/TWQR|掃碼/.test(fullText)) scopeHints.push('TWQR掃碼');
  if (/Fa點|全家/.test(fullText)) scopeHints.push('Fa點');
  if (/全盈儲值金/.test(fullText)) scopeHints.push('全盈儲值金');
  if (/指定店家|電商通路/.test(fullText)) scopeHints.push('指定通路');

  const url = activityUrl(entry, pageMap);
  const slug = entry.pageId
    ? entry.pageId
    : slugify(cardTitle) || entry.parent || entry.pageName;
  const id = `plus-${String(slug).replace(/^title-/, '')}`;
  const searchText = [pageTitle, cardTitle, ...merchants, ...rewards.map((r) => `${r.label} ${r.detail}`)]
    .join(' ')
    .toLowerCase();
  const quotaFull = parseQuotaFull(pageTitle, cardTitle, searchText, fullText);

  return {
    id,
    platform: 'plus',
    source: 'pluspay',
    slug,
    url,
    title: pageTitle,
    period,
    merchants,
    rewards,
    scopeHints,
    searchText,
    quotaFull,
    official: true,
    fetchedAt: new Date().toISOString(),
    raw: {
      text: fullText.slice(0, 12000),
      homepageTitle: isPage ? null : cardTitle,
      homepageDate: isPage ? null : listDate,
      pageName: isPage ? entry.pageName : detailPage?.name || null,
      sourceKind: isPage ? 'standalone_page' : 'homepage_card',
      list: {
        title: cardTitle,
        name: cardTitle,
        startDate: period?.start || '',
        endDate: period?.end || '',
        externalUrl: url,
        updateDate: '',
      },
    },
  };
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
  const skipLine = /綜合計算|可疊加活動回饋所得|實際回饋以活動條件/;

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
    .filter((l) => l.length >= 6 && l.length <= 260 && !skipLine.test(l));

  for (const line of lines) {
    const cardM = line.match(/綁定(.{0,24}?)(信用卡|簽帳卡|聯名卡|金融卡|VISA金融卡).{0,100}?(\d+(?:\.\d+)?)\s*%/);
    if (cardM) {
      const bank = bankNameOf(cardM[1] + line) || bankNameOf(line);
      if (bank) {
        push(bank, line, Number(cardM[3]), 'card');
        continue;
      }
    }
    const accM = line.match(/(?:連結|綁定|首次)(.{0,20}?)(?:銀行)?(?:帳戶|活期).{0,100}?(\d+(?:\.\d+)?)\s*%/);
    if (accM) {
      const bank = bankNameOf(accM[1] + line) || bankNameOf(line);
      if (bank) push(bank, line, Number(accM[2]), 'account');
    }
    const cashM = line.match(/回饋全盈儲值金\s*(\d+)\s*元/);
    if (cashM) push('主活動', line, null, 'base');
  }

  const BASE_PATTERNS_PLUS = [
    /(?:筆筆|每筆交易|每筆消費|每筆)\s*享\s*(\d+(?:\.\d+)?)\s*%\s*(?:全盈儲值金|回饋)/,
    /享\s*(\d+(?:\.\d+)?)\s*%\s*全盈儲值金/,
    /享\s*(\d+(?:\.\d+)?)\s*%\s*回饋/,
    /消費享\s*(\d+(?:\.\d+)?)\s*%/,
    /每筆消費回饋\s*(\d+(?:\.\d+)?)\s*%/,
    /筆筆享\s*(\d+(?:\.\d+)?)\s*%/,
    /最高\s*(\d+(?:\.\d+)?)\s*%\s*回饋/,
    /(\d+(?:\.\d+)?)\s*%\s*回饋/,
  ];
  let bodyBaseMatch = null;
  for (const pat of BASE_PATTERNS_PLUS) {
    bodyBaseMatch = body.match(pat);
    if (bodyBaseMatch) break;
  }
  if (!bodyBaseMatch) {
    bodyBaseMatch =
      title.match(/最高\s*(\d+(?:\.\d+)?)%/) ||
      title.match(/(\d+(?:\.\d+)?)%\s*回饋/);
  }

  const basePct = bodyBaseMatch ? Number(bodyBaseMatch[1]) : null;
  if (basePct != null && basePct <= 50) {
    const already = rewards.some((r) => r.pct === basePct);
    if (!already) push('全盈+PAY 基本回饋', title, basePct, 'base');
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
    if (n === 'FamilyMart') {
      if (!found.includes('全家')) found.push('全家');
      return;
    }
    if (!found.includes(n)) found.push(n);
  };

  const main = String(fullText || '').split(/注意事項/)[0].slice(0, 2200);
  const blob = `${title}\n${main}`;
  for (const brand of KNOWN_MERCHANTS) {
    if (blob.includes(brand)) push(brand);
  }

  const storeMatch = blob.match(/(?:指定店家|精選通路|適用通路|電商通路|於)([^。\n]{2,120})/);
  if (storeMatch) {
    storeMatch[1].split(/[、,，/／]/).forEach((s) => {
      const name = s.trim().replace(/[（(].*$/, '').trim();
      push(name);
    });
  }
  return found;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function fetchSiteStructure() {
  const res = await fetch(API_URL, FETCH_OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${API_URL}`);
  const data = await res.json();
  if (data.err) throw new Error(data.msg || 'site API error');
  return JSON.parse(data.structure_prod);
}

async function main() {
  console.log('\u5168\u76c8+PAY activity fetch\n');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('[1/3] Fetching site structure...');
  const structure = await fetchSiteStructure();
  const pageMap = buildPageMap(structure);
  const homeCards = parseHomeCards(structure).map((card) => ({ kind: 'homepage', ...card }));
  const coveredPageIds = new Set(homeCards.map((c) => c.pageId).filter(Boolean));
  const standalonePages = parseStandalonePages(structure, coveredPageIds);
  console.log(`  Homepage cards: ${homeCards.length}`);
  console.log(`  Standalone activity pages: ${standalonePages.length}\n`);

  if (homeCards.length === 0 && standalonePages.length === 0) {
    console.error('No activities found.');
    process.exit(1);
  }

  console.log('[2/3] Building activities (skip unchanged)...');
  const endedCache = loadEndedCache(OUT_PATH);
  const prevIndex = loadActivityIndex(OUT_PATH);
  console.log(`  prev activities: ${prevIndex.size}, ended cache: ${endedCache.size}\n`);

  const activities = [];
  const seen = new Set();
  let skippedFetch = 0;
  let skippedUnchanged = 0;

  for (const entry of [...homeCards, ...standalonePages]) {
    const dedupeKey = entry.pageId
      ? `page:${entry.pageId}`
      : `${entry.title}::${entry.date}::${entry.link || entry.parent || entry.pageName}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const id = plusEntryId(entry);
    let prevLookupId = id;
    if (!prevIndex.has(id) && entry.pageId) {
      const prefix = `plus-${entry.pageId}`;
      for (const pid of prevIndex.keys()) {
        if (pid === prefix || pid.startsWith(`${prefix}-`)) {
          prevLookupId = pid;
          break;
        }
      }
    }
    const listPeriod = plusListPeriod(entry);
    const cachedHit = useCachedIfEnded(endedCache, prevLookupId, listPeriod);
    if (cachedHit.skip) {
      activities.push({ ...cachedHit.cached, id, _fromCache: true });
      skippedFetch++;
      continue;
    }

    const url = activityUrl(entry, pageMap);
    const listMeta = {
      title: entry.title,
      name: entry.title,
      startDate: listPeriod?.start || '',
      endDate: listPeriod?.end || '',
      externalUrl: url,
      updateDate: '',
    };
    const unchangedHit = useCachedIfUnchanged(prevIndex, prevLookupId, listMeta, listPeriod);
    if (unchangedHit.skip) {
      activities.push({ ...unchangedHit.cached, id });
      skippedFetch++;
      skippedUnchanged++;
      continue;
    }

    const act = buildActivity(entry, pageMap);
    if (prevLookupId !== id && prevIndex.has(prevLookupId)) {
      activities.push(preserveAiFields({ ...act, id }, prevIndex.get(prevLookupId)));
    } else {
      activities.push(act);
    }
  }

  console.log('[3/3] Saving...');
  if (skippedUnchanged) console.log(`  unchanged reused: ${skippedUnchanged}`);

  const { payload, stats } = finalizeAndSave(OUT_PATH, {
    meta: {
      source: HOME_URL,
    },
    activities,
    endedCache,
    skippedFetch,
  });
  upsertPlatform('plus');
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
