/**
 * Fetch PX Pay Plus marketing activities into data/activities.json
 * Usage:
 *   node scripts/fetch-activities.mjs
 *   node scripts/fetch-activities.mjs --refresh-derived
 *
 * Merchant names come from activity copy first
 * (「包含但不限於」「十大商圈：」), then mapped partner logos.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildPeriod } from './date-extract.mjs';
import { canonicalizeMerchants } from './brand-aliases.mjs';
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

// 從文字中提取回饋百分比
function pctFromText(text) {
  const s = String(text || '');
  if (/貸款|手續費|利率|利息|年費|服務費/.test(s)) return null;
  const patterns = [
    /最高(?:享)?\s*(\d+(?:\.\d+)?)\s*%/,
    /享\s*(\d+(?:\.\d+)?)\s*%\s*(?:回饋|全點|全盈儲值金)/,
    /(\d+(?:\.\d+)?)\s*%\s*(?:全點回饋|全盈儲值金|現金回饋|回饋)/,
    /(?:回饋|加碼)\s*(\d+(?:\.\d+)?)\s*%/,
    /(?:筆筆|每筆)\s*(\d+(?:\.\d+)?)\s*%/,
    /(\d+(?:\.\d+)?)\s*%(?!\d)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) { const v = Number(m[1]); if (v > 0 && v <= 100) return v; }
  }
  return null;
}

// 從文字提取銀行名稱
const BANK_KW = ['銀行', '信託', '富邦', '國泰', '玉山', '台新', '聯邦', '兆豐', '星展',
  '新光', '遠東', '樂天', '永豐', '元大', '合庫', '彰銀', '第一銀', 'LINE Bank', 'Richart'];
function bankNameOf(text) {
  for (const kw of BANK_KW) {
    const m = String(text || '').match(new RegExp(`([\\u4e00-\\u9fff]{0,6}${kw}[\\u4e00-\\u9fff]{0,4})`));
    if (m) return m[1];
  }
  return null;
}

// 從全支付活動內容解析 rewards（含 role/pct）
function parseActivityRewards(title, contentItems = []) {
  const rewards = [];
  const seen = new Set();
  const push = (label, detail, pct, role) => {
    if (!(pct > 0) || pct > 100) return;
    const key = `${role}:${label}:${pct}`;
    if (seen.has(key)) return;
    seen.add(key);
    rewards.push({ label, detail, pct, role });
  };

  for (const item of contentItems) {
    const label = String(item.label || item.title || '').trim();
    const detail = String(item.detail || item.content || '').trim();
    const combined = `${label} ${detail}`;
    const pct = pctFromText(combined);

    // 判斷 role
    const cardM = combined.match(/(?:綁定|持有)(.{0,20}?)(信用卡|簽帳卡)/);
    const accM = combined.match(/(?:連結|綁定)(.{0,20}?)(?:銀行)?(?:帳戶|活期)/);
    const bank = bankNameOf(combined);

    if (cardM && bank && pct) {
      push(bank, detail || label, pct, 'card');
    } else if (accM && bank && pct) {
      push(bank, detail || label, pct, 'account');
    } else if (pct) {
      // 用 label 判斷是否是「基本回饋」
      const isBase = !bank || /基本|主活動|筆筆|每筆/.test(label);
      push(label || '主活動', detail || label, pct, isBase ? 'base' : 'other');
    } else {
      // 沒有 pct 也保留，供詳情顯示
      if (label) rewards.push({ label, detail: detail || label });
    }
  }

  // fallback：從標題提取 base
  if (!rewards.some(r => r.role === 'base')) {
    const pct = pctFromText(title);
    if (pct) push('全支付基本回饋', title, pct, 'base');
  }

  return rewards.slice(0, 10);
}

const ADV_BASE = 'https://service.pxpayplus.com/px-advertise/web/activity/detail';
const MARKETING_BASE = 'https://marketing.pxpayplus.com/pxplus_marketing_page';
const S3_BASE = 'https://prod-s3.pxpayplus.com/MKT_Event';
const APP_JS_URL = `${MARKETING_BASE}/assets/app-344997b2.js`;

const PARTNER_NAMES = {
  '8': '八方雲集',
  MWD: '麥味登',
  '85': '85°C',
  MKK: '麵匡匡',
  chickenM: '炸鷄大獅',
  old: '老先覺',
  chunpinchicken: '昌平炸雞王',
  ikari: '怡客咖啡',
  '6owldoor': '六扇門',
  '3375': '三商巧福',
  tonkatsu: '福勝亭',
  DonMono: '三商鮮五丼',
  KKday: 'KKday',
  cola2: '可樂旅遊',
  AsiaYo2: 'AsiaYo',
  CathayUnitedBank: '國泰世華銀行',
  Mcdonald: "McDonald's 麥當勞",
  CP: '清心福全',
  chingshin: '清心福全',
  FOCUS: 'FOCUS 流行館',
  EZTABLE: 'EZTABLE',
  Startravel: '燦星旅遊',
  UNItravel: '環宇旅遊',
  Senao: '神腦國際',
  foodpanda: 'foodpanda',
  kebuke: '可不可熟成紅茶',
  '55688': '台灣大車隊',
  ok: 'OK超商',
  PXMart: '全聯',
  pxgo: 'PX Go',
  NEWRTMART: '大潤發',
  Dihuastreet: '迪化街',
  RaoheStreet: '饒河夜市',
  nanmen: '南門市場',
  '9x9': '九乘九文具',
  ABCmart: 'ABC-MART',
  iQIYI: '愛奇藝',
  MyCard: 'MyCard',
  ChunghwaPost: '中華郵政',
  PayPay: 'PayPay',
  ZeroPay: 'Zero Pay',
  ICB_HIVEX: 'HIVEX',
  ESUNBank: '玉山銀行',
  FubonBank: '富邦銀行',
  FubonInsurance: '富邦產險',
  HwataiBank: '華泰銀行',
  NEXTBank: '將來銀行',
  HNbank: '華南銀行',
  SCSBank_NEW: '上海商銀',
  TaishinBank_update2: '台新銀行',
  TSBank: '台新銀行',
  UnionBank: '聯邦銀行',
  MegaBank: '兆豐銀行',
  OBank: '王道銀行',
  DBSBank: '星展銀行',
  RakutenBank: '樂天銀行',
  YuantBank: '元大銀行',
  Janfusun: '劍湖山世界',
  eztravel: '易遊網',
  wacoal: '華歌爾',
  samsung: 'Samsung',
  sharp: 'SHARP',
  hyundai: 'HYUNDAI',
  EASYSHOP: 'EASY SHOP',
  '173wifi': '173WiFi',
  JetFi_Mobile: 'JetFi',
};

const PARTNER_LOOKUP = Object.fromEntries(
  Object.entries(PARTNER_NAMES).flatMap(([k, v]) => [
    [k, v],
    [k.toLowerCase(), v],
  ])
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mappedPartnerName(imagePath) {
  const fn = String(imagePath || '').split('/').pop() || '';
  const key = fn.replace(/^Partner_/i, '').replace(/\.[^.]+$/, '');
  if (!key) return '';
  return PARTNER_LOOKUP[key] || PARTNER_LOOKUP[key.toLowerCase()] || '';
}

function partnerLabel(p) {
  if (!p?.image_path) return '';
  return mappedPartnerName(p.image_path);
}

function looksLikeDistrictName(name) {
  if (!name || name.length < 2 || name.length > 12) return false;
  if (!/^[\u4e00-\u9fff0-9A-Za-z]+$/.test(name)) return false;
  if (/回饋|活動|掃描|付款|帳號|金額|清單|店家|電子支付/.test(name)) return false;
  return /(老街|夜市|商圈|廟口|町|街|市場|商城)$/.test(name);
}

function extractListedMerchants(text) {
  const plain = stripHtml(text);
  const found = [];
  const addFromChunk = (chunk) => {
    String(chunk || '')
      .split(/[、,，]/)
      .forEach((part) => {
        const name = part
          .replace(/[（(][\s\S]*$/, '')
          .replace(/[)）].*$/, '')
          .replace(/^[「『"'\s]+|[」』"'\s]+$/g, '')
          .trim();
        if (looksLikeDistrictName(name)) found.push(name);
      });
  };
  const patterns = [
    /十大商圈[：:]\s*([^。]+)/g,
    /十大商圈\s*[（(]([^）)]+)[）)]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(plain))) addFromChunk(m[1]);
  }
  return [...new Set(found)];
}

function looksLikeBrandName(name) {
  if (!name || name.length < 2 || name.length > 24) return false;
  if (/合作店家|分支機構|詳如|清單|指定店家|回饋|活動期間|掃描|付款|包含但不限|實際情形|規範為準|不適用|上線|下線/.test(name)) return false;
  if (/^[\d.$%]+$/.test(name)) return false;
  if (/費$/.test(name) && name.length <= 6) return false;
  if (/(稅|罰緩)$/.test(name)) return false;
  if (/[：:]/.test(name)) return false;
  if (/[\u4e00-\u9fff]/.test(name)) return true;
  if (/^(BANCO|85°C|KKday|iGO|iVideo|MyCard|My card|OK Mart|UWASH|FUJI|EASY SHOP|JetFi|PayPay|foodpanda)$/i.test(name)) return true;
  if (/^[A-Za-z][A-Za-z0-9 .&+]{1,19}$/.test(name) && /[A-Z]/.test(name)) return true;
  return false;
}

function normalizeBrandName(name) {
  if (/^85\s*(度C|°C)$/i.test(name)) return '85°C';
  if (/^my\s*card$/i.test(name)) return 'MyCard';
  if (/^ok\s*mart$/i.test(name)) return 'OK超商';
  if (/^jetfi\s*mobile$/i.test(name)) return 'JetFi';
  if (/^55688$/.test(name)) return '台灣大車隊';
  return name;
}

function expandGroupParens(chunk) {
  return String(chunk || '').replace(/([^、，]{0,24})[（(]([^）)]+)[）)]/g, (full, before, inner) => {
    if (/上線|下線|\d+\s*\/\s*\d+/.test(inner)) {
      if (/[、，]/.test(inner) && /[\u4e00-\u9fff]/.test(inner)) {
        return inner.replace(/\d+\s*\/\s*\d+\s*(上線|下線)/g, '').replace(/上線|下線/g, '').trim();
      }
      return String(before || '').trim();
    }
    if (/[、，/／]/.test(inner) && /[\u4e00-\u9fffA-Za-z]/.test(inner)) {
      return inner.replace(/[\/／]/g, '、');
    }
    return String(before || '').trim();
  });
}

function extractInclusiveBrandList(text) {
  const plain = stripHtml(text);
  const found = [];
  const re = /包含但不限於[：:]?\s*/g;
  let m;
  while ((m = re.exec(plain))) {
    let rest = plain.slice(m.index + m[0].length);
    rest = rest.split(/合作店家|實際情形|部分合作夥伴|適用場域|本活動回饋|本活動為|本活動限/)[0];
    if (/^(家庭繳費|行車上路)/.test(rest.trim())) continue;
    expandGroupParens(rest)
      .split(/[、,，]/)
      .forEach((part) => {
        const name = normalizeBrandName(
          part
            .replace(/[（(][\s\S]*$/, '')
            .replace(/[)）].*$/, '')
            .replace(/^[〈《【\s]+|[〉》】]+$/g, '')
            .replace(/\s+\d+$/g, '')
            .replace(/[。．.\s]+$/g, '')
            .trim()
        );
        if (looksLikeBrandName(name)) found.push(name);
      });
  }
  return [...new Set(found)];
}

