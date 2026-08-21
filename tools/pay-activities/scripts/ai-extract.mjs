/**
 * ai-extract.mjs
 * 使用 Google Gemini Flash 解析活動回饋資訊
 *
 * 使用前：在 pxplus-activities/.env 填入 GEMINI_API_KEY
 * 取得 Key：https://aistudio.google.com/app/apikey
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callTier, parseJsonArray, bodyLimitForTier, delayForTier } from './ai-client.mjs';
import { scoreActivityRisk, TIER_LITE, TIER_GEMMA, tierNeedsEscalate, fallbackRewardsFromTitle } from './ai-risk.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 載入 .env
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const API_KEY = process.env.GEMINI_API_KEY || '';
const DEFAULT_TIER = TIER_LITE;

export function isAiAvailable() {
  return !!API_KEY;
}

/**
 * 過濾固定金額券/折扣券被誤算為 % 的 reward
 */
/**
 * 從「X折」推算 AI 常誤換算的回饋%（9折→10、95折→5、97折→3…）
 */
function discountPctFromZhe(text) {
  const implied = [];
  for (const m of String(text || '').matchAll(/(\d+(?:\.\d+)?)\s*折/g)) {
    const n = Number(m[1]);
    if (n >= 10 && n <= 99) implied.push(100 - n);
    else if (n > 0 && n < 10) implied.push(Math.round((10 - n) * 10));
  }
  return implied;
}

export function filterCouponMisreadRewards(rewards, title = '', bodyText = '') {
  const ctx = `${title} ${bodyText}`;
  return (rewards || []).filter(r => {
    if (!r.pct || r.pct <= 0) return false;
    const text = `${ctx} ${r.label || ''} ${r.detail || ''}`;

    // 明確 %回饋 字樣 → 保留
    if (/\d+\s*%\s*(?:回饋|街口幣|點數|儲值金|悠遊幣|Fa點|OPENPOINT|LINE POINTS)/i.test(text)) return true;

    // 固定金額回饋（$N元）且無明確 % 字樣
    if (/回饋\s*[\$＄]\s*\d+|最高回饋\s*[\$＄]?\d+\s*元?|滿\s*[\$＄]?\d+.*(?:送|贈)\s*\d+\s*元/.test(text)
        && !/\d+\s*%\s*(?:回饋|街口幣|點數|儲值金)/i.test(text)) {
      return false;
    }

    if (r.pct >= 100) return false;
    if (/現金回饋券|優惠券|折抵券|禮券|贈券|領券|星意禮/.test(text) && r.pct >= 15) return false;

    // 打折/折數 → 禁止換算成回饋%（除非同句有明確 %回饋 字樣）
    const hasExplicitCashbackPct = /\d+\s*%\s*(?:回饋|街口幣|點數|儲值金|悠遊幣|Fa點|OPENPOINT|LINE POINTS|全點)/i.test(text);
    if (!hasExplicitCashbackPct) {
      const zhePct = discountPctFromZhe(text);
      if (zhePct.some(z => Math.abs(z - r.pct) <= 1.5)) return false;
      if (/\d+\s*折/.test(text) && /折優惠|打折|現折|滿.*折/.test(text)) return false;
    }

    if (/\d+\s*折/.test(text) && !/回饋|街口幣|點數|儲值金|悠遊幣|Fa點|OPENPOINT|LINE POINTS/i.test(text)) {
      if (r.pct >= 30) return false;
    }
    if (/抽獎|轉轉樂|幸運|開戶禮|滿額禮/.test(text) && !/\d+\s*%\s*(?:回饋|街口幣|點數|儲值金)/.test(text)) {
      if (r.pct >= 50) return false;
    }

    const giftMatch = text.match(/滿\s*(\d+)\s*元?.*(?:送|贈|折抵)\s*(\d+)\s*元/);
    if (giftMatch) {
      const implied = Math.round(Number(giftMatch[2]) / Number(giftMatch[1]) * 100);
      if (implied > 0 && Math.abs(implied - r.pct) <= 2) return false;
    }

    // 滿X元送Y元 / X台湾ドル→Y台湾ドル 贈品，禁止換算成回饋%（除非有明確 %回饋）
    if (!hasExplicitCashbackPct) {
      for (const m of text.matchAll(/(\d{2,5})\s*(?:台湾ドル|元|NT\$|\$|＄).{0,70}(\d{1,5})\s*(?:台湾ドル|元|NT\$|\$|＄|分)/g)) {
        const spend = Number(m[1]);
        const gift = Number(m[2]);
        if (spend >= 50 && gift > 0 && gift < spend) {
          const implied = Math.round(gift / spend * 1000) / 10;
          if (implied > 0 && Math.abs(implied - r.pct) <= 2
              && /プレゼント|贈|送|商品券|引換券|折抵券|券|禮/.test(text)) {
            return false;
          }
        }
      }
    }

    return true;
  });
}

