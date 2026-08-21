/**
 * Gemini / Gemma generateContent client with RPM delays and RPD caps.
 */
import { remainingQuota, recordQuotaUse } from './ai-quota.mjs';
import {
  TIER_LITE, TIER_GEMMA, TIER_G3, TIER_G35, TIER_G36, TIER_G37,
} from './ai-risk.mjs';

export const MODEL_BY_TIER = {
  [TIER_LITE]: {
    id: 'gemini-3.1-flash-lite',
    aliases: [],
    dailyCap: 480,
    delayMs: 4500,
    timeoutMs: 60000,
    bodyLimit: 3000,
    thinkingLevel: 'MINIMAL',
    jsonMime: true,
  },
  // High RPD but TPM 16K — long delay, short body, no/min thinking.
  [TIER_GEMMA]: {
    id: 'gemma-4-31b-it',
    aliases: ['gemma-4-31b', 'gemma-3-27b-it'],
    dailyCap: 400,
    delayMs: 14000,
    timeoutMs: 90000,
    bodyLimit: 1600,
    thinkingBudget: 0,
    jsonMime: true,
    noSystem: true,
  },
  [TIER_G3]: {
    id: 'gemini-3-flash-preview',
    aliases: ['gemini-3-flash'],
    dailyCap: 20,
    delayMs: 13000,
    timeoutMs: 45000,
    bodyLimit: 3000,
    thinkingLevel: 'MINIMAL',
    jsonMime: true,
  },
  [TIER_G35]: {
    id: 'gemini-3.5-flash',
    aliases: [],
    dailyCap: 20,
    delayMs: 13000,
    timeoutMs: 45000,
    bodyLimit: 3000,
    thinkingLevel: 'MINIMAL',
    jsonMime: true,
  },
  [TIER_G36]: {
    id: 'gemini-3.6-flash',
    aliases: [],
    dailyCap: 20,
    delayMs: 13000,
    timeoutMs: 45000,
    bodyLimit: 3000,
    thinkingLevel: 'MINIMAL',
    jsonMime: true,
  },
  [TIER_G37]: {
    id: 'gemini-3.7-flash',
    aliases: ['gemini-flash-latest'],
    dailyCap: 20,
    delayMs: 13000,
    timeoutMs: 60000,
    bodyLimit: 3000,
    thinkingLevel: 'LOW',
    jsonMime: true,
  },
};

const FALLBACK_TIERS = {
  [TIER_G37]: [TIER_G36, TIER_G35, TIER_G3, TIER_GEMMA],
  [TIER_G36]: [TIER_G35, TIER_G3, TIER_GEMMA],
  [TIER_G35]: [TIER_G3, TIER_GEMMA],
  [TIER_G3]: [TIER_GEMMA],
  [TIER_GEMMA]: [TIER_G3],
  [TIER_LITE]: [],
};

function apiUrl(modelId, apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
}

function buildGenerationConfig(cfg) {
  const gen = {
    temperature: 0.1,
    maxOutputTokens: cfg.id.startsWith('gemma') ? 1024 : 2048,
  };
  if (cfg.jsonMime) gen.response_mime_type = 'application/json';
  if (cfg.thinkingLevel) {
    gen.thinkingConfig = { thinkingLevel: cfg.thinkingLevel };
  } else if (cfg.thinkingBudget === 0) {
    gen.thinkingConfig = { thinkingBudget: 0 };
  }
  return gen;
}

function collectText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || '').join('\n');
}

export function parseJsonArray(text) {
  const raw = String(text || '').trim();
  const codeBlock = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (codeBlock) return JSON.parse(codeBlock[1].trim());
  const matches = [...raw.matchAll(/(\[(?:[^\[\]]|\[(?:[^\[\]]|\[[^\[\]]*\])*\])*\])/g)];
  if (matches.length) return JSON.parse(matches[matches.length - 1][1]);
  throw new Error('no JSON array found');
}

async function postOnce(modelId, body, timeoutMs, apiKey) {
  try {
    const res = await fetch(apiUrl(modelId, apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const errText = res.ok ? '' : await res.text();
    let data = null;
    if (res.ok) data = await res.json();
    else {
      try { data = JSON.parse(errText); } catch { /* ignore */ }
    }
    return { ok: res.ok, status: res.status, data, errText };
  } catch (e) {
    const name = e?.name || '';
    const msg = String(e?.message || e);
    const timedOut = name === 'TimeoutError' || name === 'AbortError' || /aborted due to timeout|timeout/i.test(msg);
    if (timedOut) {
      return { ok: false, status: 408, data: null, errText: `timeout after ${timeoutMs}ms` };
    }
    return { ok: false, status: 0, data: null, errText: msg.slice(0, 200) };
  }
}

/**
 * Call a tier, trying aliases then falling to lower tiers on 404/429.
 * @returns {{ text: string, model: string, tier: string } | null}
 */
export async function callTier(tier, { system, prompt, apiKey, verbose = false }) {
  const queue = [tier, ...(FALLBACK_TIERS[tier] || [])];
  for (const t of queue) {
    const cfg = MODEL_BY_TIER[t];
    if (!cfg) continue;
    if (remainingQuota(cfg.id, cfg.dailyCap) <= 0) {
      if (verbose) process.stdout.write(`(${cfg.id} RPD full) `);
      continue;
    }

    const ids = [cfg.id, ...cfg.aliases];
    const gen = buildGenerationConfig(cfg);
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const payload = { contents, generationConfig: gen };
    if (!cfg.noSystem && system) {
      payload.system_instruction = { parts: [{ text: system }] };
    }

    for (const modelId of ids) {
      let result = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        result = await postOnce(modelId, payload, cfg.timeoutMs, apiKey);
        // Retry without thinkingConfig if API rejects it
        if (!result.ok && /thinking/i.test(result.errText || '')) {
          const gen2 = { ...gen };
          delete gen2.thinkingConfig;
          const payload2 = { ...payload, generationConfig: gen2 };
          result = await postOnce(modelId, payload2, cfg.timeoutMs, apiKey);
        }
        if (result.ok) break;
        if (result.status === 404 || result.status === 429) break;
        // Network / timeout — brief backoff then retry same model
        if (result.status === 408 || result.status === 0 || result.status >= 500) {
          if (verbose) process.stdout.write(`(${modelId} ${result.status === 408 ? 'timeout' : result.status} retry${attempt}) `);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        break;
      }
      if (result.status === 404) {
        if (verbose) process.stdout.write(`(${modelId} 404) `);
        continue;
      }
      if (result.status === 429) {
        if (verbose) process.stdout.write(`(${modelId} 429) `);
        break;
      }
      if (!result.ok) {
        if (verbose) process.stdout.write(`(${modelId} ${result.status || 'err'}) `);
        continue;
      }
      recordQuotaUse(cfg.id);
      const text = collectText(result.data);
      return { text, model: modelId, tier: t, delayMs: cfg.delayMs, bodyLimit: cfg.bodyLimit };
    }
  }
  return null;
}

export function bodyLimitForTier(tier) {
  return MODEL_BY_TIER[tier]?.bodyLimit || 3000;
}

export function delayForTier(tier) {
  return MODEL_BY_TIER[tier]?.delayMs || 4500;
}