function merchantsFromAdvertiseRaw(d) {
  const info = d?.info_content || {};
  const blob = [
    d?.title,
    stripHtml(info.content_title),
    stripHtml(info.remind),
    stripHtml(d?.notice),
    ...(info.content_items || []).flatMap((i) => [stripHtml(i.title), stripHtml(i.content)]),
    ...(info.content_block || []).flatMap((b) => [stripHtml(b.title), stripHtml(b.content)]),
  ].join('\n');
  const fromCopy = [...extractListedMerchants(blob), ...extractInclusiveBrandList(blob)];
  const fromLogos = (info.partner || []).map(partnerLabel).filter(Boolean);
  return canonicalizeMerchants([...fromCopy, ...fromLogos]);
}

function extractScopeHints(text) {
  const plain = stripHtml(text);
  const hints = [];
  const patterns = [
    /全聯[^。，；]{0,50}/g,
    /大全聯[^。，；]{0,50}/g,
    /指定通路[^。，；]{0,60}/g,
    /指定場域[^。，；]{0,60}/g,
    /指定銀行[^。，；]{0,50}/g,
    /不適用[^。]{0,100}/g,
    /實體門市[^。，；]{0,50}/g,
    /線上[^。，；]{0,40}/g,
    /跨境[^。，；]{0,40}/g,
  ];
  for (const re of patterns) {
    const m = plain.match(re);
    if (m) hints.push(...m.map((s) => s.trim()));
  }
  return [...new Set(hints)].slice(0, 8);
}