function buildExtractPrompt(titleStr, body, platform) {

  const systemInstruction = `You extract CASHBACK/POINTS reward percentages from Taiwan mobile payment promotions.
Output ONLY a JSON array. No thinking, no explanation.
Role must be exactly: base, card, account, or other.

CRITICAL - DO NOT output pct for:
- Fixed-amount coupons (e.g. "100元現金回饋券", "滿100送100", "贈50元券") — these are NOT percentages
- ANY store discount stated as 折/打折 (e.g. "9折", "95折", "85折", "3折", "滿千折百", "現折$88") — NEVER convert 折 into pct
- Do NOT compute (100−折數) or (10−折數)×10 as pct — e.g. 9折≠10%, 95折≠5%, 97折≠3%, 85折≠15%
- Gift/exchange offers: 兌換券/引換券/商品券/贈品/プレゼント/買一送一/もう1杯無料 — NOT cashback pct
- Do NOT convert spend→gift amounts into pct — e.g. 滿800元送100元商品券≠12.5%, 800台湾ドル→100台湾ドルプレゼント≠12.5%
- Multi-store pages listing different per-store gifts (each shop has different 贈品) — return [] unless explicit % cashback
- Lottery/draw prizes (抽獎/轉轉樂/幸運) unless explicit % cashback stated
- Loan/fee rates (貸款/手續費/利率)
- Converting 元 amounts into % (e.g. 30元券/滿60元 ≠ 50% reward)
- Fixed dollar cashback (e.g. "最高回饋$50", "滿500送60元") unless explicit % stated
- Percentages that belong to OTHER linked campaigns on the same page (homepage lists, 注意事項 links)

ONLY extract when text explicitly states cashback/points PERCENTAGE with % symbol AND reward words like "回饋/街口幣/點數/儲值金/悠遊幣".

If activity has NO explicit percentage cashback, return empty array [].`;

  // few-shot 範例放在 prompt 中讓模型學習輸出格式
  const prompt = `Task: Extract reward percentages. Output JSON array only. No reasoning steps.

Example 1 - valid % cashback:
Title: 街口5%回饋
Content: 基本消費享5%街口幣回饋，綁定玉山銀行帳戶再享3%加碼。
Output:
[{"label":"街口基本回饋","pct":5,"role":"base","detail":"基本消費享5%街口幣"},{"label":"玉山銀行帳戶","pct":3,"role":"account","detail":"綁定玉山銀行帳戶加碼3%"}]

Example 2 - fixed coupon, NO pct (return []):
Title: 悠遊付掃碼領100元金門暢遊券
Content: 單筆消費滿100元可使用100元現金回饋券，每人限領1張。
Output:
[]

Example 3 - discount coupon, NO pct (return []):
Title: foodpanda新用戶3折
Content: 輸入優惠碼享3折優惠，最高折抵200元。主活動為幸運轉轉樂抽點數。
Output:
[]

Example 4 - 折/打折優惠，禁止換算 pct (return []):
Title: 嗶桃園市好運卡，享專屬藥妝通路加碼優惠
Content: 杏一持好運卡扣款消費即享VIP會員全館9折優惠。佑全持好運卡扣款消費享95折優惠。康是美享滿千折百優惠。
Output:
[]

Example 5 - 交通票價折扣亦不可換算 pct (return []):
Title: 高鐵自由座97折
Content: 搭乘自由座享對號座全票之97折優惠，未提及%回饋或%點數。
Output:
[]

Example 6 - 兌換券/贈品/滿額送券，禁止換算 pct (return []):
Title: PayPay TWQR特約店活動
Content: 悠遊カードで800台湾ドル以上のお支払いでSOGO商品券100台湾ドル分プレゼント。珍珠之王：タピオカ1杯購入でもう1杯無料。誠品生活：300台湾ドル以上でベーグル引換券1枚プレゼント。
Output:
[]

Now extract from this ${platform} activity:
Title: ${titleStr}
Content: ${body}
Output:`;

  return { systemInstruction, prompt };
}

