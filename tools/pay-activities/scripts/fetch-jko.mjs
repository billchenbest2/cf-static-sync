/**
 * Fetch JKO Pay (street-mouth) marketing activities into data/jko-activities.json
 * Usage:
 *   node scripts/fetch-jko.mjs
 *
 * Source: https://mkt.jkopay.com/zh-TW/campaign/newevent
 * The public page is a Next.js App Router + mofang CMS shell. Activity cards
 * live in the RSC payload (Accept: text/x-component, RSC: 1).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseQuotaFull } from '../viewer/quota-full.js';
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
const OUT_PATH = path.join(DATA_DIR, 'jko-activities.json');

const LIST_URL = 'https://mkt.jkopay.com/zh-TW/campaign/newevent';
const ORIGIN = 'https://mkt.jkopay.com';
const GIFT_API = 'https://marketing-gw.jkopay.com/campaign-ap/common/campaign/detail/v2';

const COUPON_FULL = new Set(['OUT_OF_STOCK', 'OUT_OF_QUOTA', 'COUPON_OUT_OF_QUOTA']);
const COUPON_ENDED = new Set(['OVERDUE', 'COUPON_OVERDUE']);
const COUPON_SOON = new Set(['UPCOMING', 'COUPON_UPCOMING']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FETCH_OPTS = {
  headers: {
    'User-Agent': UA,
    Accept: 'text/x-component',
    RSC: '1',
    'Accept-Language': 'zh-TW,zh;q=0.9',
  },
};

const JSON_OPTS = {
  headers: {
    'User-Agent': UA,
    Accept: 'application/json',
    'Accept-Language': 'zh-TW,zh;q=0.9',
  },
};

const SKIP_SLUGS = new Set(['newevent', 'newevent2026-8']);

const WEEKDAY_NAME = /^(每週[一二三四五六日]|每月\d+號)$/;

const KNOWN_MERCHANTS = [
  '7-ELEVEN',
  '7-11',
  'CITY CAFE',
  'CITY CAFÉ',
  '肯德基',
  '必勝客',
  '淘寶',
  'Trip.com',
  'Apple',
  'Google',
  '萬家福',
  '樂家康',
  'Garena',
  '三角洲行動',
  '傳說對決',
  '普雷伊',
  '膳魔師',
  'LG',
  '蝦皮',
  '蝦皮購物',
  'momo',
  'PChome',
  '91APP',
  '全聯',
  '屈臣氏',
  '康是美',
  '寶雅',
  '日藥本舖',
  '丁丁藥局',
  '杏一醫療用品',
  "Tomod's",
  '松本清',
  'innisfree',
  '札幌藥粧',
  'J-MART佳瑪',
  '金興發',
  '迪卡儂',
  '東森寵物',
  '寵物公園',
  '大樹寵物',
  '金玉堂',
  '金石堂',
];

function extractJsonObject(text, marker) {
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const slice = text.slice(idx);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(slice.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchRsc(url) {
  const res = await fetch(url, FETCH_OPTS);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = extractJsonObject(text, '{"data":{"schema":');
  return { text, json };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function isJunkBlob(s) {
  const t = String(s || '').trim();
  if (!t || t.length < 2) return true;
  if (/客服專線|版權所有|all rights reserved|Instagram|facebook|LinkedIn|立即下載街口/i.test(t)) return true;
  if (/^\$?\d+$/.test(t)) return true;
  if (/^(0\d|title[-_]|img_|anchor_)/i.test(t)) return true;
  return false;
}

function localeValues(data) {
  const values = data?.values || {};
  return values['zh-TW'] || values[Object.keys(values)[0]] || {};
}

function walkSchema(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => walkSchema(n, fn));
    return;
  }
  fn(node);
  if (node.children) walkSchema(node.children, fn);
}

function parseJkoUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || !/^https?:\/\//i.test(value)) return null;
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const isOfficialHost = host === 'mkt.jkopay.com';
  if (!isOfficialHost) {
    return { external: true, url: u.toString(), slug: null, kind: 'external', fetchUrl: null };
  }
  u.hash = '';
  u.search = '';
  const parts = u.pathname.split('/').filter(Boolean);
  const localeIdx = parts[0] === 'zh-TW' || parts[0] === 'en' ? 1 : 0;
  const kind = parts[localeIdx] === 'event' ? 'event' : 'campaign';
  const slug = parts[parts.length - 1];
  if (!slug || SKIP_SLUGS.has(slug)) return null;
  const fetchUrl = `${ORIGIN}/zh-TW/${kind}/${slug}`;
  return { external: false, url: fetchUrl, slug, kind, fetchUrl };
}

function collectListItems(cms) {
  const data = cms.data || {};
  const locale = localeValues(data);
  const items = [];
  let section = '其他';

  const pushItem = (partial) => {
    const parsed = parseJkoUrl(partial.url);
    if (!parsed && !partial.allowMissingUrl) return;
    const name = String(partial.name || '').trim();
    if (!name) return;
    if (/^(Apple|Google)$/i.test(name)) return;
    if (/^(anchor_|title_|聯繫|版權)/.test(name)) return;
    if (/itunes\.apple|play\.google|apps\.apple/i.test(String(partial.url || ''))) return;
    items.push({
      listTitle: name,
      subtitle: partial.subtitle || '',
      section: partial.section || section,
      image: partial.image || '',
      head: partial.head || '',
      showTime: partial.showTime || null,
      hints: [name, partial.hintName].filter(Boolean),
      parsed: parsed || { external: true, url: partial.url || '', slug: null, kind: 'external', fetchUrl: null },
    });
  };

  walkSchema(data.schema, (node) => {
    const v = locale[node.id];
    if (!v || typeof v !== 'object') return;
    if (node.type === 'TextEditor') {
      const label = stripHtml(v.content) || String(v.name || '').replace(/^title_/, '');
      if (label && /精選|品牌|回饋|主題|會員|活動|街口券/.test(label) && label.length <= 20) {
        section = label;
      }
    }
    if (node.type === 'Image' && Array.isArray(v.items)) {
      for (const it of v.items) {
        pushItem({
          name: it.name || v.name,
          url: it.urlOpenType?.value,
          image: it.backgroundImage,
          section,
        });
      }
    }
    if (node.type === 'NewsPost' && Array.isArray(v.items)) {
      for (const it of v.items) {
        pushItem({
          name: it.mainTitle?.text || it.name,
          subtitle: it.subtitle?.text || '',
          url: it.urlOpenType?.value,
          image: it.image?.backgroundImage,
          head: it.head?.text || '',
          showTime: it.showTime,
          section: '更多活動',
          hintName: it.name,
          allowMissingUrl: false,
        });
      }
    }
  });

  return items;
}

function mergeListItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.parsed.slug
      ? `${item.parsed.kind}:${item.parsed.slug}`
      : `ext:${item.parsed.url}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...item,
        merchantsHint: (item.hints || [item.listTitle]).filter((n) => n && !WEEKDAY_NAME.test(n)),
      });
      continue;
    }
    for (const h of item.hints || [item.listTitle]) {
      if (h && !WEEKDAY_NAME.test(h) && !prev.merchantsHint.includes(h)) prev.merchantsHint.push(h);
    }
    if (item.subtitle && (!prev.subtitle || item.subtitle.length > prev.subtitle.length)) {
      prev.subtitle = item.subtitle;
    }
    if (item.head && !prev.head) prev.head = item.head;
    if (item.showTime && !prev.showTime) prev.showTime = item.showTime;
    if (item.image && !prev.image) prev.image = item.image;
    if (!WEEKDAY_NAME.test(item.listTitle) && WEEKDAY_NAME.test(prev.listTitle)) {
      prev.listTitle = item.listTitle;
    }
  }
  return [...map.values()];
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(y, m, d) {
  return `${y}/${pad2(m)}/${pad2(d)}`;
}

function parseShowTime(showTime) {
  if (!Array.isArray(showTime) || showTime.length < 2) return { start: null, end: null };
  const toYmd = (raw) => {
    const m = String(raw || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? ymd(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  };
  return { start: toYmd(showTime[0]), end: toYmd(showTime[1]) };
}

function parseHeadRange(head) {
  const s = String(head || '').replace(/\./g, '/');
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-~～]\s*(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/);
  if (!m) return { start: null, end: null };
  const sy = Number(m[1]);
  const sm = Number(m[2]);
  const sd = Number(m[3]);
  let ey = m[4] ? Number(m[4]) : sy;
  const em = Number(m[5]);
  const ed = Number(m[6]);
  if (!m[4] && em < sm) ey += 1;
  return { start: ymd(sy, sm, sd), end: ymd(ey, em, ed) };
}

function parseBodyRange(body) {
  const s = String(body || '');
  const chunks = s.split(/(?=活動時間|活動期間|累積消費金額時間)/);
  const focus = chunks
    .filter((c) => /^(活動時間|活動期間|累積消費金額時間)/.test(c.trim()))
    .join('\n')
    .slice(0, 500);
  return parseTextRange(focus);
}

function parseTextRange(text) {
  const s = String(text || '').replace(/\./g, '/');
  const patterns = [
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-~～]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/,
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-~～]\s*(\d{1,2})\/(\d{1,2})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const sy = Number(m[1]);
    const sm = Number(m[2]);
    const sd = Number(m[3]);
    if (m.length >= 7) {
      return { start: ymd(sy, sm, sd), end: ymd(Number(m[4]), Number(m[5]), Number(m[6])) };
    }
    let ey = sy;
    const em = Number(m[4]);
    const ed = Number(m[5]);
    if (em < sm) ey += 1;
    return { start: ymd(sy, sm, sd), end: ymd(ey, em, ed) };
  }
  return { start: null, end: null };
}

function buildPeriod(start, end) {
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
  return { start: start || null, end: end || null, status };
}

function collectPageText(data) {
  const locale = localeValues(data);
  const bits = [];
  const collectStringsDeep = (obj, out = []) => {
    if (!obj || typeof obj !== 'object') return out;
    if (Array.isArray(obj)) {
      for (const x of obj) collectStringsDeep(x, out);
      return out;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        const t = stripHtml(v);
        // ListSearch often stores merchant labels in arbitrary string fields.
        if (t && t.length >= 2 && t.length <= 80 && !/^(https?:|\/|_blank|zh-TW|true|false)$/i.test(t)) {
          out.push(t);
        }
      } else if (v && typeof v === 'object') {
        collectStringsDeep(v, out);
      }
    }
    return out;
  };
  for (const v of Object.values(locale)) {
    if (!v || typeof v !== 'object') continue;
    if (v.content) {
      const t = stripHtml(v.content);
      if (!isJunkBlob(t) && t.length > 8) bits.push(t);
    }
    if (Array.isArray(v.items)) {
      for (const it of v.items) {
        const name = it?.name || it?.mainTitle?.text;
        const sub = it?.subtitle?.text;
        if (name && !isJunkBlob(name)) bits.push(name);
        if (sub && !isJunkBlob(sub)) bits.push(sub);
        // Pull deep strings from each card/list item to include hidden merchant lists.
        collectStringsDeep(it, bits);
      }
    }
    collectStringsDeep(v, bits);
  }
  return bits.join('\n');
}

// ── Merchant extraction ─────────────────────────────────────────────────────
// Strategy: whitelist, not blacklist.
//   1. merchantsHint (card names from the list page) are the highest-quality source.
//   2. KNOWN_MERCHANTS gives a full-text fallback.
//   3. Page body is only mined when there is a "store list" section (查看適用店家).
//      In that case, only strings that POSITIVELY look like a real brand get kept.
// This avoids the endless whack-a-mole of blacklisting CMS component tokens.

/** Strings that are definitely NOT merchant names no matter the context. */
function isDefinitelyNoise(n) {
  if (!n || n.length < 2) return true;
  // CSS/layout tokens
  if (/^\d+(?:px|fr|%|rem|em|vh|vw)?$/i.test(n)) return true;
  if (/^\d*\.?\d+fr(\s+\d*\.?\d+fr)*$/i.test(n)) return true;
  if (/\d+px/.test(n)) return true;
  if (/rgba?\s*\(/.test(n)) return true;
  if (/^(center|left|right|top|bottom|flex|grid|column|row|row-reverse|column-reverse|start|end|auto|none|block|inline|hidden|sticky|contain|no-repeat|repeat|cover|fill|transparent|white|black|dark|custom)$/i.test(n)) return true;
  // CSS position combos: "center right", "bottom center", etc.
  if (/^(top|bottom|center|left|right)(\s+(top|bottom|center|left|right))+$/i.test(n)) return true;
  // React/CMS component names
  if (/^(Image|Box|TextEditor|Collapse|Slider|Border|XSlides|Fade|GridBox|TextWithImg|Button|NewsPost|Tabs|Tab\d+|HtmlPrivew|HtmlPreview)$/i.test(n)) return true;
  // CMS internal IDs and naming patterns
  if (/^c-[a-z0-9_-]+$/i.test(n)) return true;
  if (/^#[0-9a-f]{3,8}$/i.test(n)) return true;
  if (/^(anchor|anchor\d*|anchor_\d+|anchor_box|KV_[\w-]+|ShowTime_[\w-]+|RRLimitedQuota|CouponNew|twoColors)$/i.test(n)) return true;
  if (/^(title_|inner_|img-holder|logo_box|品項名稱-|適用品牌logo|指定通路_名單|space-between)/i.test(n)) return true;
  // Any string with underscore is a CMS variable name, not a brand
  if (n.includes('_')) return true;
  // img_ prefix (image block names)
  if (/^img[A-Z_]/.test(n)) return true;
  // Pure hex-like or all-lowercase ASCII tokens (likely class names)
  if (/^[a-z0-9]{5,}$/i.test(n) && !/[A-Z\u4e00-\u9fff]/.test(n)) return true;
  // URLs / punctuation blobs
  if (/^https?:\/\//i.test(n)) return true;
  if (/[{}<>，。；]/.test(n)) return true;
  if (/^[-]{3,}$/.test(n)) return true;
  // Obvious UI labels / instructional text
  if (/^(大標|小標|內容|下載|聯繫方式|立即下載街口支付|立即開通街口支付|搜尋|區域|PayPay|KV|inner|fill|grid|start|img-holder|空白|收合|統整頁|會員日Banner)$/.test(n)) return true;
  if (/^(Instagram|LinkedIn|Facebook|社群|white|black|dark)$/i.test(n)) return true;
  // Activity / instruction keywords — definitely not a brand
  if (/活動|回饋|限額|付款|綁定|開通|銀行|注意事項|任務|下載|配合之銀行|支付工具|優惠券|折抵|街口幣|新戶|滿額|登入|指定付款|查看|適用店家|適用通路/.test(n)) return true;
  // Product descriptions (unit patterns)
  if (/\d+g|\d+ml|\d+包|\d+元|\d+折|原味|冷藏|拖鞋|行李箱/.test(n)) return true;
  // Date ranges
  if (/\d{4}\/\d{1,2}\/\d{1,2}/.test(n)) return true;
  // Month voucher labels "8月 券"
  if (/^\d+月\s*[券期]/.test(n)) return true;
  // "auto auto auto" CSS grid template pattern
  if (/^(auto\s+){2,}auto$/.test(n)) return true;
  // Strings that contain "/" with digits (likely dates/product codes, not brands)
  if (/\d+\/\d+/.test(n) && !/^7-ELEVEN|^\d+-ELEVEN/.test(n)) return true;
  // Banner / image labels
  if (/^Banner$|^KV$/.test(n)) return true;
  // Generic descriptive phrases (not brand names)
  if (/禮券|支付限定|整塊|必買區|品牌任你選|採買|爆品|好康/.test(n)) return true;
  // Apple/Google app store links (app download entries, not merchants)
  if (/^(Apple|Google)$/.test(n)) return true;
  return false;
}

/**
 * Positive test: does this string LOOK like a real brand / merchant name?
 *
 * A genuine brand name:
 *  - Is 2-25 characters
 *  - Contains CJK or Latin letters (not just numbers/symbols)
 *  - Does NOT match any CMS/CSS noise patterns
 *  - Does NOT look like a generic category / action phrase
 */
function looksLikeBrand(n) {
  if (!n || n.length < 2 || n.length > 25) return false;
  if (isDefinitelyNoise(n)) return false;
  if (/^\d+$/.test(n)) return false;
  if (/[%$＄]/.test(n)) return false;
  if (/^\d{4}\//.test(n)) return false;
  if (/[。?？!！：:「」【】〔〕《》〈〉]/.test(n)) return false;
  // Brand+amount combos like "全聯 200", "全聯 500" — these are spending tiers, not store names
  if (/[\u4e00-\u9fff]\s+\d{3,}$/.test(n)) return false;
  // Must contain at least one letter or CJK char
  if (!/[\u4e00-\u9fffA-Za-z]/.test(n)) return false;
  // Reject strings with parentheses unless they look like brand qualifiers
  if (/[()（）]/.test(n) && !/(官網|店|館|城|廣場|百貨|旅遊|集團|藥局|購物|商店|超市|南港|台北|高雄|市|LALAPORT)/.test(n)) return false;
  // Reject pure action verbs / generic category labels
  if (/^(每週|每月|週[一二三四五六日]|活動期間|活動時間|累積|滿額|指定|回饋|優惠|享有|購買|先|抽|領|搶|加碼|解鎖)/.test(n)) return false;
  if (/^(百貨量販|飲料咖啡|出國旅遊|美食餐點|電商網購|電商購物|美妍保健|精選百貨|採買寵物|精選品牌|精選通路|推薦消費通路|推薦必買|全台品牌|萬家福適用清單|街利存|豬富卡|街口帳戶|精選熱門品牌|爆品推薦|超市生鮮|生活日用|寵物用品|類別|縣市區域|品牌圖|好康推薦|加碼內容|宜睿專區|品牌列表|空白|統整頁|收合|商品實際售價請以賣場公告為準)$/.test(n)) return false;
  // Reject CMS block/tab names with digits
  if (/^(Tab\d+\s+Content|品牌列表\d+|標題\d+|內容\d+)/.test(n)) return false;
  // Reject strings longer than likely brand names (product description length)
  if (n.length > 18 && /[\u4e00-\u9fff]{6,}/.test(n) && !/(集團|購物中心|百樂園|生活藥妝|生活百貨|文具專家|五金百貨|薬妝|寵物生活館|肉舖)/.test(n)) return false;
  return true;
}

/**
 * Clean a raw hint string from the card listing into brand name(s).
 * Returns array because one hint may contain multiple names (split by 、,，).
 */
function hintToBrands(raw) {
  const cleaned = String(raw || '')
    .replace(/^精選品牌_Logo區_/i, '')
    .replace(/^採買日_宜睿商品圖-\d+-/i, '')
    .replace(/^導連到[^_]+_/i, '')
    .replace(/_官網$/i, '')
    .replace(/^會員日Banner$/i, '')
    .replace(/^[\-•●]/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];
  // Split composite hints
  return cleaned.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Mine a raw body text block for store-list entries.
 * Only called when the page has a "查看適用店家" / "查看更多" section.
 * Uses positive matching only — no blacklist required.
 */
function extractStoreListMerchants(bodyText) {
  const found = [];
  const seen = new Set();
  const lines = String(bodyText || '')
    .split(/\n|；|。/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (let line of lines) {
    // Strip common prefixes
    line = line
      .replace(/^精選品牌_Logo區_/i, '')
      .replace(/^採買日_宜睿商品圖-\d+-/i, '')
      .replace(/^導連到[^_]+_/i, '')
      .replace(/^[\-•●]/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;

    const parts = line.includes('、') ? line.split('、') : [line];
    for (const part of parts) {
      const p = part.trim();
      if (p.length < 2 || p.length > 30) continue;
      if (isDefinitelyNoise(p)) continue;
      // Positive: contains CJK or Latin brand chars and NOT a pure number/date
      if (!looksLikeBrand(p)) continue;
      if (!seen.has(p)) { seen.add(p); found.push(p); }
    }
  }
  return found;
}

function extractMerchants(title, extraNames, scanText) {
  const found = [];
  const seen = new Set();

  const add = (name) => {
    const n = String(name || '').replace(/\s+/g, ' ').trim();
    if (!n || seen.has(n)) return;
    if (!looksLikeBrand(n)) return;
    seen.add(n);
    found.push(n);
  };

  // 1. merchantsHint from the card listing (highest quality)
  for (const raw of extraNames || []) {
    for (const part of hintToBrands(raw)) add(part);
  }

  // 2. KNOWN_MERCHANTS full-text scan (catches brands mentioned in title/body)
  const blob = `${title}\n${scanText || ''}`;
  for (const brand of KNOWN_MERCHANTS) {
    if (blob.includes(brand)) add(brand === 'CITY CAFÉ' ? 'CITY CAFE' : brand);
  }

  // 3. Store-list mining — only when page actually has a "store list" section
  const hasStoreList = /查看適用店家|查看更多適用店家|適用門市|門市列表/.test(String(scanText || ''));
  if (hasStoreList) {
    for (const m of extractStoreListMerchants(scanText)) add(m);
  }

  return found;
}

// sanitizeMerchants is now a thin dedup wrapper; heavy lifting is in looksLikeBrand.
function sanitizeMerchants(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const n = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!n || seen.has(n)) continue;
    if (!looksLikeBrand(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
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

function extractRewards(title, desc, body) {
  const rewards = [];
  const blob = [title, desc, body].filter(Boolean).join('\n');
  const lines = blob
    .split(/\n|。|＋|\+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 6 && l.length <= 180);

  const seen = new Set();
  for (const line of lines) {
    if (/街口券|現折|折抵|折券|買一送一/.test(line) && !/\d+(?:\.\d+)?\s*%\s*(?:回饋|街口幣)/.test(line)) {
      const key = 'coupon:' + line.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      rewards.push({ label: '優惠', detail: line, role: 'base' });
      continue;
    }
    const m = line.match(/最高(?:享)?\s*(\d+(?:\.\d+)?)\s*%|享\s*(\d+(?:\.\d+)?)\s*%\s*(?:回饋|街口幣|折抵)/);
    if (!m) continue;
    const pctIdx = m.index || 0;
    const aroundPct = line.slice(Math.max(0, pctIdx - 8), pctIdx + m[0].length + 10);
    if (/街口券|現折|折券/.test(aroundPct)) continue;
    const pct = Number(m[1] || m[2]);
    if (!(pct > 0) || pct > 100) continue;
    const role = /信用卡|簽帳卡/.test(line) && !/帳戶/.test(line)
      ? 'card'
      : /帳戶|銀行/.test(line) && !/信用卡/.test(line)
        ? 'account'
        : 'base';

    // 嘗試提取具體銀行名稱
    const BANK_KW_JKO = ['銀行', '富邦', '國泰', '玉山', '台新', '聯邦', '兆豐', '星展',
      '新光', '遠東', '樂天', '永豐', '元大', 'LINE Bank'];
    let bankLabel = null;
    for (const kw of BANK_KW_JKO) {
      const bm = line.match(new RegExp(`([\\u4e00-\\u9fff]{0,6}${kw}[\\u4e00-\\u9fff]{0,4})`));
      if (bm) { bankLabel = bm[1]; break; }
    }

    const key = `${role}:${bankLabel || pct}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rewards.push({
      label: role === 'base' ? '街口基本回饋'
           : role === 'card' ? (bankLabel || '指定信用卡')
           : (bankLabel || '指定帳戶'),
      detail: line,
      pct,
      role,
    });
  }

  if (!rewards.length && desc) {
    const detail = String(desc).slice(0, 160);
    const pct = pctFromText(detail) ?? pctFromText(title);
    rewards.push({ label: '優惠', detail, ...(pct != null ? { pct } : {}), role: 'base' });
  }
  return rewards.slice(0, 8);
}

function collectCampaignNos(cms) {
  const nos = new Set();
  const scan = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.campaignNo === 'string' && obj.campaignNo.trim()) {
      nos.add(obj.campaignNo.trim());
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') scan(v);
    }
  };
  scan(localeValues(cms?.data));
  return [...nos];
}

function isoToYmd(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const tw = new Date(d.getTime() + 8 * 3600 * 1000);
  return ymd(tw.getUTCFullYear(), tw.getUTCMonth() + 1, tw.getUTCDate());
}

function couponStatusLabel(status) {
  if (status === 'COUPON_OUT_OF_QUOTA' || status === 'OUT_OF_QUOTA') return '已額滿';
  if (status === 'OUT_OF_STOCK') return '已領完';
  if (status === 'AVAILABLE') return '可領取';
  if (COUPON_ENDED.has(status)) return '已結束';
  if (COUPON_SOON.has(status)) return '即將開放';
  return status || '未知';
}

function isCouponFull(gift) {
  if (COUPON_FULL.has(gift.status)) return true;
  if (gift.isUnlimitedGift) return false;
  if (typeof gift.remainNumber === 'number' && gift.remainNumber <= 0) return true;
  return false;
}

function remainIsTracked(maxIssueNumber) {
  return typeof maxIssueNumber === 'number' && maxIssueNumber > 0 && maxIssueNumber < 9000000;
}

function parseGiftResult(resultObject, campaignNo) {
  const coupons = [];
  for (const set of resultObject?.giftSets || []) {
    for (const gift of set.gifts || []) {
      const tracked = remainIsTracked(gift.maxIssueNumber);
      const coupon = gift.coupon || {};
      coupons.push({
        campaignNo,
        campaignName: resultObject?.name || '',
        giftSetNo: set.giftSetNo || '',
        name: gift.name || coupon.name || campaignNo,
        status: gift.status || '',
        statusLabel: couponStatusLabel(gift.status),
        full: isCouponFull(gift),
        issueNumber: typeof gift.issueNumber === 'number' ? gift.issueNumber : null,
        remainNumber: tracked ? gift.remainNumber : null,
        maxIssueNumber: tracked ? gift.maxIssueNumber : null,
        validFrom: isoToYmd(gift.validFrom || coupon.validFrom),
        validTo: isoToYmd(gift.invalidFrom || coupon.invalidFrom),
        discountType: coupon.discountType ?? null,
        discountVal: coupon.discountVal ?? null,
      });
    }
  }
  return coupons;
}

function quotaFromCoupons(coupons) {
  if (!coupons?.length) return null;
  const live = coupons.filter((c) => !COUPON_ENDED.has(c.status) && !COUPON_SOON.has(c.status));
  const fullLive = live.filter((c) => c.full);
  if (!fullLive.length) return null;
  const allFull = live.length > 0 && fullLive.length === live.length;
  return {
    full: true,
    currentMonthFull: allFull,
    label: allFull ? '已額滿' : '部分額滿',
    note: fullLive.map((c) => `${c.name}（${c.statusLabel}）`).join('；'),
    source: 'jko_coupon',
    notices: fullLive.map((c) => ({ portion: c.name, month: null, at: null, note: c.statusLabel })),
  };
}

const giftCache = new Map();

async function fetchGiftCampaign(campaignNo) {
  if (giftCache.has(campaignNo)) return giftCache.get(campaignNo);
  const url = `${GIFT_API}?campaignNo=${encodeURIComponent(campaignNo)}`;
  let coupons = [];
  try {
    const res = await fetch(url, JSON_OPTS);
    const json = await res.json();
    if (json?.Result === '2-CP-0000') {
      coupons = parseGiftResult(json.ResultObject, campaignNo);
    }
  } catch {
    coupons = [];
  }
  giftCache.set(campaignNo, coupons);
  await sleep(120);
  return coupons;
}

async function fetchDetail(item) {
  if (!item.parsed.fetchUrl) return null;
  const { json } = await fetchRsc(item.parsed.fetchUrl);
  if (!json?.data) return null;
  const seo = json.data.page?.seo || {};
  const body = collectPageText(json.data);
  return {
    seoTitle: seo.title || '',
    seoDesc: seo.desc || '',
    seoImage: seo.image || '',
    urlPath: json.data.urlPath || item.parsed.slug,
    body,
    campaignNos: collectCampaignNos(json),
  };
}

async function main() {
  console.log('JKO Pay activity fetch\n');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('[1/2] Fetching monthly campaign hub...');
  const list = await fetchRsc(LIST_URL);
  if (!list.json?.data) {
    console.error('Could not parse RSC schema from', LIST_URL);
    process.exit(1);
  }
  const hubPath = list.json.data.urlPath || 'newevent';
  const rawItems = collectListItems(list.json);
  const listItems = mergeListItems(rawItems);
  console.log(`  hub: ${hubPath}`);
  console.log(`  cards: ${rawItems.length} -> ${listItems.length} unique\n`);

  if (listItems.length === 0) {
    console.error('No campaign cards found. Page structure may have changed.');
    process.exit(1);
  }

  console.log('[2/2] Fetching campaign pages...');
  const endedCache = loadEndedCache(OUT_PATH);
  console.log(`  ended cache: ${endedCache.size} (will skip re-fetch)\n`);

  const activities = [];
  let skippedFetch = 0;
  for (let i = 0; i < listItems.length; i++) {
    const item = listItems[i];
    const slug = item.parsed?.slug || `ext-${i}`;
    const kind = item.parsed?.kind || 'external';
    const id = `jko-${kind}-${slug}`;
    const cachedHit = useCachedIfEnded(endedCache, id);
    if (cachedHit.skip) {
      activities.push({ ...cachedHit.cached, _fromCache: true });
      skippedFetch++;
      process.stdout.write(`\r  ${i + 1}/${listItems.length}: [cached] ${item.listTitle.slice(0, 32)}   `);
      continue;
    }

    const label = item.listTitle.slice(0, 36);
    process.stdout.write(`\r  ${i + 1}/${listItems.length}: ${label}   `);

    let detail = null;
    if (item.parsed.fetchUrl) {
      try {
        detail = await fetchDetail(item);
      } catch (e) {
        process.stdout.write(` [err: ${e.message}]`);
      }
      await sleep(280);
    }

    const title = (WEEKDAY_NAME.test(item.listTitle) || item.listTitle === '每月5號'
      ? (detail?.seoTitle || item.listTitle)
      : item.listTitle).replace(/\s+/g, ' ').trim();
    const desc = item.subtitle || detail?.seoDesc || '';
    const body = detail?.body || '';
    const fromShow = parseShowTime(item.showTime);
    const fromHead = parseHeadRange(item.head);
    const fromTitle = parseTextRange(title);
    const fromDesc = parseTextRange(desc);
    const fromBody = parseBodyRange(body);
    const start = fromShow.start || fromHead.start || fromTitle.start || fromDesc.start || fromBody.start;
    const end = fromShow.end || fromHead.end || fromTitle.end || fromDesc.end || fromBody.end;
    const period = buildPeriod(start, end);

    const merchantScan = [title, desc, body, item.listTitle, ...(item.merchantsHint || [])].join('\n');
    const merchants = sanitizeMerchants(extractMerchants(title, item.merchantsHint, merchantScan));
    const rewards = extractRewards(title, desc, body);

    const coupons = [];
    for (const no of detail?.campaignNos || []) {
      const gifts = await fetchGiftCampaign(no);
      coupons.push(...gifts);
    }
    const couponQuota = quotaFromCoupons(coupons);
    const textQuota = parseQuotaFull(title, desc, body);
    const quotaFull = couponQuota || textQuota;

    const searchText = [
      title,
      desc,
      item.section,
      ...merchants,
      ...rewards.map((r) => r.detail),
      ...coupons.map((c) => `${c.name} ${c.statusLabel}`),
      body.slice(0, 4000),
    ]
      .join(' ')
      .toLowerCase();
    const url = item.parsed.url || item.parsed.fetchUrl || LIST_URL;
    const official = !item.parsed.external && (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '') === 'mkt.jkopay.com';
      } catch {
        return false;
      }
    })();

    activities.push({
      id: `jko-${kind}-${slug}`,
      platform: 'jko',
      source: official ? 'jkopay' : 'jkopay_partner',
      official,
      slug,
      url,
      title: String(title).replace(/\s+/g, ' ').trim(),
      period,
      merchants,
      rewards,
      coupons,
      scopeHints: [item.section].filter(Boolean),
      searchText,
      quotaFull,
      fetchedAt: new Date().toISOString(),
      raw: {
        subtitle: desc,
        image: detail?.seoImage || item.image || '',
        text: body.slice(0, 12000),
        listTitle: item.listTitle,
        hubPath,
      },
    });
  }
  console.log('');

  const { payload, stats } = finalizeAndSave(OUT_PATH, {
    meta: {
      source: LIST_URL,
      hubPath,
    },
    activities,
    endedCache,
    skippedFetch,
  });
  upsertPlatform('jko');
  console.log(`\nSaved ${payload.activities.length} activities -> ${OUT_PATH}`);
  logCacheSummary(stats);
  const ongoing = payload.activities.filter((a) => a.period.status === 'active');
  const ended = payload.activities.filter((a) => a.period.status === 'ended');
  const withCoupons = payload.activities.filter((a) => a.coupons?.length).length;
  const couponFull = payload.activities.filter((a) => a.quotaFull?.source === 'jko_coupon').length;
  console.log(`  ongoing: ${ongoing.length}, ended: ${ended.length}, unknown: ${payload.activities.length - ongoing.length - ended.length}`);
  console.log(`  with coupons: ${withCoupons}, coupon quota-full: ${couponFull}`);
  console.log(`  official: ${payload.activities.filter((a) => a.official).length}, partner: ${payload.activities.filter((a) => !a.official).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
