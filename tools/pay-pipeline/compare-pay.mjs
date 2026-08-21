/**
 * Compare two pay data directories (activity ids / status / reward counts).
 *
 *   node tools/pay-pipeline/compare-pay.mjs --a path/to/gold --b path/to/out
 *   node tools/pay-pipeline/compare-pay.mjs   # defaults: CardSwitch-main vs data/pay
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.join(__dirname, '..', '..');
const WORKSPACE = path.join(SYNC_ROOT, '..', '..');

const FILES = [
  'platforms.json',
  'search_aliases.json',
  'activities.json',
  'ipass-activities.json',
  'jko-activities.json',
  'easy-activities.json',
  'icash-activities.json',
  'plus-activities.json',
  'linepay-activities.json',
];

const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const dirA =
  argVal('--a') ||
  process.env.PAY_COMPARE_A ||
  path.join(WORKSPACE, 'CardSwitch-main', 'data', 'pay');
const dirB =
  argVal('--b') ||
  process.env.PAY_COMPARE_B ||
  path.join(SYNC_ROOT, 'data', 'pay');

function loadActs(dir, file) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return null;
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  const acts = Array.isArray(doc.activities) ? doc.activities : [];
  const byId = new Map(acts.map((a) => [a.id, a]));
  const status = {};
  for (const a of acts) {
    const s = a.period?.status || 'unknown';
    status[s] = (status[s] || 0) + 1;
  }
  return { acts, byId, status, meta: doc.meta || {} };
}

function rewardSig(a) {
  const rewards = Array.isArray(a.rewards) ? a.rewards : [];
  return rewards
    .map((r) => `${r.role || ''}:${r.label || ''}:${r.pct ?? ''}`)
    .sort()
    .join('|');
}

function contentSig(a) {
  const title = String(a.title || '');
  const start = a.period?.start || '';
  const end = a.period?.end || '';
  const text = String(a.raw?.text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
  return `${title}\n${start}\n${end}\n${a.url || ''}\n${text}\n${rewardSig(a)}`;
}

let totalDiff = 0;
console.log('compare-pay');
console.log('  A (gold):', dirA);
console.log('  B (out): ', dirB);

for (const file of FILES) {
  const a = loadActs(dirA, file);
  const b = loadActs(dirB, file);
  if (!a && !b) continue;
  if (!a || !b) {
    console.log(`\n[${file}] MISSING on ${!a ? 'A' : 'B'}`);
    totalDiff++;
    continue;
  }
  if (!file.endsWith('-activities.json') && file !== 'activities.json') {
    const same = fs.readFileSync(path.join(dirA, file), 'utf8') === fs.readFileSync(path.join(dirB, file), 'utf8');
    console.log(`\n[${file}] ${same ? 'identical' : 'DIFF text'}`);
    if (!same) totalDiff++;
    continue;
  }

  const onlyA = [...a.byId.keys()].filter((id) => !b.byId.has(id));
  const onlyB = [...b.byId.keys()].filter((id) => !a.byId.has(id));
  let statusMismatch = 0;
  let rewardMismatch = 0;
  let bodyMismatch = 0;
  const samples = [];
  for (const [id, aa] of a.byId) {
    const bb = b.byId.get(id);
    if (!bb) continue;
    const sa = aa.period?.status || 'unknown';
    const sb = bb.period?.status || 'unknown';
    if (sa !== sb) {
      statusMismatch++;
      if (samples.length < 5) samples.push(`status ${id}: ${sa} -> ${sb}`);
    }
    if (rewardSig(aa) !== rewardSig(bb)) {
      rewardMismatch++;
      if (samples.length < 8) samples.push(`rewards ${id}`);
    }
    if (contentSig(aa) !== contentSig(bb)) {
      bodyMismatch++;
    }
  }

  const ok =
    onlyA.length === 0 &&
    onlyB.length === 0 &&
    statusMismatch === 0 &&
    rewardMismatch === 0;
  console.log(`\n[${file}]`);
  console.log(`  counts A=${a.acts.length} B=${b.acts.length}`);
  console.log(`  status A=${JSON.stringify(a.status)} B=${JSON.stringify(b.status)}`);
  console.log(`  onlyA=${onlyA.length} onlyB=${onlyB.length} statusDiff=${statusMismatch} rewardDiff=${rewardMismatch} bodyDiff=${bodyMismatch}`);
  if (onlyA.length) console.log('  onlyA sample:', onlyA.slice(0, 5).join(', '));
  if (onlyB.length) console.log('  onlyB sample:', onlyB.slice(0, 5).join(', '));
  for (const s of samples) console.log('  ', s);
  if (!ok) totalDiff++;
}

console.log(`\nResult: ${totalDiff === 0 ? 'MATCH (ids/status/rewards)' : `DIFF files=${totalDiff}`}`);
process.exit(totalDiff === 0 ? 0 : 1);
