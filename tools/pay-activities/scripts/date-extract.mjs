/**
 * Extract activity date ranges from free text (title, HTML, JSON strings).
 * Returns { start, end, source, confidence } or null.
 */
import { collectOcrImageUrls } from './image-urls.mjs';

export function inferYearFromSlug(slug) {
  const m = String(slug || '').match(/(20\d{2})/);
  if (m) return m[1];
  const y = new Date().getFullYear();
  return String(y);
}

function lastDayOfMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function normalizeDatePart(part, defaultYear) {
  if (!part) return '';
  let s = String(part).trim();
  // 2025/04/28 or 2025-04-28
  let m = s.match(/(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
  }
  // 05/11 with default year
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (m && defaultYear) {
    return `${defaultYear}/${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}`;
  }
  return '';
}

function parsePeriodFromMatch(startRaw, endRaw) {
  const yearFromStart = startRaw.match(/(20\d{2})/)?.[1];
  const start = normalizeDatePart(startRaw, yearFromStart);
  let end = normalizeDatePart(endRaw, yearFromStart || endRaw.match(/(20\d{2})/)?.[1]);
  if (!start || !end) return null;
  return { start, end };
}

export function extractDatesFromText(text, opts = {}) {
  const defaultYear = opts.defaultYear || inferYearFromSlug(opts.slug);
  const plain = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[～~—–]/g, '~')
    .replace(/\s+/g, ' ');

  const patterns = [
    // 2026/05/12 00:00 ~ 2026/06/10 23:59
    /(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})(?:\s+\d{1,2}:\d{2})?\s*[~\-至到]\s*(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})(?:\s+\d{1,2}:\d{2})?/,
    // 2025/04/28-05/11  or  2025/07/01 — 08/31
    /(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})\s*[~\-]\s*(\d{1,2}[\/\-]\d{1,2})/,
    // OCR of slanted KV dates sometimes drops the dash: 2025/07/01 08/31
    /(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+(\d{1,2}[\/\-]\d{1,2})(?!\s*[\/\-]\d)/,
    // 活動期間：2023/11/08～2023/12/12
    /活動期間[：:]\s*(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})\s*[~\-]\s*(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})/,
    // 2026/01/01(一)00:00 ~ 2026/01/31(五)23:59
    /(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})[^~]{0,12}[~\-]\s*(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})/,
  ];

  for (const re of patterns) {
    const m = plain.match(re);
    if (m) {
      const parsed = parsePeriodFromMatch(m[1], m[2]);
      if (parsed) return { ...parsed, source: 'text', confidence: 'high' };
    }
  }

  // 2026 07/01-12/31 (year near md range)
  const yearMdRange = plain.match(/(20\d{2})\s+(\d{1,2}\/\d{1,2})\s*[-~]\s*(\d{1,2}\/\d{1,2})/);
  if (yearMdRange) {
    const year = yearMdRange[1];
    const [sm, sd] = yearMdRange[2].split('/');
    const [em, ed] = yearMdRange[3].split('/');
    return {
      start: `${year}/${sm.padStart(2, '0')}/${sd.padStart(2, '0')}`,
      end: `${year}/${em.padStart(2, '0')}/${ed.padStart(2, '0')}`,
      source: 'text',
      confidence: 'high',
    };
  }

  // 07/01-12/31 (year from slug/context)
  const mdRange = plain.match(/(\d{1,2}\/\d{1,2})\s*[-~]\s*(\d{1,2}\/\d{1,2})/);
  if (mdRange && defaultYear) {
    const year = plain.match(/(20\d{2})/)?.[1] || defaultYear;
    const [sm, sd] = mdRange[1].split('/');
    const [em, ed] = mdRange[2].split('/');
    return {
      start: `${year}/${sm.padStart(2, '0')}/${sd.padStart(2, '0')}`,
      end: `${year}/${em.padStart(2, '0')}/${ed.padStart(2, '0')}`,
      source: 'text',
      confidence: 'medium',
    };
  }

  // 7月 - 8月 / 7月1日-8月31日
  const monthRange = plain.match(/(\d{1,2})\s*月\s*(?:\d{1,2}\s*日)?\s*[-~至到]\s*(\d{1,2})\s*月\s*(?:(\d{1,2})\s*日)?/);
  if (monthRange && defaultYear) {
    const sm = monthRange[1].padStart(2, '0');
    const em = monthRange[2].padStart(2, '0');
    const start = `${defaultYear}/${sm}/01`;
    const endDay = monthRange[3]
      ? monthRange[3].padStart(2, '0')
      : String(lastDayOfMonth(defaultYear, Number(monthRange[2]))).padStart(2, '0');
    const end = `${defaultYear}/${em}/${endDay}`;
    return { start, end, source: 'text', confidence: 'medium' };
  }

  // Single dates only - lower confidence
  const singles = [...plain.matchAll(/20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2}/g)].map((x) => x[0]);
  if (singles.length >= 2) {
    const parsed = parsePeriodFromMatch(singles[0], singles[singles.length - 1]);
    if (parsed) return { ...parsed, source: 'text', confidence: 'low' };
  }
  if (singles.length === 1) {
    return { start: normalizeDatePart(singles[0]), end: '', source: 'text', confidence: 'partial' };
  }

  return null;
}