function parsePeriod(start, end, extras = {}) {
  return buildPeriod(start, end, extras.textSources || [], extras.raw, extras.opts || {});
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Referer: MARKETING_BASE,
      ...opts.headers,
    },
    signal: AbortSignal.timeout(opts.timeout ?? 15000),
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fetchAdvertiseActivities(endedCache) {
  const items = [];
  let skippedFetch = 0;
  let missStreak = 0;
  const MAX_ID = 200;
  const MAX_MISS = 5;

  for (let id = 1; id <= MAX_ID && missStreak < MAX_MISS; id++) {
    const actId = `adv-${id}`;
    const cachedHit = useCachedIfEnded(endedCache, actId);
    if (cachedHit.skip) {
      items.push({ ...cachedHit.cached, _fromCache: true });
      skippedFetch++;
      process.stdout.write(`\r  activity_content_page: ${items.length} (id=${id} cached)   `);
      continue;
    }

    const raw = await fetchJson(`${ADV_BASE}/${id}`);
    if (!raw || raw.code !== '0000' || !raw.data) {
      missStreak++;
      await sleep(80);
      continue;
    }
    missStreak = 0;
    const d = raw.data;
    const info = d.info_content || {};
    const merchants = merchantsFromAdvertiseRaw(d);
    const rewardBlocks = (info.content_block || []).map((b) => ({
      label: stripHtml(b.title),
      detail: stripHtml(b.content),
    }));
    const rewardItems = (info.content_items || []).map((i) => ({
      label: stripHtml(i.title),
      detail: stripHtml(i.content).slice(0, 800),
    }));
    const period = parsePeriod(d.activity_start_time, d.activity_end_time, {
      textSources: [
        d.title,
        stripHtml(info.content_title),
        stripHtml(d.notice),
        ...rewardItems.map((r) => `${r.label} ${r.detail}`),
      ],
      raw: d,
      opts: { bannerUrl: d.banner_list?.[0]?.url },
    });
    const scopeText = [
      stripHtml(info.content_title),
      stripHtml(d.notice),
      stripHtml(info.remind),
      ...rewardItems.map((r) => r.detail),
    ].join(' ');
    const searchText = [
      d.title,
      ...merchants,
      ...rewardBlocks.map((r) => `${r.label} ${r.detail}`),
      ...rewardItems.map((r) => `${r.label} ${r.detail}`),
      scopeText,
    ]
      .join(' ')
      .toLowerCase();

    items.push({
      id: `adv-${id}`,
      source: 'activity_content_page',
      eventId: id,
      url: `${MARKETING_BASE}/activity_content_page?EventId=${id}`,
      title: stripHtml(d.title),
      period,
      merchants,
      partnerLinks: (info.partner || [])
        .filter((p) => p.link)
        .map((p) => ({ name: partnerLabel(p) || mappedPartnerName(p.image_path), link: p.link })),
      rewards: [...rewardBlocks, ...rewardItems],
      scopeHints: extractScopeHints(scopeText),
      tags: [],
      searchText,
      fetchedAt: new Date().toISOString(),
      raw: d,
    });

    process.stdout.write(`\r  activity_content_page: ${items.length} (id=${id})   `);
    await sleep(60);
  }
  console.log('');
  return { items, skippedFetch };
}

