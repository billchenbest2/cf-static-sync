/**
 * Parse official "quota full" (額滿) announcements from activity titles/copy.
 * Matches notices like:
 *   [ 8 月份回饋上限已於 2026/8/3 16:30 額滿 ]
 *   [優惠二回饋已於 2026/6/18 14:00 額滿 ]
 * Does not match future warnings such as 「額滿將公告」 or 「是否已額滿」.
 */

const FULL_RE =
  /(?:[\[【(（]\s*)?(優惠[一二三四五六七八九十0-9]+)?(?:(\d{1,2})\s*月份?)?(?:回饋上限|回饋|活動贈點)?已於\s*(\d{4})\s*[\/.\-年]\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})(?:日)?(?:\s*\([^)]{0,12}\))?(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?[^\n\]】]*?額滿/g;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isCurrentMonthNotice(n, currentMonth) {
  if (n.month === currentMonth) return true;
  if (!n.month && n.at) {
    const mm = String(n.at).match(/\/(\d{2})\//);
    return mm ? Number(mm[1]) === currentMonth : false;
  }
  return !n.month && !n.at;
}

/** Build / refresh quotaFull fields from parsed notices using wall-clock "now". */
export function labelQuotaNotices(notices, now = new Date()) {
  if (!Array.isArray(notices) || !notices.length) return null;
  const currentMonth = now.getMonth() + 1;
  const currentMonthFull = notices.some((n) => isCurrentMonthNotice(n, currentMonth));
  const primary = notices.find((n) => isCurrentMonthNotice(n, currentMonth)) || notices[0];
  let label = '已額滿';
  if (currentMonthFull) {
    label = primary.month ? `本月已額滿（${primary.month}月）` : '本月已額滿';
  } else if (primary.portion) {
    label = `${primary.portion}已額滿`;
  } else if (primary.month) {
    label = `${primary.month}月已額滿`;
  } else {
    label = '已額滿';
  }
  return {
    full: true,
    currentMonthFull,
    month: primary.month,
    at: primary.at,
    portion: primary.portion,
    label,
    note: notices.map((n) => n.note).filter(Boolean).join('；'),
    notices,
  };
}

export function parseQuotaFull(...parts) {
  const blob = parts
    .map((p) => (typeof p === 'string' ? p : ''))
    .filter(Boolean)
    .join('\n');
  if (!blob || !blob.includes('額滿')) return null;

  const notices = [];
  const seen = new Set();
  let m;
  FULL_RE.lastIndex = 0;
  while ((m = FULL_RE.exec(blob))) {
    const portion = (m[1] || '').trim() || null;
    const monthFromText = m[2] ? Number(m[2]) : null;
    const year = Number(m[3]);
    const month = monthFromText || Number(m[4]);
    const day = Number(m[5]);
    const time = m[6] || null;
    const at = `${year}/${pad2(month)}/${pad2(day)}${time ? ` ${time}` : ''}`;
    const key = `${portion || ''}|${month}|${at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notices.push({ portion, month, at, note: m[0].replace(/^[\[【(（]\s*|[\]】)）]\s*$/g, '').trim() });
  }

  if (!notices.length) return null;
  return labelQuotaNotices(notices);
}

export function quotaFromActivity(activity) {
  const parsed = parseQuotaFull(
    activity?.title,
    activity?.searchText,
    activity?.raw?.text,
    activity?.quotaFull?.note,
    ...(activity?.rewards || []).map((r) => `${r.label || ''} ${r.detail || ''}`)
  );
  if (parsed) {
    if (activity?.quotaFull?.source) parsed.source = activity.quotaFull.source;
    return parsed;
  }

  // Coupon / API quota (e.g. JKO remaining=0) — not calendar-month notices.
  if (activity?.quotaFull?.full && activity.quotaFull.source) {
    return activity.quotaFull;
  }

  // Fallback: re-label from stored notices — never trust a frozen currentMonthFull.
  if (activity?.quotaFull?.notices?.length) {
    return labelQuotaNotices(activity.quotaFull.notices);
  }

  return null;
}
