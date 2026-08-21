/**
 * ai-backfill.mjs
 * 對現有所有平台資料跑 AI 補完缺少的回饋%
 *
 * 用法：
 *   node scripts/ai-backfill.mjs              # 補全所有平台
 *   node scripts/ai-backfill.mjs --platform easy  # 只補某個平台
 *   node scripts/ai-backfill.mjs --dry-run        # 只預覽，不寫檔
 *   node scripts/ai-backfill.mjs --force --no-skip  # 新 prompt 全量重跑（含已 aiVerifiedAt）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isAiAvailable, aiExtractBatch } from './ai-extract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PAY_DATA_DIR || path.join(__dirname, '..', 'data');

const PLATFORMS = [
  { key: 'easy',     file: 'easy-activities.json',     label: '悠遊付' },
  { key: 'icash',    file: 'icash-activities.json',    label: 'icash Pay' },
  { key: 'linepay',  file: 'linepay-activities.json',  label: 'LINE Pay' },
  { key: 'plus',     file: 'plus-activities.json',     label: '全盈+PAY' },
  { key: 'jko',      file: 'jko-activities.json',      label: '街口支付' },
  { key: 'ipass',    file: 'ipass-activities.json',    label: 'iPASS MONEY' },
  { key: 'pxplus',   file: 'activities.json',          label: '全支付' },
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');           // 強制重新判讀全部（含已有%）
const skipVerified = !args.includes('--no-skip'); // 預設跳過已有 aiVerifiedAt 的
const platformFilter = args.find(a => a.startsWith('--platform='))?.split('=')[1]
  || (args.indexOf('--platform') >= 0 ? args[args.indexOf('--platform') + 1] : null);

async function main() {
  if (!isAiAvailable()) {
    console.error('\n❌ 未設定 GEMINI_API_KEY！');
    console.error('請在 pxplus-activities/.env 填入你的 Google AI Studio API Key：');
    console.error('  GEMINI_API_KEY=AIza...\n');
    console.error('取得 Key：https://aistudio.google.com/app/apikey');
    process.exit(1);
  }

  console.log('🤖 AI 回饋補完工具（Gemini Flash）');
  if (dryRun) console.log('  [DRY RUN 模式 - 不會寫入檔案]');
  if (force) console.log('  [FORCE 模式 - 全部重新判讀，含已有%的活動]');
  if (skipVerified) console.log('  [跳過已有 aiVerifiedAt 的活動]');
  console.log('');

  const targets = platformFilter
    ? PLATFORMS.filter(p => p.key === platformFilter)
    : PLATFORMS;

  if (!targets.length) {
    console.error('找不到平台：' + platformFilter);
    process.exit(1);
  }

  let grandFixed = 0;

  for (const plat of targets) {
    const filePath = path.join(DATA_DIR, plat.file);
    if (!fs.existsSync(filePath)) {
      console.log(`跳過 ${plat.label}（找不到 ${plat.file}）`);
      continue;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const active = (data.activities || []).filter(a => a.period?.status !== 'ended');
    const missing = active.filter(a => !(a.rewards || []).some(r => r.pct > 0));
    const unverified = active.filter(a => !a.aiVerifiedAt);

    if (force) {
      const toRun = skipVerified ? unverified.length : active.length;
      console.log(`=== ${plat.label} (${toRun}/${active.length} 筆待判讀) ===`);
    } else {
      console.log(`=== ${plat.label} (${missing.length}/${active.length} 筆缺少%) ===`);
    }

    if (!force && missing.length === 0) {
      console.log('  ✅ 全部已有回饋%\n');
      continue;
    }
    if (force && skipVerified && unverified.length === 0) {
      console.log('  ✅ 全部已驗證\n');
      continue;
    }

    const { fixed, processed } = await aiExtractBatch(active, plat.label, {
      delayMs: 4500,
      onlyMissing: !force,
      force,
      skipVerified,
      verbose: true,
      onProgress: dryRun
        ? null
        : async (_act, stats) => {
            // Checkpoint every activity so interrupted runs keep progress
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            if (stats.processed % 10 === 0) {
              console.log(`  …checkpoint ${stats.processed} 筆已寫入`);
            }
          },
    });

    grandFixed += fixed;

    if (!dryRun && processed > 0) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`  ✅ 已寫入 data/${plat.file}`);
    }
    console.log(`  共補完 ${fixed} 筆\n`);
  }

  console.log(`🎉 完成！總共補完 ${grandFixed} 筆活動的回饋%`);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