function cleanRewards(rewards, titleStr, body) {
  if (!Array.isArray(rewards)) return null;
  const cleaned = rewards
    .filter(r => r.pct > 0 && r.pct <= 100 && r.label && r.role)
    .map(r => ({
      label: String(r.label).trim().slice(0, 30),
      detail: String(r.detail || '').trim().slice(0, 100),
      pct: Number(r.pct),
      role: ['base', 'card', 'account', 'other'].includes(r.role) ? r.role : 'other',
    }));
  return filterCouponMisreadRewards(cleaned, titleStr, body);
}

/**
 * @param {string} title
 * @param {string} bodyText
 * @param {string} platform
 * @param {{ tier?: string, verbose?: boolean }} [opts]
 * @returns {Promise<{ rewards: Array, model: string, tier: string, delayMs: number } | null>}
 */
export async function aiExtractRewards(title, bodyText, platform = '', opts = {}) {
  if (!API_KEY) return null;
  const tier = opts.tier || DEFAULT_TIER;
  const verbose = opts.verbose !== false;
  const limit = bodyLimitForTier(tier);
  const body = String(bodyText || '').slice(0, limit);
  const titleStr = String(title || '');
  const { systemInstruction, prompt } = buildExtractPrompt(titleStr, body, platform);
  const gemmaPrompt = `${systemInstruction}\n\n${prompt}\n\nIMPORTANT: Reply with a JSON array only. The first character must be [ and the last must be ]. No markdown.`;

  try {
    const hit = await callTier(tier, {
      system: systemInstruction,
      prompt: tier === 'gemma' ? gemmaPrompt : prompt,
      apiKey: API_KEY,
      verbose,
    });
    if (hit) {
      try {
        const parsed = parseJsonArray(hit.text);
        const rewards = cleanRewards(parsed, titleStr, body);
        if (rewards !== null) {
          return { rewards, model: hit.model, tier: hit.tier, delayMs: hit.delayMs };
        }
      } catch (e) {
        console.warn(`  [AI] parse error:`, e.message?.slice(0, 80));
        if (tier === TIER_GEMMA) {
          const fallback = await callTier('g3', {
            system: systemInstruction,
            prompt,
            apiKey: API_KEY,
            verbose,
          });
          if (fallback) {
            const parsed = parseJsonArray(fallback.text);
            const rewards = cleanRewards(parsed, titleStr, body) || [];
            return { rewards, model: fallback.model, tier: fallback.tier, delayMs: fallback.delayMs };
          }
        }
      }
    }
    return null;
  } catch (e) {
    if (verbose) process.stdout.write(`(ai err: ${String(e?.message || e).slice(0, 40)}) `);
    return null;
  }
}

/**
 * Lite extract, then escalate if rule-based risk is high.
 */
export async function extractWithEscalation(act, platform, opts = {}) {
  const verbose = opts.verbose !== false;
  const rawText = String(act.raw?.text || '');
  const rewardDetails = (act.rewards || []).map(r => (r.label || '') + ' ' + (r.detail || '')).join('\n');
  const bodyText = rawText || rewardDetails;

  let result = await aiExtractRewards(act.title, bodyText, platform, { tier: TIER_LITE, verbose });
  if (!result) return null;

  const probe = { ...act, rewards: result.rewards };
  const risk = scoreActivityRisk(probe);
  act.aiRiskScore = risk.score;
  act.aiRiskReasons = risk.reasons;
  act.aiModel = result.model;

  if (tierNeedsEscalate(risk.tier) && !opts.skipEscalate) {
    if (verbose) process.stdout.write(`[risk ${risk.score}→${risk.tier}] `);
    await new Promise(r => setTimeout(r, delayForTier(TIER_LITE)));
    const up = await aiExtractRewards(act.title, bodyText, platform, { tier: risk.tier, verbose });
    if (up) {
      result = up;
      if (!up.rewards.length) {
        const kept = fallbackRewardsFromTitle(act.title);
        if (kept.length) result = { ...up, rewards: kept };
      }
      const risk2 = scoreActivityRisk({ ...act, rewards: result.rewards });
      act.aiRiskScore = risk2.score;
      act.aiRiskReasons = risk2.reasons;
      act.aiModel = result.model;
      act.aiEscalatedAt = new Date().toISOString();
      act.aiNeedsReview = risk2.score >= 70;
    } else {
      act.aiNeedsReview = true;
    }
  } else {
    act.aiNeedsReview = false;
  }

  return result;
}

/**
 * 批次處理：限制每秒請求數，避免超出 rate limit
 * @param {object} opts
 *   delayMs      - 每筆間隔 ms（預設 4500，對應 15 RPM）
 *   onlyMissing  - 只處理沒有 pct 的活動（預設 true）
 *   force        - 強制重新判讀，包含已有%的活動（會忽略 onlyMissing）
 *   skipVerified - 跳過已有 aiVerifiedAt 的活動（預設 true）
 *   verbose      - 顯示進度（預設 true）
 *   onProgress   - 每處理完一筆呼叫 (activity, { fixed, processed })
 */
