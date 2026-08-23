/**
 * Pure crawler parsers — no network I/O. Used by run.mjs and crawler-parse.test.mjs.
 */

export function normalizeText(v) {
  return String(v || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseIntSafe(v) {
  const n = Number.parseInt(String(v || '').replace(/,/g, '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function decodeHtmlLike(s) {
  return String(s || '')
    .replace(/\\u003C/g, '<')
    .replace(/\\u003E/g, '>')
    .replace(/\\u0022/g, '"')
    .replace(/\\u0027/g, "'")
    .replace(/\\r\\n/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function walk(root, fn) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    fn(cur);
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
    } else {
      for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
    }
  }
}

function dedupeBy(arr, getKey) {
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function getTodayLocalDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function normalizePlainText(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractSchemeName(mainTitle) {
  const decoded = decodeHtmlLike(mainTitle);
  const m = decoded.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  return normalizePlainText((m?.[1] || '').replace(/<[^>]+>/g, ''));
}

function extractPeriodFromMainTitle(mainTitle) {
  const decoded = decodeHtmlLike(mainTitle);
  const m = decoded.match(
    /適用期間\s*[:：]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/i,
  );
  if (!m) return null;
  return {
    start: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
    end: new Date(Number(m[4]), Number(m[5]) - 1, Number(m[6])),
    periodStr: m[0],
  };
}

/** Plan-level % from mainTitle when exactly one designated rate exists (e.g. 全支付 2%). */
export function extractPlanDefaultPercent(mainTitle) {
  const decoded = decodeHtmlLike(mainTitle);
  const plain = decoded.replace(/<[^>]+>/g, ' ');
  const rates = [...plain.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    .map((m) => `${m[1]}%`)
    .filter((p) => Math.abs(parseFloat(p) - 0.3) > 0.001);
  const unique = [...new Set(rates)];
  if (unique.length === 1) return unique[0];
  return '';
}

function isPeriodLine(text) {
  if (typeof text !== 'string') return false;
  if (/^適用期間\s*[:：]/.test(text)) return true;
  if (/^活動期間\s*[:：]/.test(text)) return true;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}\s*~\s*\d{4}\/\d{1,2}\/\d{1,2}$/.test(text)) return true;
  return false;
}

function parsePeriodFromText(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(
    /^(適用期間|活動期間)\s*[:：]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(?:~|-|–|—)\s*(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/,
  );
  if (!m) return null;
  const startYear = Number(m[2]);
  const startMonth = Number(m[3]);
  const startDay = Number(m[4]);
  const endYear = m[5] ? Number(m[5]) : startYear;
  const endMonth = Number(m[6]);
  const endDay = Number(m[7]);
  return {
    start: new Date(startYear, startMonth - 1, startDay),
    end: new Date(endYear, endMonth - 1, endDay),
  };
}

function isCampaignPeriodStr(periodStr) {
  return /^活動期間\s*[:：]/.test(String(periodStr || '').trim());
}

function isNoiseItemText(text) {
  if (typeof text !== 'string') return false;
  if (/活動詳情/.test(text)) return true;
  if (/前往活動網頁/.test(text)) return true;
  if (/優惠券.*小樹點/.test(text)) return true;
  if (/可獲.*小樹點\s*\(信用卡\)/.test(text)) return true;
  if (/>>/.test(text)) return true;
  if (/https?:\/\//i.test(text)) return true;
  if (/^[．•\-*※]/.test(text)) return true;
  if (/^「[^」]{2,30}」$/.test(text)) return true;
  if (text.length >= 18 && /[，。；：,]/.test(text)) return true;
  if (/^\d+(?:\.\d+)?%$/.test(text)) return true;
  return false;
}

function extractCubeItems(node, today) {
  const items = [];
  const planDefault = extractPlanDefaultPercent(node?.mainTitle);
  const children = node[':items'];
  if (!children || typeof children !== 'object') return items;
  const order = Array.isArray(node[':itemsOrder']) ? node[':itemsOrder'] : Object.keys(children);
  for (const key of order) {
    const block = children[key];
    const percent = (String(block?.categoryName || '').match(/(\d+(?:\.\d+)?)%/) || [])[0] || '';
    const trees = block?.contentTrees;
    if (!Array.isArray(trees)) continue;
    let activePeriod = null;
    let activePeriodStr = '';
    let currentPercent = percent || planDefault;
    for (const tree of trees) {
      const inner = tree?.contentTrees;
      if (!inner || typeof inner !== 'object') continue;
      const itemKeys = Object.keys(inner)
        .filter((k) => /^item\d+$/.test(k))
        .sort((a, b) => Number.parseInt(a.slice(4), 10) - Number.parseInt(b.slice(4), 10));
      for (const ik of itemKeys) {
        const rawText = inner[ik]?.itemText;
        if (typeof rawText !== 'string') continue;
        const text = normalizePlainText(rawText);
        if (!text) continue;

        const period = parsePeriodFromText(text);
        if (period) {
          activePeriod = period;
          activePeriodStr = text;
          continue;
        }
        if (isPeriodLine(text)) continue;
        if (/^\d+(?:\.\d+)?%$/.test(text)) {
          currentPercent = text;
          continue;
        }
        if (isNoiseItemText(text)) continue;
        if (isCampaignPeriodStr(activePeriodStr)) continue;
        if (activePeriod && today instanceof Date) {
          if (today.getTime() > activePeriod.end.getTime()) continue;
        }
        items.push({ text, percent: currentPercent || '', period: activePeriodStr || '' });
      }
    }
  }
  const uniq = [];
  const seen = new Set();
  for (const x of items) {
    const key = `${x.text}||${x.percent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(x);
  }
  return uniq;
}

function selectActiveBlockByScheme(blocks, today) {
  const result = {};
  for (const b of blocks) {
    if (today instanceof Date && today.getTime() > b.periodEnd.getTime()) continue;
    if (!result[b.schemeName]) result[b.schemeName] = b;
  }
  return result;
}

export function parseCubeModel(model, today = getTodayLocalDate()) {
  const blocks = [];
  walk(model, (node) => {
    if (!node || typeof node !== 'object') return;
    if (!String(node[':type'] || '').includes('cub-cubelisttitle')) return;
    if (!node.anchorKey || !node.mainTitle) return;
    const schemeName = extractSchemeName(node.mainTitle);
    const period = extractPeriodFromMainTitle(node.mainTitle);
    if (!schemeName || !period) return;
    blocks.push({
      schemeName,
      anchorKey: node.anchorKey,
      periodEnd: period.end,
      periodStr: period.periodStr,
      items: extractCubeItems(node, today),
    });
  });

  const map = { 玩數位: 'digital', 樂饗購: 'fun', 趣旅行: 'travel', 集精選: 'select' };
  const out = { schemeNames: {} };
  const selected = selectActiveBlockByScheme(blocks, today);

  for (const [schemeName, block] of Object.entries(selected)) {
    let key = null;
    for (const [name, id] of Object.entries(map)) {
      if (schemeName.includes(name)) key = id;
    }
    if (!key && block.anchorKey) key = block.anchorKey;
    if (!key) continue;
    out[key] = block.items
      .map((x) => [x.text, x.percent || '', x.period || block.periodStr || ''])
      .filter((x) => x[0]);
    out.schemeNames[key] = schemeName;
  }

  const planArrays = Object.entries(out).filter(([k, v]) => k !== 'schemeNames' && Array.isArray(v));
  if (!planArrays.some(([, v]) => v.length > 0)) {
    throw new Error('cube parse failed: empty data');
  }
  return out;
}


const RICHART_STANDARD_SCHEME_NAMES = {
  chill: 'Chill刷',
  pay: 'Pay著刷',
  day: '天天刷',
  big: '大筆刷',
  eat: '好饗刷',
  digital: '數趣刷',
  travel: '玩旅刷',
  holiday: '假日刷',
  linepay: 'LINE Pay',
};

function slugifyRichartPlanKey(planName, usedKeys) {
  const name = String(planName || '').trim();
  const latinParts = name.match(/[A-Za-z][A-Za-z0-9]*/g) || [];
  let base = latinParts.join('').toLowerCase();
  if (!base) {
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    base = 'plan_' + ((h >>> 0).toString(36));
  }
  let key = base;
  let n = 2;
  while (usedKeys.has(key)) key = base + '_' + (n++);
  usedKeys.add(key);
  return key;
}

function resolveRichartPlanKey(planName, planMap, usedKeys, schemeNames) {
  const name = String(planName || '').trim();
  if (!name) return null;
  if (planMap[name]) {
    const key = planMap[name];
    usedKeys.add(key);
    if (schemeNames && !schemeNames[key]) schemeNames[key] = name;
    return key;
  }
  const key = slugifyRichartPlanKey(name, usedKeys);
  if (schemeNames) schemeNames[key] = name;
  return key;
}

function normalizeRichartItem(text) {
  let v = String(text || '')
    .replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!v || v.length < 2) return '';
  if (
    /^(超商量販|通勤交通|加油充電|藥妝藥局|指定百貨|指定Outlet|居家裝修|時尚品味|全臺餐飲|外送平台|購票娛樂|指定KTV|指定飯店|網購平台|線上課程|遊戲影音|AI服務|航空公司|海外交通\/網路|訂房平台|旅行社)$/.test(
      v,
    )
  )
    return '';
  if (/等[，,]\s*詳見?|^詳見|詳見$|交易再享免|1\.5%國外交易手續費|節假日|不限通路|消費享|含LINE\s*Pay綁定|含LINE\s*Pay及全盈\+?Pay綁定/.test(v))
    return '';
  if (v.includes('。')) v = v.split('。')[0].trim();
  if (!v) return '';
  return v;
}

function parseRichartPlanTagTitle(section) {
  const raw = (section.match(/<div[^>]*class="[^"]*plan-tag[^"]*"[^>]*>([^<]+)/i) || [])[1];
  return String(raw || '').trim();
}

function collectRichartMerchants(raw, splitRe, seen, items, rate) {
  for (const part of raw.split(splitRe)) {
    const v = normalizeRichartItem(part);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    items.push(rate ? [v, rate] : [v]);
  }
}

function splitRichartMerchantsOutsideParen(text) {
  const out = [];
  let buf = '';
  let depth = 0;
  const src = String(text || '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(' || ch === '（') depth += 1;
    if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
    const isSepChar = /[、,，/／;；｜|]/.test(ch);
    const isAndSep = ch === '及';
    if (depth === 0 && (isSepChar || isAndSep)) {
      if (buf) out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function normalizeRichartSoftWraps(text) {
  // Richart HTML sometimes hard-wraps English names in source (e.g. "SKM\nPark Outlets")
  // without <br>; merge those wraps before line splitting.
  return String(text || '').replace(/([A-Za-z0-9])\s*\n\s*([A-Za-z0-9])/g, '$1 $2');
}

function parseRichartClassicMerchantLine(line) {
  let s = String(line || '').replace(/^[*\-]\s*/, '').trim();
  if (!s) return [];
  s = s.replace(/詳見[\s\S]*$/i, '');
  s = s.replace(/等[，,。；;]?[\s\S]*$/i, '');
  s = s.replace(/綁定支付享[\s\S]*$/i, '');
  s = s.replace(/綁定消費[\s\S]*$/i, '');
  s = s.replace(/享加碼[\s\S]*$/i, '');
  s = s.replace(/[（(]\s*含LINE\s*Pay及全盈\+?Pay綁定\s*[)）]/gi, '');
  s = s.replace(/日韓交易再享免[^，,]*[，,]\s*含/i, '');
  if (!s) return [];
  if (s.includes('｜')) {
    const [left, right] = s.split('｜');
    if (/台新Pay|台灣Pay|TWQR/i.test(left || '')) s = String(right || '').trim();
    else s = s.replace(/｜/g, '、');
  }
  s = s.replace(/^台新Pay\+?[：:]?/i, '').trim();
  if (!s) return [];

  const parts = splitRichartMerchantsOutsideParen(s)
    .map((p) => normalizeRichartItem(p))
    .filter(Boolean)
    .filter((p) => !/^(台新Pay|台新Pay\+|TWQR|台灣Pay)$/.test(p));
  return parts;
}

function parseRichartClassicSection(sectionHtml, planMap, out, usedKeys = new Set()) {
  const starts = [];
  const re = /<div[^>]*class="[^"]*plan-item[^"]*"[^>]*>/gi;
  let m;
  while ((m = re.exec(sectionHtml)) !== null) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const section = sectionHtml.slice(starts[i], i < starts.length - 1 ? starts[i + 1] : sectionHtml.length);
    const key = resolveRichartPlanKey(
      parseRichartPlanTagTitle(section),
      planMap,
      usedKeys,
      out.schemeNames || (out.schemeNames = {}),
    );
    if (!key) continue;
    const items = out[key] || (out[key] = []);
    const seen = new Set(items.map((entry) => String(entry[0] || '').trim()));
    const cols = section.match(/<div[^>]*class="[^"]*\bitem-col-text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi) || [];
    for (const col of cols) {
      const lines = normalizeRichartSoftWraps(normalizeText(col))
        .replace(/\(兩大超商限台新Pay\)/g, '')
        .split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean);
      for (const line of lines) {
        for (const merchant of parseRichartClassicMerchantLine(line)) {
          if (seen.has(merchant)) continue;
          seen.add(merchant);
          items.push([merchant]);
        }
      }
    }
  }
}

function appendRichartPayBindingsFromOverview(html, out) {
  const payItems = out.pay || (out.pay = []);
  const seen = new Set(payItems.map((entry) => String(entry[0] || '').trim()));
  const text = normalizeText(html);
  if (/LINE\s*Pay\s*及\s*全盈\+?Pay/.test(text)) {
    for (const name of ['LINE Pay', '全盈+Pay']) {
      if (seen.has(name)) continue;
      seen.add(name);
      payItems.push([name]);
    }
  }
}

function parseRichartChillSection(sectionHtml, out, planKey = 'chill') {
  const items = out[planKey] || (out[planKey] = []);
  const seen = new Set(items.map((entry) => String(entry[0] || '').trim()));
  const fullBlocks =
    sectionHtml.match(/<div[^>]*class="[^"]*item-col-full[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  for (const block of fullBlocks) {
    const rateMatch = block.match(/<span>(\d+(?:\.\d+)?)<\/span>\s*<small>%<\/small>/i);
    const rate = rateMatch ? `${rateMatch[1]}%` : null;
    const textCol = block.match(/<div[^>]*class="[^"]*item-col-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!textCol) continue;
    const raw = normalizeText(textCol[0]);
    for (const part of splitRichartMerchantsOutsideParen(raw)) {
      const v = normalizeRichartItem(part);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      items.push(rate ? [v, rate] : [v]);
    }
  }
}


function parseRichartExtraPromoSections(html, out, usedKeys) {
  const starts = [];
  const re = /<div[^>]*class="([^"]*\bseven-plan\b[^"]*)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    starts.push({ index: m.index, className: String(m[1] || '') });
  }
  for (let i = 0; i < starts.length; i++) {
    const { index, className } = starts[i];
    const end = i < starts.length - 1 ? starts[i + 1].index : html.length;
    const block = html.slice(index, end);
    if (/\bchill-plan\b/i.test(className)) continue;
    if (/id=["']tab-b["']/i.test(block)) continue;
    if (!/<span>\d+(?:\.\d+)?<\/span>\s*<small>%<\/small>/i.test(block)) continue;

    const before = html.slice(Math.max(0, index - 800), index);
    const titleMatch =
      before.match(/<div[^>]*class="[^"]*(?:chill-title|plan-title|section-title|promo-title)[^"]*"[^>]*>([^<]+)/i) ||
      block.match(/<div[^>]*class="[^"]*(?:chill-title|plan-title|section-title|promo-title)[^"]*"[^>]*>([^<]+)/i);
    let planName = titleMatch ? String(titleMatch[1] || '').trim() : '';
    const classKey = (className.match(/\b([a-z][a-z0-9]*)-plan\b/i) || [])[1];
    if (!planName && classKey && classKey !== 'seven') {
      planName = classKey.charAt(0).toUpperCase() + classKey.slice(1) + '刷';
    }
    if (!planName) continue;

    const key = resolveRichartPlanKey(planName, {}, usedKeys, out.schemeNames || (out.schemeNames = {}));
    if (!key || key === 'chill') continue;
    parseRichartChillSection(block, out, key);
  }
}

export function parseRichartHtml(html) {
  const planMap = {
    Pay著刷: 'pay',
    天天刷: 'day',
    大筆刷: 'big',
    好饗刷: 'eat',
    數趣刷: 'digital',
    玩旅刷: 'travel',
    假日刷: 'holiday',
  };
  const schemeNames = { ...RICHART_STANDARD_SCHEME_NAMES };
  const out = {
    chill: [],
    pay: [],
    day: [],
    big: [],
    eat: [],
    digital: [],
    travel: [],
    holiday: [],
    schemeNames,
  };
  const usedKeys = new Set(['chill', ...Object.values(planMap)]);

  const chillMatch = html.match(
    /<div[^>]*class="[^"]*seven-plan[^"]*chill-plan[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="search-area"/i,
  );
  if (chillMatch) parseRichartChillSection(chillMatch[1], out, 'chill');

  parseRichartExtraPromoSections(html, out, usedKeys);

  const tabMatch = html.match(
    /<div[^>]*class="[^"]*tab-table[^"]*"[^>]*id="tab-b"[^>]*>([\s\S]*?)(?=<div[^>]*class="card-row"|<\/section>)/i,
  );
  if (!tabMatch) throw new Error('richart parse failed: tab-b not found');
  parseRichartClassicSection(tabMatch[0], planMap, out, usedKeys);
  appendRichartPayBindingsFromOverview(html, out);

  const total = Object.entries(out)
    .filter(([k, v]) => k !== 'schemeNames' && Array.isArray(v))
    .reduce((n, [, arr]) => n + arr.length, 0);
  if (!total) throw new Error('richart parse failed: empty');
  return out;
}

export function mergeRichartWithLegacy(parsed, legacy = {}) {
  const out = { ...parsed };
  const mergedNames = {
    ...RICHART_STANDARD_SCHEME_NAMES,
    ...(legacy.schemeNames || {}),
    ...(parsed.schemeNames || {}),
  };
  const pruned = { ...RICHART_STANDARD_SCHEME_NAMES };
  for (const [key, label] of Object.entries(mergedNames)) {
    if (key === 'linepay' || Array.isArray(out[key])) pruned[key] = label;
  }
  out.schemeNames = pruned;
  return out;
}

function splitOutsideParen(text, delimiter) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (const ch of String(text || '')) {
    if (ch === '(' || ch === '（') depth += 1;
    if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function makeLocalDate(year, month, day) {
  return new Date(Number(year), Number(month) - 1, Number(day));
}

const UNICARD_RANGE_RE =
  /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*適用百大指定消費列表如下/g;

export function extractUnicardSections(html) {
  const matches = [...String(html || '').matchAll(UNICARD_RANGE_RE)];
  const sections = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const sliceStart = m.index + m[0].length;
    const sliceEnd = i + 1 < matches.length ? matches[i + 1].index : sliceStart + 120000;
    const slice = html.slice(sliceStart, sliceEnd);
    const tables = slice.match(/<table[\s\S]*?<\/table>/gi) || [];
    const table = tables.find((t) => /指定百大指定消費/i.test(t));
    if (!table) continue;
    sections.push({
      start: makeLocalDate(m[1], m[2], m[3]),
      end: makeLocalDate(m[4], m[5], m[6]),
      label: m[0],
      table,
    });
  }
  return sections;
}

export function selectActiveUnicardSection(html, today = getTodayLocalDate()) {
  const sections = extractUnicardSections(html);
  return sections.find((section) => isTodayWithinRange(section.start, section.end, today)) || null;
}

export function parseUnicardDateRange(html, today = getTodayLocalDate()) {
  const section = selectActiveUnicardSection(html, today);
  if (!section) throw new Error('unicard parse failed: no applicable date range');
  return { start: section.start, end: section.end, label: section.label };
}

export function isTodayWithinRange(start, end, today = getTodayLocalDate()) {
  const t = today.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function parseUnicardTable(tableHtml) {
  const tbody = (String(tableHtml).match(/<tbody[\s\S]*?<\/tbody>/i) || [])[0] || '';
  const rows = tbody.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const tds = row.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (tds.length < 2) continue;
    const category = normalizeText(tds[0]);
    const listText = normalizeText(tds[1]).split('※')[0].trim();
    if (!category || !listText) continue;
    for (const part of splitOutsideParen(listText, '、')) {
      const val = normalizeText(part);
      if (!val) continue;
      const line = `${category}：${val}`;
      if (seen.has(line)) continue;
      seen.add(line);
      items.push([line]);
    }
  }
  return items;
}

export function parseUnicardHtml(html, today = getTodayLocalDate()) {
  const section = selectActiveUnicardSection(html, today);
  if (!section) {
    const err = new Error('unicard: today outside applicable date range');
    err.code = 'UNICARD_OUT_OF_RANGE';
    throw err;
  }
  const items = parseUnicardTable(section.table);
  if (!items.length) throw new Error('unicard parse failed: empty');
  return items;
}

function extractMaxPercent(text) {
  const matches = String(text || '').match(/(\d+(?:\.\d+)?)\s*%/g) || [];
  let max = null;
  for (const m of matches) {
    const v = Number.parseFloat(m.replace('%', '').trim());
    if (!Number.isFinite(v)) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

function extractLimitText(text) {
  const m = String(text || '').match(/(?:最高(?:回饋)?|上限)\s*(\d+(?:,\d+)?)\s*(?:點|元)/);
  return m ? m[0] : null;
}

function extractLimitPeriod(text) {
  const s = String(text || '');
  if (/每季/.test(s)) return '每季';
  if (/每(?:人|戶)?每月/.test(s)) return '每月';
  if (/每週/.test(s)) return '每週';
  if (/每日/.test(s)) return '每日';
  if (/每筆|單筆/.test(s)) return '每筆';
  if (/活動期間/.test(s)) return '活動期間';
  return null;
}

function parseCtbcPeriodDateParts(str) {
  const m = String(str || '').trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return { y, mo, d, time: new Date(y, mo - 1, d, 0, 0, 0, 0).getTime() };
}

/** Fix CTBC official typos where end year < start year (e.g. 2026/1/1~2025/6/30). */
export function normalizeCtbcOfferPeriod(periodStr) {
  const s = String(periodStr || '').trim();
  if (!s) return s;
  const matches = s.match(/\d{4}\/\d{1,2}\/\d{1,2}/g) || [];
  if (matches.length < 2) return s;

  const start = parseCtbcPeriodDateParts(matches[0]);
  const endRaw = matches[matches.length - 1];
  const end = parseCtbcPeriodDateParts(endRaw);
  if (!start || !end || end.time >= start.time) return s;

  const fixedEnd = `${start.y}/${end.mo}/${end.d}`;
  const fixed = parseCtbcPeriodDateParts(fixedEnd);
  if (fixed && fixed.time >= start.time) {
    return s.replace(endRaw, fixedEnd);
  }

  const fixedNextYear = `${start.y + 1}/${end.mo}/${end.d}`;
  const fixedNY = parseCtbcPeriodDateParts(fixedNextYear);
  if (fixedNY && fixedNY.time >= start.time) {
    return s.replace(endRaw, fixedNextYear);
  }

  return s;
}

/** Resolve store name link from CTBC LINE Pay store.html (absolute or relative to source page). */
export function resolveCtbcLinepayDetailUrl(href, sourceUrl = '') {
  const raw = String(href || '').trim();
  if (!raw || raw === '#') return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    const base = new URL(
      sourceUrl || 'https://www.ctbcbank.com/content/dam/minisite/long/creditcard/LINEPay/store.html',
    );
    return new URL(raw, base).href;
  } catch (_) {
    return raw;
  }
}

export function parseCtbcLinepayHtml(html, sourceUrl = '') {
  const sections = [];
  const parts = String(html).split('<div class="tab-content__item');
  for (let i = 1; i < parts.length; i++) {
    const raw = `<div class="tab-content__item${parts[i]}`;
    const id = (raw.match(/id="([^"]+)"/i) || [])[1];
    if (!id) continue;
    const title = normalizeText((raw.match(/<h2 class="store-title">([\s\S]*?)<\/h2>/i) || [])[1]);
    sections.push({ id, title, content: raw });
  }
  const merchantMap = new Map();
  for (const section of sections) {
    const rows = section.content.split('<div class="store-table__data">').slice(1);
    for (const block of rows) {
      const cols = block
        .split('<div class="store-table__col">')
        .slice(1)
        .map((part) => {
          const end = part.indexOf('</div>');
          return end >= 0 ? part.slice(0, end) : part;
        });
      if (cols.length < 3) continue;
      const name = normalizeText((cols[0].match(/<h3 class="store-table__name">([\s\S]*?)<\/h3>/i) || [])[1]);
      if (!name) continue;
      const period = normalizeCtbcOfferPeriod(
        normalizeText((cols[0].match(/<p class="store-table__date">([\s\S]*?)<\/p>/i) || [])[1]),
      );
      const offerText = normalizeText(cols[1]);
      const noticeText = normalizeText(cols[2]);
      const ratePercent = extractMaxPercent(offerText);
      const hrefRaw = (cols[0].match(/<a[^>]*href=["']([^"']+)["']/i) || [])[1];
      const detailUrl = resolveCtbcLinepayDetailUrl(hrefRaw, sourceUrl);
      const entry = merchantMap.get(name) || { name, keywords: [name], offers: [] };
      const offer = {
        categoryId: section.id,
        categoryName: section.title || section.id,
        period: period || '',
        offerText: offerText || '',
        noticeText: noticeText || '',
        limitText: extractLimitText(`${noticeText}\n${offerText}`),
        limitPeriod: extractLimitPeriod(`${noticeText}\n${offerText}`),
        ratePercent,
      };
      if (detailUrl) offer.detailUrl = detailUrl;
      entry.offers.push(offer);
      merchantMap.set(name, entry);
    }
  }
  const merchants = Array.from(merchantMap.values());
  if (!merchants.length) throw new Error('ctbcLinepay parse failed: empty');
  return {
    updatedAt: new Date().toISOString(),
    sourceUrl,
    merchants,
  };
}

function parseHsbcListContent(content, category) {
  const results = [];
  const liMatches = content.match(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  if (!liMatches) return [];

  for (const li of liMatches) {
    let text = li.replace(/<[^>]+>/g, '').trim();
    text = text.replace(/^[^：:]+[：:]/, '');

    let processedText = '';
    let parenLevel = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '(' || char === '（') {
        parenLevel += 1;
        processedText += char;
      } else if (char === ')' || char === '）') {
        parenLevel = Math.max(0, parenLevel - 1);
        processedText += char;
      } else if ((char === '、' || char === '，' || char === ',') && parenLevel > 0) {
        processedText += '\u001F';
      } else {
        processedText += char;
      }
    }

    const rawItems = processedText
      .split(/[、，,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const rawItem of rawItems) {
      const parenMatch = rawItem.match(/^(.+?)[（(](?:如)?(.+?)[)）]$/);
      if (parenMatch) {
        const mainBrand = parenMatch[1].trim();
        const subBrandsText = parenMatch[2].trim();
        if (mainBrand) results.push({ name: mainBrand, category, note: '官方通路' });
        const subBrands = subBrandsText
          .split('\u001F')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const sub of subBrands) {
          results.push({ name: sub, category, note: '官方通路' });
        }
      } else {
        const restoredItem = rawItem.replace(/\u001F/g, '、');
        const slashParts = restoredItem
          .split('/')
          .map((s) => s.trim())
          .filter(Boolean);
        if (slashParts.length > 1) {
          let lastFull = slashParts[0];
          results.push({ name: lastFull, category, note: '官方通路' });
          for (let i = 1; i < slashParts.length; i++) {
            const part = slashParts[i];
            if (part.length < lastFull.length) {
              const prefixLen = lastFull.length - part.length;
              if (prefixLen > 0) {
                const prefix = lastFull.substring(0, prefixLen);
                const newName = prefix + part;
                results.push({ name: newName, category, note: '官方通路' });
                lastFull = newName;
              } else {
                results.push({ name: part, category, note: '官方通路' });
                lastFull = part;
              }
            } else {
              results.push({ name: part, category, note: '官方通路' });
              lastFull = part;
            }
          }
        } else {
          results.push({ name: restoredItem, category, note: '官方通路' });
        }
      }
    }
  }
  return results;
}

export function parseHsbcMerchants(html) {
  const allMerchants = [];
  const tableMatch = html.match(/id="pp_main_basicTable_2"[\s\S]*?<\/table>/);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[0];
  const categories = [
    { name: '餐飲', pattern: /<td[^>]*>[\s\S]*?>\s*餐飲[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i },
    { name: '購物', pattern: /<td[^>]*>[\s\S]*?>\s*購物[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i },
    { name: '娛樂', pattern: /<td[^>]*>[\s\S]*?>\s*娛樂[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i },
  ];
  for (const cat of categories) {
    const match = tableHtml.match(cat.pattern);
    if (match) allMerchants.push(...parseHsbcListContent(match[1], cat.name));
  }
  return dedupeBy(allMerchants, (x) => `${x.category}|${x.name}`);
}

function parseHsbcRewards(html) {
  const rewards = {
    domestic: {
      base: { rate: 0, rounding: 'round', limit: null },
      merchant_bonus: { rate: 0, rounding: 'round', limit: 0 },
      autopay_bonus: { rate: 0, rounding: 'round', limit: 0 },
    },
    overseas: {
      base: { rate: 0, rounding: 'round', limit: null },
      country_bonus: { rate: 0, rounding: 'round', limit: 0 },
      autopay_bonus: { rate: 0, rounding: 'round', limit: 0 },
    },
  };
  const g = html.match(/一般通路消費[\s\S]*?([\d.]+)%[\s\S]*?無上限/);
  if (g) rewards.domestic.base.rate = rewards.overseas.base.rate = Number.parseFloat(g[1]);
  const m = html.match(/三大通路消費[\s\S]*?加碼([\d.]+)%[\s\S]*?上限(\d+)點/);
  if (m) {
    rewards.domestic.merchant_bonus.rate = Number.parseFloat(m[1]);
    rewards.domestic.merchant_bonus.limit = Number.parseInt(m[2], 10);
  }
  const c = html.match(/精選國家餐飲通路消費[\s\S]*?加碼([\d.]+)%[\s\S]*?(\d+)點/);
  if (c) {
    rewards.overseas.country_bonus.rate = Number.parseFloat(c[1]);
    rewards.overseas.country_bonus.limit = Number.parseInt(c[2], 10);
  }
  const a = html.match(/完成本行自動扣繳任務[\s\S]*?加碼([\d.]+)%[\s\S]*?(\d+)點/);
  if (a) {
    const rate = Number.parseFloat(a[1]);
    const limit = Number.parseInt(a[2], 10);
    rewards.domestic.autopay_bonus = { rate, rounding: 'round', limit };
    rewards.overseas.autopay_bonus = { rate, rounding: 'round', limit };
  }
  return rewards;
}

function parseHsbcCountries(html) {
  const keyword = '精選國家餐飲通路消費';
  const idx = html.indexOf(keyword);
  if (idx < 0) return [];
  const start = html.lastIndexOf('<tr', idx);
  const end = html.indexOf('</tr>', idx);
  if (start < 0 || end < 0) return [];
  const row = html.slice(start, end + 5);
  const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
  if (tds.length < 4) return [];
  const text = normalizeText(tds[3]).replace(/精選餐飲通路/g, '');
  return text
    .split('/')
    .map((x) => normalizeText(x))
    .filter(Boolean)
    .map((name) => ({ name: `${name}精選餐飲通路`, note: '官方通路' }));
}

function parseHsbcMiles(html) {
  const rateMatch = html.match(/1點=(\d+)哩/);
  const milesEarned = rateMatch ? Number.parseInt(rateMatch[1], 10) : 2;
  const listMatch = html.match(/兌換航空哩程[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/);
  if (!listMatch) return [];
  const lis = listMatch[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
  return lis
    .map((li) => normalizeText(li))
    .filter(Boolean)
    .map((airline) => ({ airline, pointsPerMile: 1, milesEarned }));
}

export const HSBC_FLY_MILES_URL =
  'https://shop.hsbc.com.tw/installments/creditcard/rewards/fly.html';

export const HSBC_OTHER_CARD_AIRLINES = [
  '長榮無限萬哩遊',
  '華夏哩程酬賓計劃',
  '亞洲萬里通',
  '新航KrisFlyer獎勵計劃',
];

export const HSBC_FLY_CARD_CATEGORIES = [
  {
    id: 'travel',
    name: '滙豐旅人無限卡、旅人御璽卡、旅人輕旅卡',
    pointType: '旅遊積分',
    sectionMarker: '滙豐旅人無限卡、旅人御璽卡、旅人輕旅卡',
  },
  {
    id: 'premier',
    name: '卓越理財信用卡',
    pointType: '紅利好點',
    rowMatch: '卓越理財信用卡',
  },
  {
    id: 'advance_points',
    name: '運籌理財信用卡/白金卡/紅利好點御璽卡',
    pointType: '紅利好點',
    rowMatch: '運籌理財信用卡',
  },
  {
    id: 'cash_cards',
    name: '滙豐匯鑽卡/現金回饋御璽卡/Live+現金回饋卡',
    pointType: '現金積點',
    rowMatch: 'Live+現金回饋卡',
  },
];

function parseHsbcPointMileRate(text) {
  const raw = normalizeText(text);
  const m = raw.match(/(\d+(?:\.\d+)?)\s*點(?:轉換|換)\s*(\d+(?:\.\d+)?)\s*(?:哩|里)/);
  if (!m) return null;
  const pointsPerMile = Number.parseFloat(m[1]);
  const milesEarned = Number.parseFloat(m[2]);
  if (!Number.isFinite(pointsPerMile) || !Number.isFinite(milesEarned) || pointsPerMile <= 0 || milesEarned <= 0) {
    return null;
  }
  return {
    pointsPerMile,
    milesEarned,
    plan: `${pointsPerMile}點=${milesEarned}哩`,
  };
}

function extractHsbcFlyPeriod(html) {
  const text = normalizeText(html);
  const m = text.match(/飛行優惠計劃兌換比例\s*\(([^)]+)\)/);
  if (m) return normalizeText(m[1]);
  const notice = text.match(/新年度有效期間為[^。]*?(\d{4}年\d{1,2}月\d{1,2}日至\d{4}年\d{1,2}月\d{1,2}日)/);
  return notice ? normalizeText(notice[1]) : '';
}

function extractHsbcTableRows(tableHtml) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    const cells = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      const colspanMatch = tdMatch[0].match(/colspan\s*=\s*["']?(\d+)/i);
      const text = normalizeText(tdMatch[1]);
      cells.push({
        text,
        colspan: colspanMatch ? Number.parseInt(colspanMatch[1], 10) : 1,
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function extractHsbcTravelAirlineName(conversion, carriers) {
  const conv = normalizeText(conversion);
  const carrierText = normalizeText(carriers)
    .replace(/\(\*註[^)]*\)/g, '')
    .trim();
  const eqMatch = conv.match(/旅遊積分\s*=\s*(\d+(?:\.\d+)?)\s*(?:哩|里)?\s*(.+)$/);
  let tail = eqMatch ? normalizeText(eqMatch[2]) : '';
  if (!tail) {
    const alt = conv.match(/旅遊積分\s*=\s*(\d+(?:\.\d+)?)\s*(.+)$/);
    tail = alt ? normalizeText(alt[2]) : '';
  }
  tail = tail
    .replace(/^(?:哩|里)\s*/, '')
    .replace(/\s*(?:哩程|里數|積分|哩|里)\s*$/g, '')
    .trim();

  const aliasRules = [
    [/華夏哩程/, '華夏哩程酬賓計劃'],
    [/無限萬哩遊/, '長榮無限萬哩遊'],
    [/^亞洲萬里通$/, '亞洲萬里通'],
    [/KrisFlyer|新航獎勵/, '新航KrisFlyer獎勵計劃'],
    [/^JAL$|JAL哩/, '日航哩程儲蓄專案'],
    [/LifeMiles/, '哥倫比亞航空LifeMiles'],
    [/^亞航|亞航獎勵|亞航積分/, '亞航獎勵'],
    [/藍天飛行/, '藍天飛行'],
    [/金鵬/, '海南航空金鵬俱樂部'],
    [/吉祥/, '吉祥航空如意俱樂部'],
    [/飛常哩程匯/, '漢莎航空飛常哩程匯'],
    [/Avios/, '卡達航空貴賓俱樂部'],
    [/前程萬里/, '聯合航空前程萬里'],
    [/微笑蓮花/, '越南航空微笑蓮花'],
    [/Miles&Smiles|Smiles/, '土耳其航空 Miles&Smiles'],
    [/Skywards/, '阿聯酋航空 Skywards'],
    [/Aeroplan/, '加航Aeroplan'],
    [/澳航/, '澳航飛行常客'],
  ];
  for (const [re, name] of aliasRules) {
    if (re.test(tail) || re.test(carrierText)) return name;
  }
  if (tail) return tail;
  return carrierText.split('\n')[0].trim();
}

function parseHsbcTravelMilesTable(html) {
  const marker = '· 滙豐旅人無限卡、旅人御璽卡、旅人輕旅卡';
  const idx = html.indexOf(marker);
  if (idx < 0) throw new Error('hsbc fly parse failed: travel section marker missing');
  const tableStart = html.indexOf('<table', idx);
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableStart < 0 || tableEnd < 0) throw new Error('hsbc fly parse failed: travel table missing');
  const rows = extractHsbcTableRows(html.slice(tableStart, tableEnd + 8));
  const rates = [];
  for (const cells of rows.slice(1)) {
    if (cells.length < 3) continue;
    const partner = normalizeText(cells[0]?.text || '');
    const carriers = normalizeText(cells[1]?.text || '');
    const conversion = normalizeText(cells[2]?.text || '');
    const rateMatch = conversion.match(/(\d+(?:\.\d+)?)\s*旅遊積分\s*=\s*(\d+(?:\.\d+)?)/);
    if (!rateMatch) continue;
    const pointsPerMile = Number.parseFloat(rateMatch[1]);
    const milesEarned = Number.parseFloat(rateMatch[2]);
    const airline = extractHsbcTravelAirlineName(conversion, carriers);
    if (!airline) continue;
    rates.push({
      airline,
      partner: partner || undefined,
      carriers: carriers || undefined,
      pointsPerMile,
      milesEarned,
      plan: `${pointsPerMile}旅遊積分=${milesEarned}哩`,
    });
  }
  if (!rates.length) throw new Error('hsbc fly parse failed: travel rates empty');
  return rates;
}

function parseHsbcOtherCardMilesTable(html) {
  const marker = '· 其他信用卡';
  const idx = html.indexOf(marker);
  if (idx < 0) throw new Error('hsbc fly parse failed: other cards table marker missing');
  const tableStart = html.indexOf('<table', idx);
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableStart < 0 || tableEnd < 0) throw new Error('hsbc fly parse failed: other cards table missing');
  const rows = extractHsbcTableRows(html.slice(tableStart, tableEnd + 8));
  const categories = [];
  const cardRows = HSBC_FLY_CARD_CATEGORIES.filter((cat) => cat.id !== 'travel');

  for (const config of cardRows) {
    const row = rows.find((cells) => normalizeText(cells[0]?.text || '').includes(config.rowMatch));
    if (!row) throw new Error(`hsbc fly parse failed: row missing for ${config.id}`);
    const rates = [];
    const dataCells = row.slice(1);
    let airlineIndex = 0;
    for (const cell of dataCells) {
      const parsed = parseHsbcPointMileRate(cell.text);
      if (!parsed) continue;
      const span = Math.max(1, Number(cell.colspan) || 1);
      for (let j = 0; j < span && airlineIndex < HSBC_OTHER_CARD_AIRLINES.length; j += 1) {
        rates.push({
          airline: HSBC_OTHER_CARD_AIRLINES[airlineIndex],
          ...parsed,
        });
        airlineIndex += 1;
      }
    }
    if (!rates.length) throw new Error(`hsbc fly parse failed: rates empty for ${config.id}`);
    categories.push({
      id: config.id,
      name: config.name,
      pointType: config.pointType,
      rates,
    });
  }
  return categories;
}

export function parseHsbcFlyMiles(html) {
  const travelRates = parseHsbcTravelMilesTable(html);
  const otherCategories = parseHsbcOtherCardMilesTable(html);
  const travelCategory = HSBC_FLY_CARD_CATEGORIES.find((cat) => cat.id === 'travel');
  return {
    updatedAt: new Date().toISOString(),
    period: extractHsbcFlyPeriod(html),
    sourceUrl: HSBC_FLY_MILES_URL,
    categories: [
      {
        id: travelCategory.id,
        name: travelCategory.name,
        pointType: travelCategory.pointType,
        rates: travelRates,
      },
      ...otherCategories,
    ],
  };
}

export const HSBC_TRAVEL_TIER_URLS = {
  infinite: 'https://www.hsbc.com.tw/credit-cards/products/travel/visa-infinite/',
  signature: 'https://www.hsbc.com.tw/credit-cards/products/travelone-signature/',
  light: 'https://www.hsbc.com.tw/credit-cards/products/travelone/',
};

export const HSBC_TRAVEL_INDEX_URL = 'https://www.hsbc.com.tw/credit-cards/';

const HSBC_TRAVEL_TIER_META = [
  { id: 'infinite', displayName: '無限卡', parseNames: ['旅人無限卡', '無限卡'], hasOverseasDomestic: true },
  { id: 'signature', displayName: '御璽卡', parseNames: ['旅人御璽卡', '御璽卡'], hasOverseasDomestic: true },
  { id: 'light', displayName: '輕旅卡', parseNames: ['旅人輕旅卡', '輕旅卡'], hasOverseasDomestic: false },
];

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHsbcTravelAmountPerPoint(text, labelPattern) {
  const re = new RegExp(
    `${labelPattern}[^\\d]{0,48}(?:NT\\$?|新台幣)?\\s*(\\d+)\\s*元\\s*=\\s*1\\s*旅遊積分`,
    'i',
  );
  const m = String(text || '').match(re);
  return m ? parseInt(m[1], 10) : null;
}

function buildHsbcTravelOptionsFromFallback(meta, fallback) {
  if (!fallback) return null;
  if (!meta.hasOverseasDomestic) {
    const amount = fallback.all;
    if (!amount) return null;
    return [{ id: 'all', name: '國內外消費', amount, reward: 1, stores: [] }];
  }
  if (!fallback.overseas || !fallback.domestic) return null;
  return [
    {
      id: 'overseas',
      name: '海外消費（含網路交易）',
      amount: fallback.overseas,
      reward: 1,
      stores: ['海外', '國外', '交易地點非台灣'],
    },
    {
      id: 'domestic',
      name: '國內消費',
      amount: fallback.domestic,
      reward: 1,
      stores: [],
    },
  ];
}

function parseHsbcTravelEarnFromProductHtml(html, tierMeta) {
  const normalized = stripHtmlToText(html);
  if (!tierMeta.hasOverseasDomestic) {
    const amount = parseHsbcTravelAmountPerPoint(normalized, '國內外消費')
      ?? parseHsbcTravelAmountPerPoint(normalized, '刷卡消費')
      ?? parseHsbcTravelAmountPerPoint(normalized, '國內外');
    if (!amount) throw new Error(`hsbc travel parse failed: ${tierMeta.id} single rate missing`);
    return [{ id: 'all', name: '國內外消費', amount, reward: 1, stores: [] }];
  }
  const overseas = parseHsbcTravelAmountPerPoint(normalized, '海外消費[（(]含網路交易[)）]?')
    ?? parseHsbcTravelAmountPerPoint(normalized, '海外消費');
  const domestic = parseHsbcTravelAmountPerPoint(normalized, '國內消費');
  if (!overseas || !domestic) {
    throw new Error(`hsbc travel parse failed: ${tierMeta.id} overseas/domestic rates missing`);
  }
  return [
    {
      id: 'overseas',
      name: '海外消費（含網路交易）',
      amount: overseas,
      reward: 1,
      stores: ['海外', '國外', '交易地點非台灣'],
    },
    { id: 'domestic', name: '國內消費', amount: domestic, reward: 1, stores: [] },
  ];
}

export function parseHsbcTravelEarnFromIndexHtml(html) {
  const result = {};
  const normalized = stripHtmlToText(html);
  for (const tier of HSBC_TRAVEL_TIER_META) {
    const names = Array.isArray(tier.parseNames) ? tier.parseNames : [];
    let idx = -1;
    for (const name of names) {
      const found = normalized.indexOf(name);
      if (found >= 0) {
        idx = found;
        break;
      }
    }
    if (idx < 0) continue;
    const chunk = normalized.slice(idx, idx + 500);
    if (!tier.hasOverseasDomestic) {
      const m = chunk.match(
        /(?:刷卡消費|國內外)[^\d]{0,40}(?:新台幣|NT\$?)\s*(\d+)\s*元\s*=\s*1\s*旅遊積分/i,
      );
      if (m) result[tier.id] = { all: parseInt(m[1], 10) };
    } else {
      const om = chunk.match(
        /海外消費[^\d]{0,40}(?:新台幣|NT\$?)\s*(\d+)\s*元\s*=\s*1\s*旅遊積分/i,
      );
      const dm = chunk.match(
        /國內消費[^\d]{0,40}(?:新台幣|NT\$?)\s*(\d+)\s*元\s*=\s*1\s*旅遊積分/i,
      );
      if (om && dm) {
        result[tier.id] = { overseas: parseInt(om[1], 10), domestic: parseInt(dm[1], 10) };
      }
    }
  }
  return result;
}

export function parseHsbcTravelPointsToCash(html, sourceUrl) {
  const source = sourceUrl || HSBC_TRAVEL_TIER_URLS.infinite;
  const ratios = [];
  const tableRe = /<table[^>]*class="[^"]*desktop[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const block = tableMatch[1];
    if (!/旅遊積分/.test(block) || !/刷卡金/.test(block)) continue;
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRe.exec(block)) !== null) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(trMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length !== 2) continue;
      const miles = parseInt(cells[0].replace(/,/g, ''), 10);
      const cash = parseInt(cells[1].replace(/[$,]/g, ''), 10);
      if (!miles || !cash) continue;
      ratios.push({
        miles,
        cash,
        label: `${miles.toLocaleString('en-US')}旅遊積分=$${cash.toLocaleString('en-US')}`,
        sourceUrl: source,
      });
    }
    if (ratios.length >= 3) break;
  }

  if (ratios.length < 3) {
    const pairs = [...String(html || '').matchAll(
      /(\d{1,3}(?:,\d{3})*)\s*<\/td>\s*<td>\s*\$(\d{1,3}(?:,\d{3})*)/g,
    )];
    for (const pair of pairs) {
      const miles = parseInt(pair[1].replace(/,/g, ''), 10);
      const cash = parseInt(pair[2].replace(/,/g, ''), 10);
      if (!miles || !cash) continue;
      if (!ratios.some((r) => r.miles === miles)) {
        ratios.push({
          miles,
          cash,
          label: `${miles.toLocaleString('en-US')}旅遊積分=$${cash.toLocaleString('en-US')}`,
          sourceUrl: source,
        });
      }
    }
  }

  if (!ratios.length) throw new Error('hsbc travel parse failed: points-to-cash table missing');
  ratios.sort((a, b) => b.miles - a.miles);
  return ratios;
}

/**
 * @param {{ infiniteHtml: string, signatureHtml: string, lightHtml: string, indexHtml: string }} pages
 */
export function parseHsbcTravelCardData(pages) {
  const indexFallback = parseHsbcTravelEarnFromIndexHtml(pages.indexHtml || '');
  const warnings = [];
  const tiers = HSBC_TRAVEL_TIER_META.map((meta) => {
    const htmlByTier = {
      infinite: pages.infiniteHtml,
      signature: pages.signatureHtml,
      light: pages.lightHtml,
    };
    const html = htmlByTier[meta.id] || '';
    const sourceUrl = HSBC_TRAVEL_TIER_URLS[meta.id];
    let options;
    try {
      options = parseHsbcTravelEarnFromProductHtml(html, meta);
    } catch (productErr) {
      const fb = buildHsbcTravelOptionsFromFallback(meta, indexFallback[meta.id]);
      if (!fb) throw productErr;
      options = fb;
      warnings.push(`${meta.id}: product page parse failed, used index fallback`);
    }

    const fb = indexFallback[meta.id];
    if (fb && meta.hasOverseasDomestic && options?.length >= 2) {
      const overseasOpt = options.find((o) => o.id === 'overseas');
      const domesticOpt = options.find((o) => o.id === 'domestic');
      if (fb.overseas && overseasOpt && fb.overseas !== overseasOpt.amount) {
        warnings.push(`${meta.id}: index overseas ${fb.overseas} != product ${overseasOpt.amount}, kept product`);
      }
      if (fb.domestic && domesticOpt && fb.domestic !== domesticOpt.amount) {
        warnings.push(`${meta.id}: index domestic ${fb.domestic} != product ${domesticOpt.amount}, kept product`);
      }
    }
    if (fb && !meta.hasOverseasDomestic && options?.[0] && fb.all && fb.all !== options[0].amount) {
      warnings.push(`${meta.id}: index all ${fb.all} != product ${options[0].amount}, kept product`);
    }

    return { id: meta.id, name: meta.displayName || meta.id, sourceUrl, options };
  });

  const milesToCashRatios = parseHsbcTravelPointsToCash(
    pages.infiniteHtml || '',
    HSBC_TRAVEL_TIER_URLS.infinite,
  );

  const data = {
    earnType: 'points',
    pointUnitLabel: '旅遊積分',
    milesSource: 'program',
    milesProgramId: 'hsbc_travel',
    milesCategoryId: 'travel',
    displayName: '滙豐旅人卡',
    updatedAt: new Date().toISOString(),
    milesToCashRatios,
    overseasKeywords: [
      '海外', '國外', 'overseas', 'abroad',
      '日本', '美國', '韓國', '泰國', '新加坡', '香港', '歐洲',
    ],
    tiers,
  };
  if (warnings.length) data._crawlerWarnings = warnings;
  return data;
}

export function parseHsbcHtml(html) {
  const merchants = parseHsbcMerchants(html);
  if (!merchants.length) throw new Error('hsbc parse failed: no merchants');
  return {
    merchants,
    overseas_countries: parseHsbcCountries(html),
    rewards: parseHsbcRewards(html),
    lastUpdated: new Date().toISOString(),
  };
}

export const UBOT_CARD_URL = 'https://card.ubot.com.tw/CardDetail/cardDetail201';

/** SPA canonical URL → static HTML fragment (same as card.ubot.com.tw frontend). */
export function resolveUbotHtmlUrl(canonicalUrl = UBOT_CARD_URL) {
  const match = String(canonicalUrl || '').match(/\/CardDetail\/(cardDetail\d+)/i);
  if (match) {
    return `https://card.ubot.com.tw/ecard_source/html/CardDetail/${match[1]}.htm`;
  }
  return canonicalUrl;
}

export const UBOT_IP_BONUS_CHANNELS = [
  'CHIIKAWA SHOP inTAIPEI台北常設店',
  'CHIIKAWA DAYS台北特展商店',
  'OPENTIX兩廳院',
  'tixCraft拓元',
  '寬宏售票',
  '年代線上售票',
  'KKTIX',
  '威秀',
  '秀泰',
];

export const UBOT_IP_BONUS_REWARD = {
  item: '指定加碼',
  min_spend: 0,
  rate: 5,
  cap: 200,
  period_start: '2026-07-01',
  period_end: '2026-09-30',
};

export const UBOT_NEW_CUSTOMER_REWARD = {
  item: '新戶LINE Pay加碼',
  min_spend: 100,
  rate: 4,
  cap: 300,
};

export function parseUbotHtml(html) {
  const section = html.match(/<h3>(偶數日LINE Pay指定通路.*?)<\/h3>[\s\S]*?<div>([\s\S]*?)<\/div>/i);
  if (!section) throw new Error('ubot parse failed: section not found');
  const title = section[1];
  const content = section[2];
  const rateMatch = title.match(/(\d+(?:\.\d+)?)%/) || content.match(/(\d+(?:\.\d+)?)%\s*回饋/);
  const rate = rateMatch ? Number.parseFloat(rateMatch[1]) : 0;
  const minMatch = content.match(/滿(\d+)(?:元)?/);
  const capMatch = content.match(/上限(\d+)點/);
  const reward = {
    item: '偶數日LINE Pay指定通路',
    min_spend: minMatch ? Number.parseInt(minMatch[1], 10) : 0,
    rate,
    cap: capMatch ? Number.parseInt(capMatch[1], 10) : null,
  };
  const fullNoticeMatch = title.match(/[（(]([^()（）]*回饋[^()（）]*額滿[^()（）]*)[)）]/);
  if (fullNoticeMatch) {
    reward.full_notice = normalizeText(fullNoticeMatch[1]);
    const monthMatch = reward.full_notice.match(/(\d{1,2})月回饋/);
    if (monthMatch) reward.full_month = Number.parseInt(monthMatch[1], 10);
  }
  const channelMatch = content.match(/指定通路：([\s\S]*?)(?:<br|&lt;br|<span|&lt;span|<\/div)/i);
  const channels = channelMatch
    ? normalizeText(
        channelMatch[1]
          .trim()
          .replace(/<[^>]+>|&lt;[^&]+&gt;/g, ''),
      )
        .split(/[、，,]/)
        .map((x) => normalizeText(x))
        .filter(Boolean)
    : [];
  return {
    updated_at: new Date().toISOString(),
    designated_channels: channels,
    ip_bonus_channels: [...UBOT_IP_BONUS_CHANNELS],
    rewards: [
      { item: '國內基本回饋', min_spend: 0, rate: 1, cap: null },
      { item: '國外基本回饋', min_spend: 0, rate: 3, cap: null },
      { item: '國內LINE Pay最高', min_spend: 100, rate: 1, cap: 200 },
      reward,
      { ...UBOT_IP_BONUS_REWARD },
      { ...UBOT_NEW_CUSTOMER_REWARD },
    ],
  };
}

function parseTaishinAirlineInfo(text) {
  const v = normalizeText(text);
  if (!v) return null;
  const patterns = [
    [/^(.+?)\((.+?)\)(舊制|新制)$/, (m) => ({ airline: m[1], plan: `${m[2]}(${m[3]})` })],
    [/^(.+?)\s+\((.+)\)$/, (m) => ({ airline: m[1], plan: m[2] })],
    [/^(.+?)\((.+)\)$/, (m) => ({ airline: m[1], plan: m[2] })],
    [/^(.+)$/, (m) => ({ airline: m[1], plan: '一般兌換' })],
  ];
  for (const [re, fn] of patterns) {
    const m = v.match(re);
    if (m) return fn(m);
  }
  return null;
}

function isCathayAirmilesHeading(line) {
  if (!line || line.length > 80) return false;
  if (/^\d{4}\//.test(line)) return false;
  if (/點數酬賓|CUBE Rewards|請至|申請小樹點|立即下載/.test(line)) return false;
  return true;
}

function normalizeCathayAirlineName(name) {
  const line = normalizeText(name).split('\n')[0].trim();
  if (!line) return '';
  if (line === '亞洲萬里通') return '國泰航空';
  return line;
}

function normalizeCathayPlanName(plan) {
  const v = normalizeText(plan).trim();
  if (v === '其他卡別') return '其他卡';
  return v;
}

function stripCathayMemberSignupText(text) {
  return normalizeText(text)
    .replace(/（還不是會員[^）]*）/g, '')
    .replace(/\(還不是會員[^)]*\)/g, '')
    .trim();
}

function parseCathayExchangeRate(text) {
  const clean = stripCathayMemberSignupText(text);
  const m = clean.match(/(\d[\d,]*)\s*點\s*換\s*([\d,]+)/);
  if (!m) return null;
  const cost_points = parseIntSafe(m[1]);
  const redeemed_miles = parseIntSafe(m[2]);
  if (!cost_points || !redeemed_miles) return null;
  return { cost_points, redeemed_miles };
}

function findCathayAirmilesMain(model) {
  let found = null;
  walk(model, (node) => {
    if (found || !node || typeof node !== 'object') return;
    if (!String(node[':type'] || '').includes('cub-main')) return;
    const items = node[':items'];
    if (!items || typeof items !== 'object') return;
    const hasTable = Object.values(items).some((item) =>
      String(item?.[':type'] || '').includes('cub-table'),
    );
    if (hasTable) found = node;
  });
  return found;
}

export function parseCathayAirmilesModel(model) {
  const main = findCathayAirmilesMain(model);
  if (!main) throw new Error('cathay airmiles parse failed: cub_main not found');

  const order = Array.isArray(main[':itemsOrder']) ? main[':itemsOrder'] : Object.keys(main[':items']);
  const items = main[':items'] || {};
  const out = [];
  let airline = '';

  for (const key of order) {
    const item = items[key];
    if (!item || typeof item !== 'object') continue;
    const type = String(item[':type'] || '');

    if (type.includes('cub-textb') || type.includes('cub-texta')) {
      const raw = item.text || item.title || '';
      if (!raw) continue;
      const heading = normalizeText(raw).split('\n')[0].trim();
      if (isCathayAirmilesHeading(heading)) airline = normalizeCathayAirlineName(heading);
      continue;
    }

    if (!type.includes('cub-table') || !airline) continue;

    const tables = Array.isArray(item.tables) ? item.tables : [];
    const planCol = tables.find((t) => t.header === '卡別');
    const rateCol = tables.find((t) => t.header === '兌換比率');
    const plans = planCol?.content || [];
    const rates = rateCol?.content || [];
    const rowCount = Math.max(plans.length, rates.length);

    for (let i = 0; i < rowCount; i++) {
      const plan = normalizeCathayPlanName(plans[i]?.content || '');
      const rate = parseCathayExchangeRate(rates[i]?.content || '');
      if (!plan || !rate) continue;
      out.push({ airline, plan, ...rate });
    }
  }

  if (!out.length) throw new Error('cathay airmiles parse failed: empty');
  return out;
}

function parseCathayAirlineInfo(text) {
  const clean = normalizeText(text).replace(/\n/g, ' ');
  if (!clean) return null;
  const major = ['中華航空', '長榮航空', '國泰航空'];
  for (const airline of major) {
    if (clean.includes(airline)) {
      const plan = clean.includes('世界卡') ? '世界卡' : '其他卡';
      return { airline, plan };
    }
  }
  const mappings = [
    ['阿聯酋', '阿聯酋航空Skywards'],
    ['聯合航空', '聯航前程萬里飛行計劃'],
    ['前程萬里', '聯航前程萬里飛行計劃'],
    ['法航', '法航荷航藍天飛行'],
    ['荷航', '法航荷航藍天飛行'],
    ['加航', '加航Aeroplan'],
    ['加拿大航空', '加航Aeroplan'],
    ['Aeroplan', '加航Aeroplan'],
    ['阿提哈德', '阿提哈德貴賓計劃'],
    ['亞航', '亞航獎勵'],
    ['亞洲航空', '亞航獎勵'],
    ['英國航空', '英國航空 Club'],
    ['卡達', '卡達航空貴賓俱樂部'],
    ['JAL', 'JAL哩程儲蓄專案'],
    ['日本航空', 'JAL哩程儲蓄專案'],
    ['萬豪', '萬豪旅享家'],
    ['雅高', 'ALL - 雅高心悅界忠誠度計劃'],
    ['IHG', '洲際優悅會'],
    ['優悅會', '洲際優悅會'],
    ['泰國', '泰國國際航空'],
    ['新加坡', '新加坡航空KrisFlyer'],
    ['KrisFlyer', '新加坡航空KrisFlyer'],
    ['香格里拉', '香格里拉會'],
  ];
  for (const [key, name] of mappings) {
    if (clean.includes(key)) return { airline: name, plan: '全卡別' };
  }
  return { airline: clean.split(/[\s(]/)[0], plan: '全卡別' };
}

export function parseTableMiles(html, type) {
  const rows = [];
  const rowRegex = /<tr[^>]*style="height:\s*20px"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRegex.exec(html)) !== null) rows.push(m[1]);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = [];
    const cellRegex = /<td[^>]*class="s[0-9]+"[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = cellRegex.exec(rows[i])) !== null) cells.push(normalizeText(c[1]));
    if (cells.length < 3 || !cells[0]) continue;
    const info = type === 'taishin' ? parseTaishinAirlineInfo(cells[0]) : parseCathayAirlineInfo(cells[0]);
    if (!info) continue;
    const cost_points = parseIntSafe(cells[1]);
    const redeemed_miles = parseIntSafe(cells[2]);
    if (!cost_points || !redeemed_miles) continue;
    out.push({ airline: info.airline, plan: info.plan, cost_points, redeemed_miles });
  }
  if (!out.length) throw new Error(`${type} miles parse failed: empty`);
  return out;
}

export function parseOpenpointMiles(html) {
  const tab2Match = html.match(/<div id="tab2"[\s\S]*?<\/div>\s*<\/div>/i);
  if (!tab2Match) throw new Error('openpoint parse failed: tab2 not found');
  const lis = tab2Match[0].match(/<li>[\s\S]*?<\/li>/gi) || [];
  const target = new Set(['長榮航空', '亞洲萬里通', 'ANA哩程俱樂部']);
  const out = [];
  for (const li of lis) {
    const airline = normalizeText((li.match(/<h3>(.*?)<\/h3>/i) || [])[1]);
    if (!target.has(airline)) continue;
    const ps = li.match(/<p>([\s\S]*?)<\/p>/gi) || [];
    for (const p of ps) {
      const nums = [];
      const re = /<span>([\d,]+)<\/span>/gi;
      let m;
      while ((m = re.exec(p)) !== null) nums.push(parseIntSafe(m[1]));
      if (nums.length < 2) continue;
      const [cost_points, redeemed_miles] = nums;
      if (!cost_points || !redeemed_miles) continue;
      out.push({ airline, plan: '一般會員', cost_points, redeemed_miles });
    }
  }
  if (!out.length) throw new Error('openpoint parse failed: empty');
  return out;
}

export function stripEsunHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>\s*<li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Match GAS miles_update.gs formatEsunPlanText_ */
export function formatEsunPlanText(text) {
  const formatted = [];
  for (const line of String(text || '').split('\n')) {
    let s = String(line || '').trim();
    if (!s) continue;

    s = s.replace(
      /每\s*([\d,]+)\s*點\s*e\s*point\s*兌換\s*([\d,]+)\s*(?:哩|里數?)/gi,
      (_, pts, miles) => `每${pts} 點→ ${miles} 哩`,
    );

    s = s.replace(/[，,]\s*兌換完為止.*$/, '').trim();

    if (s === '本活動僅開放線上兌換') continue;
    if (/^每月限量[\d,]+份$/.test(s)) continue;
    if (!s) continue;

    formatted.push(s);
  }
  return formatted.join('\n');
}

export function parseEsunMilesEntries(entries) {
  const out = [];
  for (const entry of entries || []) {
    const detail = Array.isArray(entry?.productsDetailsResponse) ? entry.productsDetailsResponse[0] : null;
    if (!detail) continue;
    const cost_points = Number(detail.ExchangePoint) || 0;
    const description = stripEsunHtml(entry.ProductDescription || '');
    const redeemedMatch = description.match(/兌換\s*([\d,]+)\s*(?:哩|里數?)/);
    const redeemed_miles = redeemedMatch ? parseIntSafe(redeemedMatch[1]) : 0;
    if (!cost_points || !redeemed_miles) continue;
    const stock = Number(entry.Stock);
    const is_limited = entry.IsStock === true;
    const stockValue = Number.isFinite(stock) ? stock : 0;
    const sold_out = is_limited && stockValue <= 0;
    const plan = formatEsunPlanText(description || String(entry.ProductNote || '').trim());
    const item = {
      airline: normalizeText(entry.Name || ''),
      plan,
      cost_points,
      redeemed_miles,
      is_limited,
      available: !sold_out,
      sold_out,
    };
    if (is_limited) item.stock = stockValue;
    if (item.airline) out.push(item);
  }
  return out;
}

/** Fields ignored when deciding if crawler output changed (GAS also skips timestamp-only diffs). */
export const VOLATILE_JSON_KEYS = ['updatedAt', 'updated_at', 'lastUpdated'];

export function stripVolatileFields(value) {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (VOLATILE_JSON_KEYS.includes(key)) continue;
    out[key] = stripVolatileFields(val);
  }
  return out;
}

export function stableJsonStringify(data) {
  return `${JSON.stringify(stripVolatileFields(data), null, 2)}\n`;
}

export function mergeCubeWithLegacy(parsed, legacy = {}) {
  const out = {
    ...legacy,
    ...parsed,
    schemeNames: {
      ...(legacy.schemeNames || {}),
      ...(parsed.schemeNames || {}),
    },
  };
  if (legacy.linepay) out.linepay = legacy.linepay;
  if (!out.linepay) out.linepay = [['LINE Pay']];
  return out;
}

/** Preserve accelerator store lists when AEM model omits merchant tables. */
export function mergeCathayAsiaMilesWithLegacy(parsed, legacy = {}) {
  const out = { ...parsed };
  const legacyStores = legacy?.storeCategories || {};
  const parsedStores = out.storeCategories || {};
  if (!Object.keys(parsedStores).length && Object.keys(legacyStores).length) {
    out.storeCategories = legacyStores;
    out.acceleratorStores = legacy.acceleratorStores || flattenCathayAmStores(legacyStores);
  }
  return out;
}

const CATHAY_AM_TIER_DEFS = [
  { id: 'world', name: '世界卡' },
  { id: 'titanium', name: '鈦金商務卡', alt: '鈦商卡' },
  { id: 'platinum', name: '白金卡' },
  { id: 'enjoy', name: '里享卡' },
];

const CATHAY_AM_STORE_CATEGORIES = ['海外', '旅遊', '生活', '娛樂'];

function parseCathayAmRatePair(text, labelPattern) {
  const chunkMatch = String(text || '').match(new RegExp(`${labelPattern}[\\s\\S]{0,160}`, 'i'));
  if (!chunkMatch) return null;
  const chunk = chunkMatch[0];
  const patterns = [
    /(?:NT\$?\s*)?(\d+(?:\.\d+)?)\s*元\s*[=＝]\s*(\d+(?:\.\d+)?)\s*里/,
    /NT\$?\s*(\d+(?:\.\d+)?)\s*[=＝]\s*(\d+(?:\.\d+)?)/,
    /(\d+(?:\.\d+)?)\s*元\s*[=＝]\s*(\d+(?:\.\d+)?)\s*里/,
  ];
  for (const re of patterns) {
    const m = chunk.match(re);
    if (!m) continue;
    const amount = Number.parseFloat(m[1]);
    const reward = Number.parseFloat(m[2]);
    if (Number.isFinite(amount) && amount > 0 && Number.isFinite(reward)) {
      return { amount, reward };
    }
  }
  return null;
}

function extractCathayAmTierBlock(text) {
  const src = String(text || '');
  const combined = src.match(/世界卡[\s\S]{0,3500}?里享卡[\s\S]{0,500}/i);
  return combined ? combined[0] : src;
}

function extractCathayAmTierSection(text, tierName, altName) {
  const src = extractCathayAmTierBlock(text);
  const startNames = [tierName, altName].filter(Boolean);
  let start = -1;
  let matchedName = tierName;
  for (const name of startNames) {
    const idx = src.search(new RegExp(name, 'i'));
    if (idx >= 0) {
      start = idx;
      matchedName = name;
      break;
    }
  }
  if (start < 0) return '';

  const otherNames = CATHAY_AM_TIER_DEFS
    .flatMap((d) => [d.name, d.alt].filter(Boolean))
    .filter((n) => n !== tierName && n !== altName);
  let end = src.length;
  for (const nextName of otherNames) {
    const idx = src.indexOf(nextName, start + matchedName.length);
    if (idx > start && idx < end) end = idx;
  }
  return src.slice(start, end);
}

function parseCathayAmBillCap(section) {
  const capChunk = String(section || '').match(
    /(?:每期帳單回饋上限|帳單回饋上限|每月帳單消費上限)[\s\S]{0,40}/i,
  );
  if (!capChunk) return undefined;
  if (/無上限/.test(capChunk[0])) return null;
  const m = capChunk[0].match(/NT?\$?\s*([\d,.]+)\s*萬/i);
  if (!m) return undefined;
  const n = Number.parseFloat(String(m[1]).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 10000) : undefined;
}

function parseCathayAmStoreCategories(text) {
  const out = {};
  const src = normalizeText(text);
  for (const cat of CATHAY_AM_STORE_CATEGORIES) {
    const re = new RegExp(`${cat}[：:]\\s*([^\\n]+)`, 'i');
    const m = src.match(re);
    if (!m) continue;
    const items = String(m[1])
      .split(/[、,，/／]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length) out[cat] = items;
  }
  return out;
}

function flattenCathayAmStores(storeCategories) {
  const seen = new Set();
  const out = [];
  for (const list of Object.values(storeCategories || {})) {
    for (const item of list || []) {
      const name = String(item || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Parse Cathay Asia Miles product page (amount → miles tiers + accelerator stores). */
export function parseCathayAsiaMilesHtml(html, sourceUrl = '') {
  const text = normalizeText(html);
  if (!text) throw new Error('cathay asia miles parse failed: empty html');
  return buildCathayAsiaMilesData(text, sourceUrl);
}

function collectAemTextNodes(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAemTextNodes(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectAemTextNodes(child, out);
  }
  return out;
}

function findCathayAmTierSourceText(model) {
  const nodes = collectAemTextNodes(model);
  for (const node of nodes) {
    const n = normalizeText(node);
    if (/世界卡[\s\S]{0,120}一般消費：NT\$22/.test(n) && /里享卡/.test(n)) {
      return n;
    }
  }
  return normalizeText(nodes.join('\n'));
}

/** Parse Cathay Asia Miles AEM model.json (Cube SPA fallback when promo HTML is unavailable). */
export function parseCathayAsiaMilesModel(model, sourceUrl = '') {
  const fullText = normalizeText(collectAemTextNodes(model).join('\n'));
  const tierText = findCathayAmTierSourceText(model);
  if (!tierText) throw new Error('cathay asia miles parse failed: empty model');
  return buildCathayAsiaMilesData(tierText, sourceUrl, fullText);
}

function buildCathayAsiaMilesData(tierText, sourceUrl = '', fullText = '') {
  const storeCategories = parseCathayAmStoreCategories(fullText || tierText);
  const acceleratorStores = flattenCathayAmStores(storeCategories);

  const tiers = [];
  for (const def of CATHAY_AM_TIER_DEFS) {
    const section = extractCathayAmTierSection(tierText, def.name, def.alt);
    if (!section) continue;

    const general = parseCathayAmRatePair(section, '一般消費');
    const accelerator = parseCathayAmRatePair(section, '哩程加速器');
    let birthday = parseCathayAmRatePair(section, '生日(?:哩程)?加速器')
      || parseCathayAmRatePair(fullText || tierText, '生日(?:哩程)?加速器');
    if (!birthday && accelerator) {
      birthday = { amount: accelerator.amount / 2, reward: accelerator.reward };
    }
    const billCapTwd = parseCathayAmBillCap(section);

    if (!general && !accelerator) continue;

    const options = [];
    if (general) {
      options.push({ id: 'general', name: '一般消費', amount: general.amount, reward: general.reward, stores: [] });
    }
    if (accelerator) {
      options.push({
        id: 'accelerator',
        name: '哩程加速器',
        amount: accelerator.amount,
        reward: accelerator.reward,
        storesRef: 'acceleratorStores',
      });
    }
    if (birthday) {
      options.push({
        id: 'birthday',
        name: '生日哩程加速器',
        amount: birthday.amount,
        reward: birthday.reward,
        requiresBirthMonth: true,
        storesRef: 'acceleratorStores',
      });
    }

    tiers.push({
      id: def.id,
      name: def.name,
      billCapTwd: billCapTwd === undefined ? null : billCapTwd,
      options,
    });
  }

  if (!tiers.length) throw new Error('cathay asia miles parse failed: no tiers');

  return {
    earnType: 'miles',
    displayName: '亞洲萬里通',
    sourceUrl:
      sourceUrl || 'https://www.cathay-cube.com.tw/cathaybk/personal/product/credit-card/cards/asia-miles',
    updatedAt: new Date().toISOString(),
    storeCategories,
    acceleratorStores,
    tiers,
  };
}

const ESUN_STARLUX_TIER_DEFS = [
  { id: 'world_elite', name: '世界之極卡' },
  { id: 'world', name: '世界卡' },
  { id: 'business_titanium', name: '商務鈦金卡' },
  { id: 'titanium', name: '鈦金卡' },
];

const ESUN_STARLUX_DESIGNATED_DEFAULT = [
  '星宇航空官方網站/App購票',
  '星宇航空官方網站',
  '星宇航空App',
  '星宇航空',
  'Starlux',
  '星宇',
  '星宇航空形象門市',
  'béshopping',
  'beshopping',
  '星宇航空國際航線機上免稅品',
  '星宇航空機上免稅品',
];

function parseEsunStarluxRateToken(token) {
  const m = String(token || '').match(/(\d+(?:\.\d+)?)\s*元\s*(\d+)\s*哩/);
  if (!m) return null;
  const amount = Number.parseFloat(m[1]);
  const reward = Number.parseInt(m[2], 10);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(reward)) return null;
  return { amount, reward };
}

function parseEsunStarluxMilesTable(text, html = '') {
  const fromHtml = parseEsunStarluxMilesTableFromHtml(html);
  if (fromHtml) return fromHtml;

  const anchor = String(text || '').match(/基本哩程[\s\S]{0,80}?最優10元1哩[\s\S]{0,600}/i)
    || String(text || '').match(/世界之極卡[\s\S]{0,500}?國內消費[\s\S]{0,400}/i);
  const block = anchor ? anchor[0] : String(text || '');
  const parseRow = (label) => {
    const m = block.match(
      new RegExp(`${label}\\s*((?:\\d+(?:\\.\\d+)?\\s*元\\s*\\d+\\s*哩\\s*){4})`, 'i'),
    );
    if (!m) return [];
    const rates = [];
    const reRate = /(\d+(?:\.\d+)?)\s*元\s*(\d+)\s*哩/g;
    let rm;
    while ((rm = reRate.exec(m[1])) !== null) {
      rates.push({ amount: Number.parseFloat(rm[1]), reward: Number.parseInt(rm[2], 10) });
    }
    return rates;
  };
  return {
    domestic: parseRow('國內消費'),
    overseas: parseRow('國外消費'),
  };
}

function parseEsunStarluxMilesTableFromHtml(html) {
  const tablePatterns = [
    /<table[^>]*class="[^"]*greenHeadTable[^"]*"[^>]*>([\s\S]*?)<\/table>/gi,
    /<table[^>]*>([\s\S]*?)<\/table>/gi,
  ];
  for (const tableRe of tablePatterns) {
    tableRe.lastIndex = 0;
    let match;
    while ((match = tableRe.exec(String(html || ''))) !== null) {
      const block = match[1];
      if (!/世界之極卡/.test(block) || !/國內消費/.test(block) || !/國外消費/.test(block)) continue;
      const text = normalizeText(block);
      const parseRow = (label) => {
        const m = text.match(
          new RegExp(`${label}\\s*((?:\\d+(?:\\.\\d+)?\\s*元\\s*\\d+\\s*哩\\s*){4})`, 'i'),
        );
        if (!m) return [];
        const rates = [];
        const reRate = /(\d+(?:\.\d+)?)\s*元\s*(\d+)\s*哩/g;
        let rm;
        while ((rm = reRate.exec(m[1])) !== null) {
          rates.push({ amount: Number.parseFloat(rm[1]), reward: Number.parseInt(rm[2], 10) });
        }
        return rates;
      };
      const domestic = parseRow('國內消費');
      const overseas = parseRow('國外消費');
      if (domestic.length >= 4 && overseas.length >= 4) {
        return { domestic, overseas };
      }
    }
  }
  return null;
}

function parseEsunStarluxRateRow(text, label, html = '') {
  const table = parseEsunStarluxMilesTable(text, html);
  return label === '國內消費' ? table.domestic : table.overseas;
}

function buildEsunStarluxTierOptions(domestic, overseas, includeBirthday) {
  const options = [
    { id: 'domestic', name: '國內消費', amount: domestic.amount, reward: domestic.reward, stores: [] },
    { id: 'overseas', name: '國外消費', amount: overseas.amount, reward: overseas.reward, storesRef: 'overseasKeywords' },
    {
      id: 'designated',
      name: '星宇指定通路 2倍',
      amount: domestic.amount / 2,
      reward: domestic.reward,
      storesRef: 'designatedStores',
    },
  ];
  if (includeBirthday) {
    options.push({
      id: 'birthday',
      name: '生日禮 (需登錄)',
      amount: overseas.amount / 2,
      reward: overseas.reward,
      requiresBirthMonth: true,
      storesRef: 'overseasPhysicalKeywords',
    });
  }
  return options;
}

function normalizeEsunStarluxStoreName(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&eacute;/gi, 'é')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEsunStarluxDesignatedStores(text, html = '') {
  const htmlMatch = String(html || '').match(/<li[^>]*>\s*星宇航空指定通路[：:]([\s\S]*?)<\/li>/i);
  const textMatch = !htmlMatch
    ? normalizeText(text).match(/星宇航空指定通路[：:]([^\n]+)/i)
    : null;
  const chunk = htmlMatch ? normalizeText(htmlMatch[1]) : (textMatch ? textMatch[1] : '');
  if (!chunk) return [...ESUN_STARLUX_DESIGNATED_DEFAULT];

  const officialItems = chunk
    .split(/[、,，]/)
    .map(normalizeEsunStarluxStoreName)
    .filter((s) => (
      s
      && s.length <= 40
      && !/注意|活動|期間|消費|支付|回饋|持卡人|Apple Pay|Google Pay|Samsung Pay|LINE Pay|PayPal|街口|Pi拍/.test(s)
    ));

  const merged = new Set(ESUN_STARLUX_DESIGNATED_DEFAULT);
  for (const item of officialItems) merged.add(item);
  return [...merged];
}

const CTBC_CAL_TIER_DEFS = [
  { id: 'dingzun', name: '鼎尊無限卡', capPrimary: 80000, storesRef: 'bonusStoresWithTravel' },
  { id: 'cuican', name: '璀璨無限卡', capPrimary: 60000, storesRef: 'bonusStoresWithTravel' },
  { id: 'business', name: '商務御璽卡', capPrimary: 20000, storesRef: 'bonusStores' },
];

const CTBC_CAL_BONUS_STORES_DEFAULT = [
  '國外實體商店',
  '中華航空官網購買機票',
  '華信航空官網購買機票',
  '華航 eMall',
  '華航eMall',
  'SkyBoutique 免稅品預訂網站',
  '華航Sky Boutique',
  '機上免稅品消費',
];

const CTBC_CAL_TRAVEL_BOOKING_DEFAULT = [
  'Agoda',
  'Hotels.com',
  'Expedia',
  'Trip.com',
  'Booking.com',
  'Airbnb',
];

function parseCtbcCalBaseRate(text) {
  const patterns = [
    /(?:NT|新台幣)?\s*(\d+)\s*元\s*[=＝]\s*(\d+)\s*哩/i,
    /基本哩\s*NT?\s*(\d+)\s*元\s*[=＝]\s*(\d+)\s*哩/i,
  ];
  for (const re of patterns) {
    const m = String(text || '').match(re);
    if (!m) continue;
    const amount = Number.parseInt(m[1], 10);
    const reward = Number.parseInt(m[2], 10);
    if (Number.isFinite(amount) && amount > 0 && Number.isFinite(reward)) {
      return { amount, reward };
    }
  }
  return null;
}

function parseCtbcCalJsonLdOffers(html) {
  const out = {};
  const re = /"name"\s*:\s*"(鼎尊無限卡|璀璨無限卡|商務御璽卡)"[\s\S]{0,400}?"description"\s*:\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(String(html || ''))) !== null) {
    const name = match[1];
    const desc = match[2].replace(/\\"/g, '"');
    const base = parseCtbcCalBaseRate(desc);
    const capMatch = desc.match(/正卡\s*([\d,]+)\s*哩/);
    const capPrimary = capMatch
      ? Number.parseInt(String(capMatch[1]).replace(/,/g, ''), 10)
      : undefined;
    out[name] = { base, capPrimary };
  }
  return out;
}

export function isCtbcBotChallengeHtml(html) {
  if (looksLikeCtbcCalHtml(html)) return false;
  const s = String(html || '');
  return (
    /\/4QbVtADbnLVIc\//.test(s)
    || /document\.getElementById\(_\$JC/.test(s)
    || (/<script[^>]*\br=['"]m['"]/i.test(s) && !/鼎尊無限卡/.test(s))
  );
}

export function looksLikeCtbcCalHtml(html) {
  const text = normalizeText(html);
  return /鼎尊無限卡/.test(text) && /元\s*[=＝]\s*\d+\s*哩/.test(text);
}

function extractCtbcCalTierSection(text, tierName) {
  const src = String(text || '');
  const re = new RegExp(`${tierName}[\\s\\S]{0,1200}`, 'i');
  const m = src.match(re);
  return m ? m[0] : '';
}

function parseCtbcCalBonusCap(section, fallback) {
  const m = String(section || '').match(/正卡\s*([\d,]+)\s*哩/i);
  if (!m) return fallback;
  const n = Number.parseInt(String(m[1]).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseCtbcCalBonusStores(text) {
  const src = normalizeText(text);
  const m = src.match(/加碼哩[\s\S]{0,600}?(?:消費|包括)[：:]([\s\S]{0,500})/i)
    || src.match(/指定通路[：:]([\s\S]{0,500})/i);
  if (!m) return [...CTBC_CAL_BONUS_STORES_DEFAULT];
  const chunk = m[1].split(/生日加碼|每月加碼|基本哩/)[0] || m[1];
  const items = chunk
    .split(/[、,，()（）]/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s && s.length <= 40 && !/注意|活動|期間|訂房平台消費/.test(s));
  return items.length ? items : [...CTBC_CAL_BONUS_STORES_DEFAULT];
}

function parseCtbcCalTravelStores(text) {
  const src = normalizeText(text);
  const m = src.match(/旅遊訂房平台消費[\s\S]{0,200}?\(([\s\S]{0,200})\)/i)
    || src.match(/訂房平台[：:]([\s\S]{0,200})/i);
  if (!m) return [...CTBC_CAL_TRAVEL_BOOKING_DEFAULT];
  const items = String(m[1])
    .split(/[、,，]/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return items.length ? items : [...CTBC_CAL_TRAVEL_BOOKING_DEFAULT];
}

function buildCtbcCalTierOptions(base, storesRef) {
  return [
    { id: 'domestic', name: '國內(基本哩)', amount: base.amount, reward: base.reward, stores: [] },
    { id: 'bonus', name: '加碼哩', amount: base.amount, reward: 2, storesRef },
    {
      id: 'birthday',
      name: '生日加碼哩',
      amount: base.amount,
      reward: 3,
      requiresBirthMonth: true,
      storesRef: 'overseasPhysicalKeywords',
    },
  ];
}

/** Parse CTBC China Airlines co-branded card page (amount → miles). */
export function parseCtbcCalHtml(html, sourceUrl = '') {
  const text = normalizeText(html);
  if (!text) throw new Error('ctbc cal parse failed: empty html');
  if (isCtbcBotChallengeHtml(html) || !looksLikeCtbcCalHtml(html)) {
    throw new Error('ctbc cal parse failed: bot challenge or invalid html');
  }

  const bonusStores = parseCtbcCalBonusStores(text);
  const travelBookingStores = parseCtbcCalTravelStores(text);
  const bonusStoresWithTravel = [...new Set([...bonusStores, ...travelBookingStores])];
  const storeCategories = {
    華航指定通路: bonusStores.filter((s) => !/國外實體|海外實體/.test(s)),
    旅遊訂房平台: travelBookingStores,
  };

  const jsonLdOffers = parseCtbcCalJsonLdOffers(html);
  const tiers = [];
  for (const def of CTBC_CAL_TIER_DEFS) {
    const section = extractCtbcCalTierSection(text, def.name);
    const jsonLd = jsonLdOffers[def.name];
    const base = jsonLd?.base || parseCtbcCalBaseRate(section) || parseCtbcCalBaseRate(text);
    if (!base) throw new Error(`ctbc cal parse failed: base rate missing for ${def.name}`);
    tiers.push({
      id: def.id,
      name: def.name,
      bonusCap: {
        primary: jsonLd?.capPrimary ?? parseCtbcCalBonusCap(section, def.capPrimary),
        supplementary: 20000,
      },
      options: buildCtbcCalTierOptions(base, def.storesRef),
    });
  }

  if (tiers.length < 3) throw new Error('ctbc cal parse failed: tiers incomplete');

  return {
    earnType: 'miles',
    displayName: '中華航空',
    sourceUrl: sourceUrl || 'https://www.ctbcbank.com/twrbo/zh_tw/cc_index/cc_product/cc_introduction_index/C_CAL.html',
    updatedAt: new Date().toISOString(),
    overseasPhysicalKeywords: [
      '國外實體商店', '海外實體商店', '國外實體', '海外實體', '國外實體通路', '海外實體通路',
    ],
    bonusStores,
    travelBookingStores,
    bonusStoresWithTravel,
    storeCategories,
    tiers,
  };
}

/** Parse E.SUN STARLUX co-branded card page (amount → COSMILE miles). */
export function parseEsunStarluxHtml(html, sourceUrl = '') {
  const text = normalizeText(html);
  if (!text) throw new Error('esun starlux parse failed: empty html');

  const domesticRates = parseEsunStarluxRateRow(text, '國內消費', html);
  const overseasRates = parseEsunStarluxRateRow(text, '國外消費', html);
  if (domesticRates.length < 4 || overseasRates.length < 4) {
    throw new Error('esun starlux parse failed: basic miles table incomplete');
  }

  const designatedStores = parseEsunStarluxDesignatedStores(text, html);
  const storeCategories = { '星宇指定通路': designatedStores };

  const tiers = ESUN_STARLUX_TIER_DEFS.map((def, idx) => ({
    id: def.id,
    name: def.name,
    options: buildEsunStarluxTierOptions(
      domesticRates[idx],
      overseasRates[idx],
      def.id !== 'titanium',
    ),
  }));

  return {
    earnType: 'miles',
    displayName: '星宇航空 COSMILE',
    sourceUrl: sourceUrl || 'https://www.esunbank.com/zh-tw/personal/credit-card/intro/co-branded-card/starlux-card',
    updatedAt: new Date().toISOString(),
    overseasKeywords: [
      '海外', '國外', 'overseas', 'abroad', '日本', '美國', '韓國', '泰國', '新加坡', '香港', '歐洲',
    ],
    overseasPhysicalKeywords: [
      '國外實體', '海外實體', '國外實體通路', '海外實體通路', '國外實體店', '海外實體店',
    ],
    storeCategories,
    designatedStores,
    tiers,
  };
}

/** Structural checks on parsed crawler outputs (no golden file required). */
export function validateParsedOutput(kind, data) {
  const errors = [];
  const brokenName = (name) => /^[(\)（）]|[)）]$/.test(String(name || ''));

  if (kind === 'hsbc') {
    for (const m of data?.merchants || []) {
      if (!m.name || !m.category) errors.push(`hsbc merchant missing fields: ${JSON.stringify(m)}`);
      if (brokenName(m.name)) errors.push(`hsbc broken merchant name: ${m.name}`);
    }
    if ((data?.merchants || []).length < 10) errors.push('hsbc merchants too few');
    if (!data?.rewards?.domestic?.base?.rate) errors.push('hsbc domestic base rate missing');
  }

  if (kind === 'ubot') {
    if (!(data?.designated_channels || []).length) errors.push('ubot channels empty');
    if (!(data?.ip_bonus_channels || []).length) errors.push('ubot ip bonus channels empty');
    const designated = (data?.rewards || []).find((r) => r.item === '偶數日LINE Pay指定通路');
    if (!designated?.rate) errors.push('ubot designated rate missing');
    const ipBonus = (data?.rewards || []).find((r) => r.item === '指定加碼');
    if (!ipBonus?.rate) errors.push('ubot ip bonus rate missing');
    const newCustomer = (data?.rewards || []).find((r) => r.item === '新戶LINE Pay加碼');
    if (!newCustomer?.rate) errors.push('ubot new customer rate missing');
  }

  if (kind === 'ctbcLinepay') {
    if (!(data?.merchants || []).length) errors.push('ctbc merchants empty');
    for (const m of data.merchants) {
      if (!m.name || !Array.isArray(m.offers) || !m.offers.length) {
        errors.push(`ctbc merchant invalid: ${m?.name || '(no name)'}`);
      }
      for (const offer of m.offers || []) {
        const period = normalizeCtbcOfferPeriod(offer.period);
        if (period !== String(offer.period || '').trim()) {
          errors.push(`ctbc period not normalized in repo: ${m.name} ${offer.period}`);
        }
        const dates = period.match(/\d{4}\/\d{1,2}\/\d{1,2}/g) || [];
        if (dates.length >= 2) {
          const start = parseCtbcPeriodDateParts(dates[0]);
          const end = parseCtbcPeriodDateParts(dates[dates.length - 1]);
          if (start && end && end.time < start.time) {
            errors.push(`ctbc inverted period: ${m.name} ${period}`);
          }
        }
      }
    }
  }

  if (kind === 'cube') {
    for (const key of ['digital', 'fun', 'travel', 'select']) {
      if (!Array.isArray(data?.[key]) || data[key].length === 0) {
        errors.push(`cube ${key} empty`);
      }
    }
  }

  if (kind === 'miles-row') {
    for (const row of data || []) {
      if (!row.airline || !row.cost_points || !row.redeemed_miles) {
        errors.push(`miles row invalid: ${JSON.stringify(row)}`);
      }
      if (row.redeemed_miles !== 1000 && kind === 'miles-row-cathay-major') {
        /* cathay sheet usually 1000 miles per row */
      }
    }
  }

  if (kind === 'dbs-miles') {
    const categories = data?.categories;
    if (!Array.isArray(categories) || categories.length < 4) {
      errors.push('dbs miles categories missing or incomplete');
    }
    for (const cat of categories || []) {
      if (!cat?.id || !cat?.name || !Array.isArray(cat.rates) || !cat.rates.length) {
        errors.push(`dbs category invalid: ${JSON.stringify(cat)}`);
      }
      for (const row of cat?.rates || []) {
        if (!row.airline || !row.cost_points || !row.redeemed_miles) {
          errors.push(`dbs miles row invalid: ${JSON.stringify(row)}`);
        }
      }
    }
  }

  if (kind === 'hsbc-miles') {
    const categories = data?.categories;
    if (!Array.isArray(categories) || categories.length < 4) {
      errors.push('hsbc miles categories missing or incomplete');
    }
    for (const cat of categories || []) {
      if (!cat?.id || !cat?.name || !Array.isArray(cat.rates) || !cat.rates.length) {
        errors.push(`hsbc category invalid: ${JSON.stringify(cat)}`);
      }
      for (const row of cat?.rates || []) {
        if (!row.airline || !row.pointsPerMile || !row.milesEarned) {
          errors.push(`hsbc miles row invalid: ${JSON.stringify(row)}`);
        }
      }
    }
  }

  if (kind === 'cathay-asia-miles') {
    if (!Array.isArray(data?.tiers) || data.tiers.length < 4) {
      errors.push('cathay asia miles tiers missing or incomplete');
    }
    for (const tier of data?.tiers || []) {
      if (!tier?.id || !tier?.name || !Array.isArray(tier.options) || tier.options.length < 2) {
        errors.push(`cathay asia miles tier invalid: ${JSON.stringify(tier)}`);
      }
    }
    if (!(data?.acceleratorStores || []).length) {
      errors.push('cathay asia miles acceleratorStores empty');
    }
  }

  if (kind === 'esun-starlux') {
    if (!Array.isArray(data?.tiers) || data.tiers.length < 4) {
      errors.push('esun starlux tiers missing or incomplete');
    }
    for (const tier of data?.tiers || []) {
      if (!tier?.id || !tier?.name || !Array.isArray(tier.options) || tier.options.length < 2) {
        errors.push(`esun starlux tier invalid: ${JSON.stringify(tier)}`);
      }
    }
    if (!(data?.designatedStores || []).length) {
      errors.push('esun starlux designatedStores empty');
    }
  }

  if (kind === 'ctbc-cal') {
    if (!Array.isArray(data?.tiers) || data.tiers.length < 3) {
      errors.push('ctbc cal tiers missing or incomplete');
    }
    for (const tier of data?.tiers || []) {
      if (!tier?.id || !tier?.name || !Array.isArray(tier.options) || tier.options.length < 3) {
        errors.push(`ctbc cal tier invalid: ${JSON.stringify(tier)}`);
      }
      if (!tier?.bonusCap?.primary) {
        errors.push(`ctbc cal tier bonusCap missing: ${tier?.id || '(no id)'}`);
      }
    }
    if (!(data?.bonusStores || []).length) {
      errors.push('ctbc cal bonusStores empty');
    }
    if (!(data?.bonusStoresWithTravel || []).length) {
      errors.push('ctbc cal bonusStoresWithTravel empty');
    }
  }

  if (kind === 'hsbc-travel') {
    if (!Array.isArray(data?.tiers) || data.tiers.length < 3) {
      errors.push('hsbc travel tiers missing or incomplete');
    }
    for (const tier of data?.tiers || []) {
      if (!tier?.id || !tier?.name || !Array.isArray(tier.options) || !tier.options.length) {
        errors.push(`hsbc travel tier invalid: ${JSON.stringify(tier)}`);
      }
    }
    if (!Array.isArray(data?.milesToCashRatios) || data.milesToCashRatios.length < 3) {
      errors.push('hsbc travel milesToCashRatios missing or incomplete');
    }
    for (const row of data?.milesToCashRatios || []) {
      if (!row.miles || !row.cash) {
        errors.push(`hsbc travel cash ratio invalid: ${JSON.stringify(row)}`);
      }
    }
  }

  return errors;
}

export const DBS_MILES_PAGE_CONFIG = [
  {
    id: 'bonus',
    name: '活利積分',
    path: 'bonus_redeem_mileage',
    parser: 'standard',
    sectionMarker: '兌換方式如下',
  },
  {
    id: 'cash',
    name: '現金積點/現金紅利',
    path: 'cash-redeem-mileage',
    parser: 'standard',
    sectionMarker: '兌換方式如下',
  },
  {
    id: 'fly',
    name: '飛行積金',
    path: 'fly_redeem_mileage',
    parser: 'fly',
    sectionMarker: '飛行積金兌換哩程獎勵計畫方式如下',
  },
  {
    id: 'pchome',
    name: 'PChome聯名紅利點數',
    path: 'pchome-redeem-mileage',
    parser: 'pchome',
    sectionMarker: 'PChome聯名紅利點數兌換',
  },
];

function gcdInt(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function normalizeDbsMilesRate(costPoints, redeemedMiles) {
  const cost = parseIntSafe(costPoints);
  const miles = parseIntSafe(redeemedMiles);
  if (!cost || !miles) return null;
  const g = gcdInt(cost, miles);
  let cost_points = cost / g;
  let redeemed_miles = miles / g;
  if (redeemed_miles < 100 && 100 % redeemed_miles === 0) {
    const factor = 100 / redeemed_miles;
    cost_points *= factor;
    redeemed_miles = 100;
  }
  return {
    cost_points,
    redeemed_miles,
    plan: `每${cost_points}點換${redeemed_miles}哩`,
  };
}

function formatDbsMilesNumber(value) {
  return Number(value).toLocaleString('en-US');
}

/** Preserve official DBS page point/mile packages (no ratio normalization). */
export function formatDbsMilesRateRaw(costPoints, redeemedMiles, options = {}) {
  const cost = parseIntSafe(costPoints);
  const miles = parseIntSafe(redeemedMiles);
  if (!cost || !miles) return null;
  const costFmt = formatDbsMilesNumber(cost);
  const milesFmt = formatDbsMilesNumber(miles);
  const pointLabel = String(options.pointLabel || '').trim();
  const carrier = String(options.carrier || '').trim();
  let plan;
  if (carrier) {
    plan = `${carrier}｜每${costFmt}點換${milesFmt}哩`;
  } else if (pointLabel) {
    plan = `每${costFmt}點${pointLabel}兌換${milesFmt}哩`;
  } else {
    plan = `每${costFmt}點換${milesFmt}哩`;
  }
  return {
    cost_points: cost,
    redeemed_miles: miles,
    plan,
  };
}

function extractDbsNextDataJson(html) {
  const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error('dbs: __NEXT_DATA__ not found');
  return JSON.parse(m[1]);
}

function collectDbsHtmlFragments(value, out = []) {
  if (typeof value === 'string') {
    if (value.includes('兌換') || value.includes('<li>')) out.push(value);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectDbsHtmlFragments(item, out);
    return out;
  }
  for (const v of Object.values(value)) collectDbsHtmlFragments(v, out);
  return out;
}

function extractDbsPageHtml(html) {
  const nextData = extractDbsNextDataJson(html);
  return collectDbsHtmlFragments(nextData).join('\n');
}

function sliceDbsSection(html, marker) {
  const text = String(html || '');
  const idx = text.indexOf(marker);
  if (idx < 0) return text;
  return text.slice(Math.max(0, idx - 1200), idx + 4000);
}

function extractDbsPeriod(html) {
  const text = normalizeText(html);
  const matches = [...text.matchAll(/活動期間\s*[:：]\s*([^\n<]+)/gi)].map((m) => normalizeText(m[1]));
  const preferred = matches.find((p) => /2026|即日起/.test(p));
  return preferred || matches[0] || '';
}

function parseDbsStandardRates(sectionHtml, category) {
  const text = normalizeText(sectionHtml);
  const out = [];
  const re = /每\s*([\d,]+)\s*點[^兌]*兌換\s*([\d,]+)\s*[「"]([^」"]+)[」"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = formatDbsMilesRateRaw(m[1], m[2], { pointLabel: category?.name || '' });
    if (!raw) continue;
    out.push({
      airline: normalizeText(m[3]),
      ...raw,
    });
  }
  return dedupeBy(out, (row) => `${row.airline}|${row.cost_points}|${row.redeemed_miles}`);
}

function parseDbsFlyRates(sectionHtml) {
  const text = normalizeText(sectionHtml);
  const out = [];
  const re = /([^：:\n]+)[：:]\s*([\d,]+)\s*點飛行積金可兌換\s*([\d,]+)\s*[「"]([^」"]+)[」"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const carrier = normalizeText(m[1]).replace(/^「|」$/g, '');
    const raw = formatDbsMilesRateRaw(m[2], m[3], { carrier });
    if (!raw) continue;
    out.push({
      airline: normalizeText(m[4]),
      ...raw,
    });
  }
  return dedupeBy(out, (row) => `${row.airline}|${row.cost_points}|${row.redeemed_miles}|${row.plan}`);
}

function parseDbsPchomeRates(sectionHtml, category) {
  const text = normalizeText(sectionHtml);
  const out = [];
  const re = /每\s*([\d,]+)\s*點\s*PChome聯名紅利點數兌換\s*([\d,]+)\s*[「"]([^」"]+)[」"]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = formatDbsMilesRateRaw(m[1], m[2], { pointLabel: category?.name || 'PChome聯名紅利點數' });
    if (!raw) continue;
    out.push({
      airline: normalizeText(m[3]),
      ...raw,
    });
  }
  return dedupeBy(out, (row) => `${row.airline}|${row.cost_points}|${row.redeemed_miles}`);
}

export function parseDbsMilesPage(html, category) {
  const pageHtml = extractDbsPageHtml(html);
  const sectionHtml = sliceDbsSection(pageHtml, category.sectionMarker);
  const period = extractDbsPeriod(sectionHtml) || extractDbsPeriod(pageHtml);
  let rates = [];
  if (category.parser === 'fly') rates = parseDbsFlyRates(sectionHtml);
  else if (category.parser === 'pchome') rates = parseDbsPchomeRates(sectionHtml, category);
  else rates = parseDbsStandardRates(sectionHtml, category);
  if (!rates.length) {
    throw new Error(`dbs ${category.id} parse failed: empty`);
  }
  return {
    id: category.id,
    name: category.name,
    period,
    sourceUrl: `https://www.dbs.com.tw/personal-zh/cards/rewards/${category.path}`,
    rates,
  };
}

export function parseDbsMilesCategories(htmlById) {
  const categories = DBS_MILES_PAGE_CONFIG.map((category) => {
    const html = htmlById?.[category.id];
    if (!html) throw new Error(`dbs ${category.id} html missing`);
    return parseDbsMilesPage(html, category);
  });
  return {
    updatedAt: new Date().toISOString(),
    categories,
  };
}

/** Stable bill-statement keywords from DBS AOV terms (less volatile than page layout). */
const DBS_AOV_BILL_KEYWORDS = {
  'App Store': ['APPLE.COM'],
  'Google Play': ['Google'],
  Garena: ['競舞娛樂'],
  GASH: ['樂點股有限公司'],
  MyCard: ['智冠科技'],
  巴哈姆特: ['BAHAMUT'],
  'Play Station': ['PlayStation', 'PLAYSTATION'],
  年代售票: ['ERACOM'],
  拓元售票: ['TIXCRAFT', '拓元'],
  Animate: ['ANIMATE', '安利美特'],
  野獸國: ['BEASTKINGDOM'],
  鼎美玩具: ['鼎美股份有限公司'],
  'Youtube Premium': ['YOUTUBE', 'GOOGLE YOUTUBE'],
  Netflix: ['NETFLIX'],
  'Disney+': ['DISNEY PLUS', 'DISNEYPLUS'],
  Twitch: ['TWITCH'],
  Tiktok: ['TIKTOK', 'TikTok'],
  愛奇藝: ['IQIYI', 'iQIYI'],
  Catchplay: ['CATCHPLAY'],
  Spotify: ['SPOTIFY'],
  'Uber Eats': ['UberEats', '優食', 'UBER EATS'],
  foodpanda: ['Foodpanda', 'ＦＰ－', 'FP-'],
  麥當勞: ['McDonald', 'MCDONALD'],
  肯德基: ['KFC'],
  摩斯漢堡: ['MOS', '安心食品'],
  拿坡里: ['NAPOLI'],
  Pizzahut: ['必勝客', 'PIZZAHUT', 'PIZZA HUT'],
  蝦皮: ['SHOPEE', 'Shopee'],
  淘寶: ['TAOBAO', 'Taobao'],
};

const DBS_AOV_SECTION_MARKERS = [
  { marker: '娛樂無限', category: '娛樂無限', endMarker: '影音充電' },
  { marker: '影音充電', category: '影音充電', endMarker: '生活補給' },
  { marker: '生活補給', category: '生活補給', endMarker: '玩家出國' },
];

const DBS_AOV_MERCHANT_SEEDS = [
  ['App Store', '娛樂無限'],
  ['Google Play', '娛樂無限'],
  ['Garena', '娛樂無限'],
  ['GASH', '娛樂無限'],
  ['MyCard', '娛樂無限'],
  ['Nintendo', '娛樂無限'],
  ['Play Station', '娛樂無限'],
  ['Steam', '娛樂無限'],
  ['巴哈姆特', '娛樂無限'],
  ['Logitech', '娛樂無限'],
  ['NOVA', '娛樂無限'],
  ['三創生活園區', '娛樂無限'],
  ['寬宏售票', '娛樂無限'],
  ['KKTIX', '娛樂無限'],
  ['年代售票', '娛樂無限'],
  ['拓元售票', '娛樂無限'],
  ['Animate', '娛樂無限'],
  ['野獸國', '娛樂無限'],
  ['POPMART', '娛樂無限'],
  ['鼎美玩具', '娛樂無限'],
  ['KHTOY', '娛樂無限'],
  ['TOYSNAP', '娛樂無限'],
  ['東海模型', '娛樂無限'],
  ['Youtube Premium', '影音充電'],
  ['Netflix', '影音充電'],
  ['Disney+', '影音充電'],
  ['Twitch', '影音充電'],
  ['Tiktok', '影音充電'],
  ['愛奇藝', '影音充電'],
  ['Catchplay', '影音充電'],
  ['KKTV', '影音充電'],
  ['LiTV', '影音充電'],
  ['Spotify', '影音充電'],
  ['KKBOX', '影音充電'],
  ['蝦皮', '生活補給'],
  ['淘寶', '生活補給'],
  ['Uber Eats', '生活補給'],
  ['foodpanda', '生活補給'],
  ['麥當勞', '生活補給'],
  ['肯德基', '生活補給'],
  ['摩斯漢堡', '生活補給'],
  ['拿坡里', '生活補給'],
  ['Pizzahut', '生活補給'],
];

function extractDbsAovMerchantBlockText(htmlFragment) {
  return String(htmlFragment || '')
    .replace(/<br\s*\/?>/gi, '｜')
    .replace(/\r\n|\r|\n/g, '｜')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\bNEW\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sliceDbsAovSection(text, marker, endMarker) {
  const start = text.indexOf(marker);
  if (start < 0) return '';
  const after = text.slice(start + marker.length);
  if (!endMarker) return after.slice(0, 12000);
  const endIdx = after.indexOf(endMarker);
  return endIdx >= 0 ? after.slice(0, endIdx) : after.slice(0, 12000);
}

function isValidDbsAovMerchantName(name) {
  if (!name || name.length < 2) return false;
  if (/class=|d-block|subhead|<\/?div|span>|br>|head>|remark/i.test(name)) return false;
  return true;
}

function normalizeDbsAovMerchantName(raw) {
  return extractDbsAovMerchantBlockText(raw);
}

function splitDbsAovMerchantLine(text) {
  return String(text || '')
    .split(/[｜|]/)
    .map((s) => normalizeDbsAovMerchantName(s))
    .filter(isValidDbsAovMerchantName);
}

function upsertDbsAovMerchant(map, name, category) {
  const clean = normalizeDbsAovMerchantName(name);
  if (!isValidDbsAovMerchantName(clean)) return;
  const key = clean.toLowerCase();
  const billExtras = DBS_AOV_BILL_KEYWORDS[clean] || [];
  const keywords = [clean, ...billExtras];
  const prev = map.get(key);
  if (prev) {
    const merged = new Set([...(prev.keywords || []), ...keywords]);
    prev.keywords = [...merged];
    if (!prev.category && category) prev.category = category;
    return;
  }
  map.set(key, { name: clean, category, keywords: [...new Set(keywords)] });
}

/**
 * Parse lifestyle merchants from DBS AOV marketing page HTML.
 * Falls back to seed list when layout changes.
 */
function parseDbsAovPlainSection(slice, category, map) {
  const lines = normalizeText(slice).split('\n');
  for (const line of lines) {
    const rest = line.trim().replace(
      /^(?:應用程式商店|數位遊戲平台|3C電子|展演售票|潮玩動漫|國際串流|影音平台|音樂|生活補給)\s*/u,
      '',
    );
    if (/[｜|]/.test(rest)) {
      splitDbsAovMerchantLine(rest).forEach((name) => upsertDbsAovMerchant(map, name, category));
    }
  }
}

export function parseDbsAovMerchants(html) {
  const map = new Map();
  const text = String(html || '');
  const hasMerchantBlocks = /<div class="d-block[^"]*"/i.test(text);

  for (const { marker, category, endMarker } of DBS_AOV_SECTION_MARKERS) {
    const slice = sliceDbsAovSection(text, marker, endMarker);
    if (!slice) continue;

    if (hasMerchantBlocks) {
      const blockRe = /<div class="d-block[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
      let m;
      while ((m = blockRe.exec(slice)) !== null) {
        const blockText = extractDbsAovMerchantBlockText(m[1]);
        splitDbsAovMerchantLine(blockText).forEach((name) => upsertDbsAovMerchant(map, name, category));
      }
      continue;
    }

    parseDbsAovPlainSection(slice, category, map);
  }

  if (map.size < 10) {
    DBS_AOV_MERCHANT_SEEDS.forEach(([name, category]) => upsertDbsAovMerchant(map, name, category));
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export function mergeDbsAovCrawledData(existing, parsedMerchants, sourceUrl) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  const staticItems = (Array.isArray(base.items) ? base.items : []).filter(
    (i) => i.type === 'general' || i.type === 'overseas_region',
  );
  const generalItem = staticItems.find((i) => i.type === 'general') || {
    name: '一般消費',
    keywords: ['一般消費', '其他一般消費'],
    type: 'general',
    note: '國內/國外一般消費 1% 無上限（需存戶升級）',
    total_pct: 1,
    bonus_pct: 0,
  };

  const lifestyleItems = (parsedMerchants || []).map((m, idx) => {
    const item = {
      name: m.name,
      category: m.category || '生活補給',
      keywords: m.keywords || [m.name],
      type: 'lifestyle',
      note: '生活玩家精選通路最高 10%（1% 無上限 + 9% 加碼月限 500 點）',
      total_pct: 10,
      bonus_pct: 9,
      cap_key: 'lifestyle_bonus',
    };
    if (idx === 0) {
      item.cap = 500;
      item.period = 'month';
      item.description = '生活玩家加碼 9%，每人每月上限 500 點（正附卡合併）';
    }
    return item;
  });

  const overseasItems = staticItems.filter((i) => i.type === 'overseas_region');

  return {
    ...base,
    card_name: base.card_name || '星展傳說對決聯名卡',
    updated_at: new Date().toISOString().slice(0, 10),
    sourceUrl: sourceUrl || base.sourceUrl,
    activity_period: base.activity_period || '2026/07/01～2026/12/31',
    base_pct_upgraded: base.base_pct_upgraded ?? 1,
    base_pct_basic: base.base_pct_basic || { domestic: 0.2, overseas: 1 },
    items: [generalItem, ...lifestyleItems, ...overseasItems],
    caps: base.caps || {
      lifestyle_bonus: { cap: 500, period: 'month', description: '生活玩家加碼 9%，每人每月上限 500 點' },
      overseas_bonus: { cap: 500, period: 'month', description: '海外指定地區加碼 4%，每人每月上限 500 點' },
    },
  };
}