function parseFixedRoutesFromBundle(js) {
  const routes = [];
  const re = /\{path:"(\/[^"]+)",name:"([^"]*)"[^}]*?meta:\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(js))) {
    if (m[1].includes('pathMatch') || m[1].includes('*')) continue;
    const slug = m[1].slice(1);
    const meta = m[3];
    const ogDesc = meta.match(/ogDescription:"([^"]*)"/)?.[1] || '';
    const title = meta.match(/title:"([^"]*)"/)?.[1] || '';
    routes.push({
      slug,
      name: m[2],
      title: title !== '\u5168\u652f\u4ed8\u6d3b\u52d5\u9801' ? title : ogDesc || slug,
      ogDescription: ogDesc,
      url: `${MARKETING_BASE}/${slug}`,
    });
  }
  return routes;
}

async function enrichFixedRoute(route) {
  const json = await fetchJson(`${S3_BASE}/${route.slug}.json`);
  const enriched = { ...route, jsonAccessible: !!json };
  if (!json) return enriched;

  const text = JSON.stringify(json);
  const merchants = [];
  const partnerLogos = text.match(/Partner_Logo\/[^"\\]+/g) || [];
  for (const p of partnerLogos) {
    const name = mappedPartnerName(p);
    if (name) merchants.push(name);
  }

  const rawItems = (json.content?.contentItem || []).map(item => ({
    title: stripHtml(item.title),
    content: stripHtml(item.content?.[0]).slice(0, 400),
  }));
  // 轉換為 {label, detail} 格式供 parseActivityRewards 使用
  const rewardInput = rawItems.map(i => ({ label: i.title, detail: i.content }));
  const rewards = parseActivityRewards(route.title || '', rewardInput);

  return {
    ...enriched,
    updateDate: json.update_date || '',
    merchants: canonicalizeMerchants(merchants),
    rewards,
    scopeHints: extractScopeHints(text),
    raw: json,
  };
}

async function fetchFixedRoutes(endedCache) {
  console.log('  fetching app bundle for fixed routes...');
  const res = await fetch(APP_JS_URL, { signal: AbortSignal.timeout(20000) });
  const js = await res.text();
  const routes = parseFixedRoutesFromBundle(js).filter(
    (r) => !['event', 'overview_event', 'activity_content_page', 'event_1111', 'event_1212'].includes(r.slug)
  );

  const items = [];
  let skippedFetch = 0;
  for (const route of routes) {
    const actId = `fixed-${route.slug}`;
    const cachedHit = useCachedIfEnded(endedCache, actId);
    if (cachedHit.skip) {
      items.push({ ...cachedHit.cached, _fromCache: true });
      skippedFetch++;
      process.stdout.write(`\r  fixed routes: ${items.length}/${routes.length} (${route.slug} cached)   `);
      continue;
    }

    const enriched = await enrichFixedRoute(route);
    const searchText = [
      enriched.title,
      enriched.ogDescription,
      enriched.slug,
      ...(enriched.merchants || []),
      ...(enriched.rewards || []).map((r) => `${r.label} ${r.detail}`),
      ...(enriched.scopeHints || []),
    ]
      .join(' ')
      .toLowerCase();

    items.push({
      id: `fixed-${route.slug}`,
      source: 'fixed_route',
      slug: route.slug,
      url: route.url,
      title: enriched.ogDescription || enriched.title || route.slug,
      period: parsePeriod('', '', {
        textSources: [
          enriched.ogDescription,
          enriched.title,
          enriched.updateDate ? `update ${enriched.updateDate}` : '',
          ...(enriched.rewards || []).map((r) => `${r.label} ${r.detail}`),
          enriched.raw ? JSON.stringify(enriched.raw) : '',
        ],
        raw: enriched.raw,
        opts: {
          slug: route.slug,
          bannerUrl: enriched.raw?.kv?.imageUrl || enriched.raw?.kv?.image || enriched.raw?.kv?.static,
        },
      }),
      merchants: enriched.merchants || [],
      partnerLinks: [],
      rewards: enriched.rewards || [],
      scopeHints: enriched.scopeHints || [],
      jsonAccessible: enriched.jsonAccessible,
      searchText,
      fetchedAt: new Date().toISOString(),
      raw: enriched.raw || null,
    });
    process.stdout.write(`\r  fixed routes: ${items.length}/${routes.length} (${route.slug})   `);
    await sleep(100);
  }
  console.log('');
  return { items, skippedFetch };
}

function refreshDerivedFromExisting() {
  const outPath = path.join(DATA_DIR, 'activities.json');
  const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  let updated = 0;
  for (const act of payload.activities || []) {
    const merchants =
      act.source === 'activity_content_page' && act.raw
        ? merchantsFromAdvertiseRaw(act.raw)
        : canonicalizeMerchants(act.merchants || []);
    const before = (act.merchants || []).join('|');
    const after = merchants.join('|');
    if (before === after) continue;
    act.merchants = merchants;
    const extra = merchants.join(' ').toLowerCase();
    if (extra && !String(act.searchText || '').includes(extra)) {
      act.searchText = `${act.searchText || ''} ${extra}`.trim();
    }
    updated++;
  }
  payload.meta = payload.meta || {};
  payload.meta.merchantsRefreshedAt = new Date().toISOString();
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Refreshed merchants on ${updated} activities -> ${outPath}`);
}

async function main() {
  if (process.argv.includes('--refresh-derived')) {
    refreshDerivedFromExisting();
    return;
  }

  console.log('PX Pay Plus activity fetch\n');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const outPath = path.join(DATA_DIR, 'activities.json');
  const endedCache = loadEndedCache(outPath);
  console.log(`  ended cache: ${endedCache.size} (will skip re-fetch)\n`);

  console.log('[1/2] activity_content_page (px-advertise API)...');
  const advertiseResult = await fetchAdvertiseActivities(endedCache);

  console.log('[2/2] fixed route pages...');
  const fixedResult = await fetchFixedRoutes(endedCache);

  const activities = [...advertiseResult.items, ...fixedResult.items];
  const skippedFetch = advertiseResult.skippedFetch + fixedResult.skippedFetch;

  const { payload, stats } = finalizeAndSave(outPath, {
    meta: {
      counts: {
        activity_content_page: advertiseResult.items.length,
        fixed_route: fixedResult.items.length,
        total: activities.length,
      },
      sources: {
        advertiseApi: ADV_BASE,
        marketingBase: MARKETING_BASE,
      },
    },
    activities,
    endedCache,
    skippedFetch,
  });
  upsertPlatform('pxplus');
  console.log(`\nSaved ${payload.activities.length} activities -> ${outPath}`);
  logCacheSummary(stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
