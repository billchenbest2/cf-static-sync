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

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const isCurrent = (n) => {
    if (n.month === currentMonth) return true;
    if (!n.month && n.at) {
      const mm = n.at.match(/\/(\d{2})\//);
      return mm ? Number(mm[1]) === currentMonth : false;
    }
    return !n.month && !n.at;
  };
  const currentMonthFull = notices.some(isCurrent);
  const primary = notices.find(isCurrent) || notices[0];
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
    note: notices.map((n) => n.note).join('；'),
    notices,
  };
}

export function quotaFromActivity(activity) {
  if (activity?.quotaFull?.full) return activity.quotaFull;
  return parseQuotaFull(
    activity?.title,
    activity?.searchText,
    activity?.raw?.text,
    ...(activity?.rewards || []).map((r) => `${r.label || ''} ${r.detail || ''}`)
  );
}
