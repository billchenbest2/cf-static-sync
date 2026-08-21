/**
 * Score existing activities and escalate high-risk rows to stronger models.
 *
 *   node scripts/ai-escalate.mjs --dry-run
 *   node scripts/ai-escalate.mjs
 *   node scripts/ai-escalate.mjs --min-score=65
 *   node scripts/ai-escalate.mjs --platform easy
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isAiAvailable, aiExtractRewards } from './ai-extract.mjs';
import { scoreActivityRisk, tierNeedsEscalate, fallbackRewardsFromTitle } from './ai-risk.mjs';
import { delayForTier } from './ai-client.mjs';
import { quotaSnapshot } from './ai-quota.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PAY_DATA_DIR || path.join(__dirname, '..', 'data');

const PLATFORMS = [
  { key: 'easy', file: 'easy-activities.json', label: 'Easy' },
  { key: 'icash', file: 'icash-activities.json', label: 'icash' },
  { key: 'linepay', file: 'linepay-activities.json', label: 'LINE Pay' },
  { key: 'plus', file: 'plus-activities.json', label: 'PlusPay' },
  { key: 'jko', file: 'jko-activities.json', label: 'JKO' },
  { key: 'ipass', file: 'ipass-activities.json', label: 'iPASS' },
  { key: 'pxplus', file: 'activities.json', label: 'PX Pay' },
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const minScore = parseInt(args.find(a => a.startsWith('--min-score='))?.split('=')[1] || '45', 10);
const platformFilter = args.find(a => a.startsWith('--platform='))?.split('=')[1]
  || (args.indexOf('--platform') >= 0 ? args[args.indexOf('--platform') + 1] : null);

function collectTargets() {
  const targets = [];
  const bands = { lite: 0, gemma: 0, g3: 0, g35: 0, g36: 0, g37: 0 };
  const files = [];

  for (const plat of PLATFORMS) {
    if (platformFilter && plat.key !== platformFilter) continue;
    const filePath = path.join(DATA_DIR, plat.file);
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    files.push({ plat, filePath, data });
    for (const act of (data.activities || []).filter(a => a.period?.status !== 'ended')) {
      const risk = scoreActivityRisk(act);
      act.aiRiskScore = risk.score;
      act.aiRiskReasons = risk.reasons;
      bands[risk.tier] = (bands[risk.tier] || 0) + 1;
      if (act.manualFixedAt) continue;
      if (!tierNeedsEscalate(risk.tier)) continue;
      if (risk.score < minScore) continue;
      if (act.aiEscalatedAt && !args.includes('--force')) continue;
      targets.push({ plat, data, act, risk, filePath });
    }
  }
  return { targets, bands, files };
}

async function main() {
  const { targets, bands, files } = collectTargets();
  console.log('Risk bands (active):', bands);
  console.log(`Escalate queue (score>=${minScore}, skip manual/already-escalated): ${targets.length}`);
  for (const t of targets) {
    console.log(`  [${t.risk.score} ${t.risk.tier}] ${t.act.title?.slice(0, 42)}`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] no API calls');
    return;
  }
  if (!isAiAvailable()) {
    console.error('Missing GEMINI_API_KEY');
    process.exit(1);
  }

  const touched = new Set();
  let ok = 0;
  let fail = 0;

  for (const { plat, act, risk } of targets) {
    const bodyText = String(act.raw?.text || act.title || '');
    console.log(`\n[${plat.label}] ${act.title?.slice(0, 42)}`);
    console.log(`  risk ${risk.score} ${risk.reasons.join(',')} → ${risk.tier}`);

    let result = await aiExtractRewards(act.title, bodyText, plat.label, { tier: risk.tier, verbose: true });
    if (!result) {
      fail++;
      act.aiNeedsReview = true;
      console.log('  FAIL');
      await new Promise(r => setTimeout(r, delayForTier(risk.tier)));
      continue;
    }

    const noPct = (act.rewards || []).filter(r => !r.pct || r.pct <= 0);
    let next = result.rewards.length ? result.rewards : fallbackRewardsFromTitle(act.title);
    if (!result.rewards.length && next.length) act.aiNeedsReview = true;
    act.rewards = next.length ? [...next, ...noPct] : noPct;
    const risk2 = scoreActivityRisk(act);
    act.aiRiskScore = risk2.score;
    act.aiRiskReasons = risk2.reasons;
    act.aiModel = result.model;
    act.aiEscalatedAt = new Date().toISOString();
    act.aiNeedsReview = risk2.score >= 70;
    act.aiVerifiedAt = act.aiEscalatedAt;
    touched.add(plat.file);
    ok++;
    const rs = act.rewards.filter(r => r.pct > 0);
    console.log(`  ${result.model} → ${rs.length ? rs.map(r => r.pct + '%').join(', ') : '(none)'} (risk now ${risk2.score})`);
    await new Promise(r => setTimeout(r, result.delayMs));
  }

  for (const { plat, filePath, data } of files) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    if (touched.has(plat.file)) console.log(`saved data/${plat.file}`);
  }

  console.log(`\nDone: ok=${ok} fail=${fail}`);
  console.log('Quota:', JSON.stringify(quotaSnapshot()));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