export async function aiExtractBatch(activities, platform, opts = {}) {
  const {
    delayMs = 4500,
    onlyMissing = true,
    force = false,
    skipVerified = true,
    skipManual = true,
    skipEscalate = false,
    verbose = true,
    onProgress = null,
  } = opts;

  let fixed = 0;
  let processed = 0;
  let skipped = 0;

  // 決定要處理哪些活動
  let toProcess = activities.filter(a => a.period?.status !== 'ended');

  if (!force) {
    // 一般模式：只補缺少%的
    if (onlyMissing) {
      toProcess = toProcess.filter(a => !(a.rewards || []).some(r => r.pct > 0));
    }
    // 跳過已驗證的
    if (skipManual) {
      toProcess = toProcess.filter(a => !a.manualFixedAt);
    }

    if (skipVerified) {
      toProcess = toProcess.filter(a => !a.aiVerifiedAt);
    }
  } else {
    // force 模式：跑全部，但仍可用 skipVerified 跳過已驗證的
    if (skipManual) {
      toProcess = toProcess.filter(a => !a.manualFixedAt);
    }
    if (skipVerified) {
      const before = toProcess.length;
      toProcess = toProcess.filter(a => !a.aiVerifiedAt);
      skipped = before - toProcess.length;
      if (verbose && skipped > 0) console.log(`  (跳過 ${skipped} 筆已驗證活動)`);
    }
  }

  for (const a of toProcess) {
    const rawText = String(a.raw?.text || '');
    const rewardDetails = (a.rewards || []).map(r => (r.label || '') + ' ' + (r.detail || '')).join('\n');
    const bodyText = rawText || rewardDetails;

    if (!bodyText && !a.title) continue;

    if (verbose) process.stdout.write(`  [AI] ${a.title?.slice(0, 40)}... `);

    let result = null;
    try {
      result = await extractWithEscalation(a, platform, { verbose, skipEscalate });
      if (result === null) {
        if (verbose) process.stdout.write('(等待重試15s) ');
        await new Promise(r => setTimeout(r, 15000));
        result = await extractWithEscalation(a, platform, { verbose, skipEscalate });
      }
    } catch (e) {
      if (verbose) console.log(`(crash: ${String(e?.message || e).slice(0, 60)})`);
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    if (result === null) {
      if (verbose) console.log('(error)');
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    const aiRewards = result.rewards;
    a.aiVerifiedAt = new Date().toISOString();
    processed++;

    if (force) {
      // force 模式：以 AI 結果完全取代 pct（保留無 pct 的 label 条目）
      const noPct = (a.rewards || []).filter(r => !r.pct || r.pct <= 0);
      a.rewards = aiRewards.length ? [...aiRewards, ...noPct] : noPct;
      fixed++;
      if (verbose) {
        if (aiRewards.length) {
          console.log(`✓ [AI覆寫: ${aiRewards.map(r => r.pct + '%(' + r.role + ')').join(', ')}]`);
        } else {
          console.log('(無%活動，已清除舊%)');
        }
      }
    } else if (aiRewards.length === 0) {
      if (verbose) console.log('(無%活動，已標記)');
    } else {
      // 一般模式：合併，保留原有的
      const existing = (a.rewards || []).filter(r => r.pct > 0);
      const aiBase = aiRewards.filter(r => r.role === 'base');
      const aiOther = aiRewards.filter(r => r.role !== 'base');
      const existingKeys = new Set(existing.map(r => `${r.role}:${r.pct}`));
      const newRewards = [
        ...aiBase.filter(r => !existingKeys.has(`${r.role}:${r.pct}`)),
        ...existing,
        ...aiOther.filter(r => !existingKeys.has(`${r.role}:${r.pct}`)),
      ];
      if (newRewards.length > existing.length) {
        a.rewards = newRewards;
        fixed++;
        if (verbose) console.log(`✓ [${aiRewards.map(r => r.pct + '%(' + r.role + ')').join(', ')}]`);
      } else {
        if (verbose) console.log('(無新資料，已標記)');
      }
    }

    await new Promise(r => setTimeout(r, result.delayMs || delayMs));
    if (typeof onProgress === 'function') {
      try {
        await onProgress(a, { fixed, processed });
      } catch (e) {
        if (verbose) console.warn(`  (onProgress err: ${e.message})`);
      }
    }
  }

  return { fixed, processed };
}
