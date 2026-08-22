/**
 * One-shot: restore JKO periods wiped by empty listPeriod cache merge,
 * and icash dates using "起至" wording. UTF-8 safe via Node.
 *
 * Usage:
 *   node tools/pay-pipeline/repair-jko-periods.mjs [dir ...]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { coalescePeriod, periodHasDates } from '../pay-activities/scripts/activity-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pad2(n) {
  return String(n).padStart(2, '0');
}
function ymd(y, m, d) {
  return `${y}/${pad2(m)}/${pad2(d)}`;
}

function parseTextRange(text) {
  const s = String(text || '').replace(/\./g, '/');
  const patterns = [
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-~～]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/,
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-~～]\s*(\d{1,2})\/(\d{1,2})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const sy = Number(m[1]);
    const sm = Number(m[2]);
    const sd = Number(m[3]);
    if (m.length >= 7) {
      return { start: ymd(sy, sm, sd), end: ymd(Number(m[4]), Number(m[5]), Number(m[6])) };
    }
    let ey = sy;
    const em = Number(m[4]);
    const ed = Number(m[5]);
    if (em < sm) ey += 1;
    return { start: ymd(sy, sm, sd), end: ymd(ey, em, ed) };
  }
  return { start: null, end: null };
}

function parseBodyRange(body) {
  const s = String(body || '');
  const chunks = s.split(/(?=活動時間|活動期間|累積消費金額時間)/);
  for (const c of chunks) {
    const t = c.trim();
    if (!/^(活動時間|活動期間|累積消費金額時間)/.test(t)) continue;
    const hit = parseTextRange(t.slice(0, 120));
    if (hit.start && hit.end) return hit;
  }
  return { start: null, end: null };
}

function buildPeriod(start, end) {
  const now = new Date();
  let status = 'unknown';
  if (start && end) {
    const s = new Date(start.replace(/\//g, '-'));
    const e = new Date(end.replace(/\//g, '-') + 'T23:59:59');
    if (now < s) status = 'upcoming';
    else if (now > e) status = 'ended';
    else status = 'active';
  } else if (end) {
    const e = new Date(end.replace(/\//g, '-') + 'T23:59:59');
    status = now > e ? 'ended' : 'active';
  }
  return { start: start || null, end: end || null, status };
}

function enrichJkoPeriod(act) {
  if (act.period?.start && act.period?.end) return null;
  const shortFields = [act.title, act.raw?.subtitle, act.raw?.listTitle].filter(Boolean);
  for (const part of shortFields) {
    const hit = parseTextRange(part);
    if (hit.start && hit.end) return buildPeriod(hit.start, hit.end);
  }
  const fromFocus = parseBodyRange(act.raw?.text || '');
  if (fromFocus.start && fromFocus.end) {
    return buildPeriod(act.period?.start || fromFocus.start, act.period?.end || fromFocus.end);
  }
  return null;
}

function parseIcashDates(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const m = s.match(
    /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*[－\-~～]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/
  );
  if (m) {
    return {
      start: ymd(+m[1], +m[2], +m[3]),
      end: ymd(+m[4], +m[5], +m[6]),
    };
  }
  const qi = s.match(
    /(?:自)?(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*(?:起)?\s*(?:至|到)\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/
  );
  if (qi) {
    return {
      start: ymd(+qi[1], +qi[2], +qi[3]),
      end: ymd(+qi[4], +qi[5], +qi[6]),
    };
  }
  return null;
}

function repairFile(filePath, kind) {
  if (!fs.existsSync(filePath)) {
    console.log('skip missing', filePath);
    return;
  }
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let n = 0;
  for (const act of payload.activities || []) {
    if (kind === 'jko') {
      const next = enrichJkoPeriod(act);
      if (!next) continue;
      act.period = next;
      n++;
      console.log('  jko', act.id, next.start, next.end, next.status);
    } else if (kind === 'icash') {
      if (act.period?.start && act.period?.end) continue;
      const d = parseIcashDates(act.raw?.text || '');
      if (!d) continue;
      act.period = buildPeriod(d.start, d.end);
      n++;
      console.log('  icash', act.id, act.period);
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`repaired ${kind}: ${n} -> ${filePath}`);
}

// smoke coalesce
{
  const prev = { start: '2026/07/01', end: '2026/09/30', status: 'active' };
  const empty = { start: null, end: null, status: 'unknown' };
  const got = coalescePeriod(empty, prev);
  if (!periodHasDates(got) || got.start !== prev.start) {
    console.error('coalescePeriod smoke failed', got);
    process.exit(1);
  }
  console.log('coalescePeriod ok');
}

const dirs = process.argv.slice(2);
const defaults = [
  path.resolve(__dirname, '../../data/pay'),
  path.resolve(__dirname, '../../../../pay'),
];
const targets = dirs.length ? dirs : defaults.filter((d) => fs.existsSync(d));

for (const dir of targets) {
  console.log('\n==', dir);
  repairFile(path.join(dir, 'jko-activities.json'), 'jko');
  repairFile(path.join(dir, 'icash-activities.json'), 'icash');
}
