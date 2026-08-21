/**
 * Decide whether a scheduled pay-pipeline run should proceed (Asia/Taipei).
 *
 * Allowed windows:
 *   - day 1 @ ~00:30
 *   - day 1 @ ~12:30
 *   - day 2 @ ~00:30
 *
 * Cron candidates (UTC) in the workflow fire more often on month ends;
 * this gate keeps only the Taipei windows above.
 *
 * Usage: node tools/pay-pipeline/should-run.mjs
 * Exit 0 = run, 78 = skip (soft), 1 = error
 */
const args = process.argv.slice(2);
const force = args.includes('--force') || process.env.PAY_PIPELINE_FORCE === '1';

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

function inWindow(t) {
  // Allow +/- 20 minutes around :30 so delayed runners still pass.
  const near30 = Math.abs(t.minute - 30) <= 20;
  if (!near30) return false;
  if (t.day === 1 && (t.hour === 0 || t.hour === 12)) return true;
  if (t.day === 2 && t.hour === 0) return true;
  return false;
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

if (inWindow(t)) {
  console.log(`[should-run] scheduled window hit — proceed (${stamp})`);
  process.exit(0);
}

console.log(`[should-run] outside 1st 00:30/12:30 or 2nd 00:30 — skip (${stamp})`);
process.exit(78);