export function extractDatesFromRaw(raw, slug) {
  if (!raw || typeof raw !== 'object') return null;
  const chunks = [];
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) return obj.forEach(walk);
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim()) {
        if (/description|title|notice|subtitle|content|text|date|period/i.test(k) || v.length < 500) {
          chunks.push(v);
        }
      } else if (typeof v === 'object') walk(v);
    }
  }
  walk(raw);
  return extractDatesFromText(chunks.join('\n'), { slug, defaultYear: inferYearFromSlug(slug) });
}

export function collectImageUrls(raw, extra = {}) {
  const urls = new Set();
  const text = JSON.stringify(raw || {});
  const re = /https:\/\/prod-s3\.pxpayplus\.com\/[^"\\]+\.(?:png|jpg|jpeg|webp)/gi;
  let m;
  while ((m = re.exec(text))) urls.add(m[0]);
  if (extra.bannerUrl) urls.add(extra.bannerUrl);
  return [...urls];
}

export function buildPeriod(apiStart, apiEnd, textSources, raw, opts = {}) {
  if (apiStart && apiEnd) {
    return {
      ...parsePeriodStatus(apiStart, apiEnd),
      periodSource: 'api',
      needsOcr: false,
      ocrImageUrls: [],
    };
  }

  const combined = textSources.filter(Boolean).join('\n');
  const inferred = extractDatesFromText(combined, opts);
  const imageUrls = collectOcrImageUrls(opts.slug || '', raw, opts);

  if (inferred?.start && inferred?.end) {
    return {
      ...parsePeriodStatus(inferred.start, inferred.end),
      periodSource: inferred.source,
      periodConfidence: inferred.confidence,
      needsOcr: false,
      ocrImageUrls: imageUrls.slice(0, 5),
    };
  }

  if (inferred?.start && !inferred?.end) {
    return {
      start: inferred.start,
      end: '',
      status: 'unknown',
      periodSource: 'text',
      periodConfidence: 'partial',
      needsOcr: imageUrls.length > 0,
      ocrImageUrls: imageUrls.slice(0, 5),
    };
  }

  return {
    start: '',
    end: '',
    status: 'unknown',
    periodSource: 'unknown',
    periodConfidence: 'none',
    needsOcr: imageUrls.length > 0,
    ocrImageUrls: imageUrls.slice(0, 8),
  };
}

function parsePeriodStatus(start, end) {
  const s = start ? new Date(start.replace(/\//g, '-')) : null;
  const e = end ? new Date(end.replace(/\//g, '-')) : null;
  const now = new Date();
  let status = 'unknown';
  if (s && e && !Number.isNaN(s) && !Number.isNaN(e)) {
    if (now < s) status = 'upcoming';
    else if (now > e) status = 'ended';
    else status = 'active';
  } else if (s && !Number.isNaN(s) && !e) {
    status = now > s ? 'active' : 'upcoming';
  }
  return { start: start || '', end: end || '', status };
}
