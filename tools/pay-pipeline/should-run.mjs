/**
 * Decide whether a scheduled pay-pipeline run should proceed (Asia/Taipei).
 *
 * Allowed days: every 5 calendar days (day-of-month 1, 6, 11, 16, 21, 26).
 *
 * Cron fires daily at 16:30 UTC (~00:30 Taipei next day). This gate only
 * checks the Taipei calendar day — not hour/minute — because GitHub Actions
 * schedules are often delayed by several hours; a tight 00:30+/-20 window
 * caused every scheduled run to soft-skip for weeks.
 *
 * Usage: node tools/pay-pipeline/should-run.mjs
 * Exit 0 = run, 78 = skip (soft), 1 = error
 */
const args = process.argv.slice(2);
const force = args.includes('--force') || process.env.PAY_PIPELINE_FORCE === '1';

/** Days of month for the every-5-days cadence (1, 6, 11, 16, 21, 26). */
const CADENCE_DAYS = new Set([1, 6, 11, 16, 21, 26]);

function taipeiNow() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function onCadenceDay(t) {
  return CADENCE_DAYS.has(t.day);
}

const t = taipeiNow();
const stamp = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} Taipei`;

if (force) {
  console.log(`[should-run] FORCE — proceed (${stamp})`);
  process.exit(0);
}

if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
  console.log(`[should-run] workflow_dispatch — proceed (${stamp})`);
  process.exit(0);
}

if (onCadenceDay(t)) {
  console.log(`[should-run] every-5-days cadence day — proceed (${stamp})`);
  process.exit(0);
}

console.log(`[should-run] outside every-5-days cadence days — skip (${stamp})`);
process.exit(78);
