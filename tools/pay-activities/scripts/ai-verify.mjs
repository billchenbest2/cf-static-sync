/**
 * ai-verify.mjs
 * 用高階模型抽樣驗證低階模型補完結果的準確率
 *
 * 用法：
 *   node scripts/ai-verify.mjs              # 每平台抽3筆，用 gemini-3.5-flash
 *   node scripts/ai-verify.mjs --sample 5   # 每平台抽5筆
 *   node scripts/ai-verify.mjs --platform easy  # 只抽某平台
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 載入 .env
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const API_KEY = process.env.GEMINI_API_KEY || '';
// 驗證用模型優先序（自動 fallback）
const VERIFY_MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];
const DATA_DIR = process.env.PAY_DATA_DIR || path.join(__dirname, '..', 'data');

const PLATFORMS = [
  { key: 'easy',    file: 'easy-activities.json',    label: '悠遊付' },
  { key: 'icash',   file: 'icash-activities.json',   label: 'icash Pay' },
  { key: 'linepay', file: 'linepay-activities.json', label: 'LINE Pay' },
  { key: 'plus',    file: 'plus-activities.json',    label: '全盈+PAY' },
  { key: 'jko',     file: 'jko-activities.json',     label: '街口支付' },
  { key: 'ipass',   file: 'ipass-activities.json',   label: 'iPASS MONEY' },
  { key: 'pxplus',  file: 'activities.json',         label: '全支付' },
];

const args = process.argv.slice(2);
const sampleN = parseInt(args.find((a, i) => args[i - 1] === '--sample') || '3');
const platformFilter = args.find(a => a.startsWith('--platform='))?.split('=')[1]
  || (args.indexOf('--platform') >= 0 ? args[args.indexOf('--platform') + 1] : null);

// 目前使用的模型（自動 fallback）
let currentModelIdx = 0;

async function callApi(prompt) {
  while (currentModelIdx < VERIFY_MODELS.length) {
    const model = VERIFY_MODELS[currentModelIdx];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: 'You are a JSON extractor for Taiwan mobile payment promotions. Output ONLY a valid JSON array. No explanation, no markdown. Role must be: base, card, account, or other.' }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (res.status === 429) {
        console.log(`  ⚠️  ${model} 配額用完，切換到下一個模型...`);
        currentModelIdx++;
        continue;
      }
      if (!res.ok) {
        console.log(`  ⚠️  ${model} 錯誤 ${res.status}，切換...`);
        currentModelIdx++;
        continue;
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      // 目前使用模型標示
      return { text, model };
    } catch (e) {
      console.log(`  ⚠️  ${model} timeout，切換...`);
      currentModelIdx++;
    }
  }
  return null;
}

function extractJson(text) {
  const codeBlock = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (codeBlock) return codeBlock[1];
  const arrMatch = [...text.matchAll(/(\[(?:[^\[\]]|\[(?:[^\[\]]|\[[^\[\]]*\])*\])*\])/g)];
  return arrMatch.length > 0 ? arrMatch[arrMatch.length - 1][1] : null;
}

function compareRewards(original, verified) {
  // 比較原始補完結果 vs 驗證結果
  const origPcts = original.map(r => r.pct).sort((a, b) => a - b);
  const verPcts = verified.map(r => r.pct).filter(p => p > 0).sort((a, b) => a - b);

  if (origPcts.length === 0 && verPcts.length === 0) return { match: true, type: 'both_empty' };
  if (origPcts.length === 0 && verPcts.length > 0) return { match: false, type: 'missed' };
  if (origPcts.length > 0 && verPcts.length === 0) return { match: false, type: 'false_positive' };

  // 檢查是否有相同的主要回饋%
  const origSet = new Set(origPcts.map(p => Math.round(p * 10)));
  const verSet = new Set(verPcts.map(p => Math.round(p * 10)));
  const overlap = [...origSet].filter(p => verSet.has(p));
  const matchRate = overlap.length / Math.max(origSet.size, verSet.size);

  return { match: matchRate >= 0.5, type: 'partial', matchRate, origPcts, verPcts };
}

async function main() {
  if (!API_KEY) { console.error('未設定 GEMINI_API_KEY'); process.exit(1); }

  console.log('🔍 AI 抽樣驗證工具');
  console.log(`  驗證模型優先序：${VERIFY_MODELS.join(' → ')}`);
  console.log(`  每平台抽樣：${sampleN} 筆\n`);

  const targets = platformFilter
    ? PLATFORMS.filter(p => p.key === platformFilter)
    : PLATFORMS;

  let totalChecked = 0, totalMatch = 0;

  for (const plat of targets) {
    const filePath = path.join(DATA_DIR, plat.file);
    if (!fs.existsSync(filePath)) continue;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // 只抽有 rewards 的活動
    const withRewards = (data.activities || []).filter(
      a => a.period?.status !== 'ended' && (a.rewards || []).some(r => r.pct > 0)
    );

    if (withRewards.length === 0) {
      console.log(`=== ${plat.label}：無有效回饋資料，跳過 ===\n`);
      continue;
    }

    // 隨機抽樣
    const shuffled = [...withRewards].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, Math.min(sampleN, shuffled.length));

    console.log(`=== ${plat.label}（抽樣 ${sample.length}/${withRewards.length} 筆）===`);

    let platMatch = 0;
    for (const a of sample) {
      const origRewards = (a.rewards || []).filter(r => r.pct > 0);
      const bodyText = String(a.raw?.text || a.rewards?.map(r => r.detail).join('。') || '').slice(0, 2000);

      const prompt = `Extract reward percentages from this ${plat.label} activity. Output JSON array: [{"label":"...","pct":number,"role":"base|card|account|other","detail":"..."}]

Title: ${a.title}
Content: ${bodyText}`;

      process.stdout.write(`  「${a.title?.slice(0, 35)}」... `);
      const result = await callApi(prompt);
      if (!result) { console.log('(所有模型失敗)'); continue; }

      let verified = [];
      try {
        const jsonStr = extractJson(result.text) || result.text;
        verified = JSON.parse(jsonStr).filter(r => r.pct > 0 && r.pct <= 100);
      } catch (e) { /* ignore */ }

      const cmp = compareRewards(origRewards, verified);
      const modelTag = `[${result.model.replace('gemini-', '')}]`;

      if (cmp.match) {
        platMatch++;
        totalMatch++;
        console.log(`✅ ${modelTag} 一致 (原:${origRewards.map(r => r.pct + '%').join('+')} 驗:${verified.map(r => r.pct + '%').join('+')})`);
      } else {
        console.log(`❌ ${modelTag} 不一致`);
        console.log(`     原始：${origRewards.map(r => `${r.pct}%(${r.role})`).join(', ')}`);
        console.log(`     驗證：${verified.map(r => `${r.pct}%(${r.role})`).join(', ') || '(無%)'}`);
      }

      totalChecked++;
      await new Promise(r => setTimeout(r, 4500));
    }

    console.log(`  平台準確率：${platMatch}/${sample.length} (${Math.round(platMatch / sample.length * 100)}%)\n`);
  }

  console.log(`\n📊 總體準確率：${totalMatch}/${totalChecked} (${Math.round(totalMatch / totalChecked * 100)}%)`);
  console.log(`  使用模型：${VERIFY_MODELS[currentModelIdx] || VERIFY_MODELS[VERIFY_MODELS.length - 1]}`);
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
