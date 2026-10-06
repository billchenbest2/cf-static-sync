/**
 * Decide whether a scheduled icash uniopen quota crawl should proceed (Asia/Taipei).
 *
 * Rules:
 * - Only day 1–15
 * - Skip if status JSON already has current month full
 * - Cadence: 1–3 → 12h, 4–8 → 3h, 9–15 → 6h (vs lastCheckedAt / updatedAt)
 * - workflow_dispatch / --force always proceed
 *
 * Exit 0 = run, 78 = skip (soft), 1 = error
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cadenceHoursForDay,
  hasCurrentMonthFull,
  taipeiParts,
} from './parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_STATUS = path.join(SYNC_ROOT, 'data', 'cardswitch', 'icash-uniopen-quota.json');

const args = process.argv.slice(2);
const force = args.includes('--force') || process.env.ICASH_QUOTA_FORCE === '1';
const statusPath = process.env.ICASH_QUOTA_STATUS_PATH
  ? path.resolve(process.env.ICASH_QUOTA_STATUS_PATH)
  : DEFAULT_STATUS;

function loadStatus() {
  try {
    if (!fs.existsSync(statusPath)) return null;
    return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (60 * 60 * 1000);
}

const t = taipeiParts();
const stamp = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} Taipei`;
const status = loadStatus();

if (force) {
  console.log(`[should-run] FORCE — proceed (${stamp})`);
  process.exit(0);
}

if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
  console.log(`[should-run] workflow_dispatch — proceed (${stamp})`);
  process.exit(0);
}

if (t.day < 1 || t.day > 15) {
  console.log(`[should-run] outside day 1–15 window — skip (${stamp})`);
  process.exit(78);
}

if (hasCurrentMonthFull(status, t)) {
  console.log(`[should-run] current month already full — skip (${stamp})`);
  process.exit(78);
}

const needHours = cadenceHoursForDay(t.day);
if (needHours == null) {
  console.log(`[should-run] no cadence for day ${t.day} — skip (${stamp})`);
  process.exit(78);
}

const lastIso = status?.lastCheckedAt || status?.updatedAt || null;
const elapsed = hoursSince(lastIso);
if (elapsed < needHours - 0.25) {
  console.log(
    `[should-run] cadence ${needHours}h not reached (elapsed ${elapsed.toFixed(2)}h) — skip (${stamp})`,
  );
  process.exit(78);
}

console.log(
  `[should-run] day ${t.day} cadence ${needHours}h ok (elapsed ${elapsed === Infinity ? '∞' : elapsed.toFixed(2)}h) — proceed (${stamp})`,
);
process.exit(0);
