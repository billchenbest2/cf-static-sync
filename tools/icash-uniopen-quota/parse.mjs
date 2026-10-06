/**
 * Parse icash Pay uniopen +4% quota-full notices from activity HTML/text.
 * Handles tag-split years like: 2026</span>...年8月
 */

const FULL_RE =
  /(\d{4})\s*年\s*(\d{1,2})\s*月[\s\S]{0,160}?活動贈點已於\s*(\d{4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:日)?(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?\s*額滿/g;

const LEGACY_CLOSED_RE = /data-closed-text\s*=\s*["']\s*(\d+)月回饋已額滿\s*["']/g;
const LEGACY_PAREN_RE = /[\(（](\d+)月份活動贈點已於([^)）]*)額滿/g;

export function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * @param {string} htmlOrText
 * @param {{ now?: Date, activityKey?: string, sourceUrl?: string }} [opts]
 */
export function parseIcashUniopenQuota(htmlOrText, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const text = stripHtml(htmlOrText);
  const fullMonths = {};

  if (text) {
    FULL_RE.lastIndex = 0;
    let m;
    while ((m = FULL_RE.exec(text))) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const atYear = Number(m[3]);
      const atMonth = Number(m[4]);
      const atDay = Number(m[5]);
      const time = m[6] || null;
      if (!year || !month || month < 1 || month > 12) continue;
      const at = `${atYear}/${atMonth}/${atDay}${time ? ` ${time}` : ''}`;
      const key = String(month);
      const prev = fullMonths[key];
      if (!prev || String(prev.at || '') < at) {
        fullMonths[key] = { year, at };
      }
      // Prefer year from the "YYYY年M月" label when present
      if (prev && prev.year !== year && atMonth === month) {
        fullMonths[key] = { year, at };
      }
    }
  }

  const raw = typeof htmlOrText === 'string' ? htmlOrText : '';
  for (const m of raw.matchAll(LEGACY_CLOSED_RE)) {
    const month = Number(m[1]);
    if (!month) continue;
    const key = String(month);
    if (!fullMonths[key]) {
      fullMonths[key] = { year: now.getFullYear(), at: null };
    }
  }
  for (const m of raw.matchAll(LEGACY_PAREN_RE)) {
    const month = Number(m[1]);
    if (!month) continue;
    const key = String(month);
    const detail = String(m[2] || '').trim();
    const timeMatch = detail.match(/(\d{4}\s*[\/.\-]\s*\d{1,2}\s*[\/.\-]\s*\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/);
    let at = null;
    if (timeMatch) {
      const d = timeMatch[1].replace(/\s+/g, '').replace(/[.\-]/g, '/');
      at = `${d}${timeMatch[2] ? ` ${timeMatch[2]}` : ''}`;
    }
    if (!fullMonths[key] || (at && !fullMonths[key].at)) {
      fullMonths[key] = { year: now.getFullYear(), at };
    }
  }

  const taipei = taipeiParts(now);
  const monthKey = String(taipei.month);
  const entry = fullMonths[monthKey];
  const currentFull = !!(entry && Number(entry.year) === taipei.year);

  return {
    activityKey: opts.activityKey || 'uniopen_icash_pay_4pct',
    sourceUrl: opts.sourceUrl || null,
    updatedAt: now.toISOString(),
    lastCheckedAt: now.toISOString(),
    fullMonths,
    current: {
      year: taipei.year,
      month: taipei.month,
      full: currentFull,
      at: currentFull ? entry.at || null : null,
    },
  };
}

export function taipeiParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Interval hours for Taipei day-of-month (1–15 crawl window). */
export function cadenceHoursForDay(day) {
  if (day >= 1 && day <= 3) return 12;
  if (day >= 4 && day <= 8) return 3;
  if (day >= 9 && day <= 15) return 6;
  return null;
}

/**
 * Whether the status file already records current Taipei month as full.
 * @param {object|null} status
 * @param {{ year: number, month: number }} taipei
 */
export function hasCurrentMonthFull(status, taipei) {
  if (!status || typeof status !== 'object') return false;
  const key = String(taipei.month);
  const entry = status.fullMonths?.[key];
  if (!entry) return false;
  return Number(entry.year) === Number(taipei.year);
}
