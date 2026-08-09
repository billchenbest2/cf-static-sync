/** Taiwan gas billing week (Mon–Sun, Asia/Taipei) stale helper for build scripts. */
const TZ = 'Asia/Taipei';

function taipeiYmdFromDate(date) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function ymdToUtcDate(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d));
}

function weekdayMon0(y, m, d) {
  const w = ymdToUtcDate(y, m, d).getUTCDay();
  return w === 0 ? 6 : w - 1;
}

function addDays(y, m, d, delta) {
  const dt = ymdToUtcDate(y, m, d);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function weekKeyFromYmd(y, m, d) {
  const mon0 = weekdayMon0(y, m, d);
  const mon = addDays(y, m, d, -mon0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${mon.y}-${pad(mon.m)}-${pad(mon.d)}`;
}

function weekKeyFromIso(iso) {
  const ts = Date.parse(String(iso || ''));
  if (!Number.isFinite(ts)) return '';
  const t = taipeiYmdFromDate(new Date(ts));
  return weekKeyFromYmd(t.y, t.m, t.d);
}

function currentTaipeiWeekKey() {
  const t = taipeiYmdFromDate(new Date());
  return weekKeyFromYmd(t.y, t.m, t.d);
}

export function isReportWeekStale(reportedAt) {
  const rk = weekKeyFromIso(reportedAt);
  if (!rk) return true;
  return rk !== currentTaipeiWeekKey();
}
