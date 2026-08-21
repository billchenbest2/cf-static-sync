/**
 * Rule-based risk score for reward extraction.
 * Higher score = more likely wrong. Do NOT use model self-confidence.
 */

export const TIER_LITE = 'lite';
export const TIER_GEMMA = 'gemma';
export const TIER_G3 = 'g3';
export const TIER_G35 = 'g35';
export const TIER_G36 = 'g36';
export const TIER_G37 = 'g37';

/** Risk → model tier. Highest models only for the most suspicious rows. */
export const TIER_ORDER = [TIER_LITE, TIER_GEMMA, TIER_G3, TIER_G35, TIER_G36, TIER_G37];

export function titleCashbackPct(title) {
  const s = String(title || '');
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  if (!/回饋/.test(s)) return null;
  return Number(m[1]);
}

export function fallbackRewardsFromTitle(title) {
  const pct = titleCashbackPct(title);
  if (!pct || pct <= 0 || pct > 100) return [];
  return [{
    label: String(title).slice(0, 30),
    detail: String(title).slice(0, 80),
    pct,
    role: 'other',
  }];
}

export function pickTier(score) {
  if (score >= 93) return TIER_G37;
  if (score >= 85) return TIER_G36;
  if (score >= 75) return TIER_G35;
  if (score >= 65) return TIER_G3;
  if (score >= 45) return TIER_GEMMA;
  return TIER_LITE;
}

export function tierNeedsEscalate(tier) {
  return tier !== TIER_LITE;
}

function hasExplicitCashbackPct(text) {
  return /\d+\s*%\s*(?:回饋|街口幣|點數|儲值金|悠遊幣|Fa點|OPENPOINT|LINE POINTS|全點)/i.test(text);
}

function pctAppearsInText(pct, text) {
  const n = Number(pct);
  if (!n) return false;
  const raw = String(n);
  const trimmed = raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const variants = new Set([raw, trimmed, String(Math.round(n))]);
  for (const v of variants) {
    if (new RegExp(`${v}\\s*[%％]`).test(text)) return true;
  }
  return false;
}

/**
 * @param {object} act
 * @returns {{ score: number, reasons: string[], tier: string }}
 */
export function scoreActivityRisk(act) {
  const title = String(act.title || '');
  const body = String(act.raw?.text || '').slice(0, 5000);
  const text = `${title}\n${body}`;
  const rewards = (act.rewards || []).filter(r => r.pct > 0);
  const reasons = [];
  let score = 0;

  const couponLike = /現金回饋券|優惠券|折抵券|禮券|贈券|領券|星意禮/.test(text);
  const explicitPct = hasExplicitCashbackPct(text);
  const dollarCashback = /回饋\s*[\$＄]\s*\d+|最高回饋\s*[\$＄]?\d+\s*元?/.test(title)
    || /滿\s*[\$＄]?\d+.*(?:送|贈)\s*\d+\s*元/.test(text);

  if (rewards.some(r => r.pct >= 100)) {
    score += 50;
    reasons.push('pct_gte_100');
  }

  if (couponLike && rewards.length && !explicitPct) {
    score += 40;
    reasons.push('coupon_no_explicit_pct');
  } else if (couponLike && rewards.some(r => r.pct >= 15)) {
    score += 18;
    reasons.push('coupon_with_pct');
  }

  if (/\d+\s*折/.test(text) && rewards.some(r => r.pct >= 20) && !explicitPct) {
    score += 30;
    reasons.push('discount_as_pct');
  }

  if (dollarCashback && rewards.length && !explicitPct) {
    score += 35;
    reasons.push('fixed_dollar');
  }

  for (const r of rewards) {
    const blob = `${title} ${r.label || ''} ${r.detail || ''}`;
    const m = blob.match(/滿\s*(\d+)\s*元?.*(?:送|贈|折抵)\s*(\d+)\s*元/);
    if (m) {
      const implied = Math.round(Number(m[2]) / Number(m[1]) * 100);
      if (implied > 0 && Math.abs(implied - r.pct) <= 2) {
        score += 35;
        reasons.push('implied_yuan_ratio');
        break;
      }
    }
  }

  if (rewards.length) {
    const missing = rewards.filter(r => !pctAppearsInText(r.pct, text));
    if (missing.length === rewards.length) {
      score += 30;
      reasons.push('pct_not_in_text');
    } else if (missing.length) {
      score += 12;
      reasons.push('some_pct_not_in_text');
    }
  }

  const urls = (body.match(/https?:\/\//g) || []).length;
  const dates = (body.match(/\d{4}\/\d{1,2}\/\d{1,2}/g) || []).length;
  if (urls >= 5 || dates >= 8) {
    score += 25;
    reasons.push('aggregation_page');
  }

  if (/抽獎|轉轉樂|幸運/.test(text) && rewards.some(r => r.pct >= 30) && !explicitPct) {
    score += 20;
    reasons.push('lottery');
  }

  if (rewards.filter(r => r.role === 'other').length >= 6) {
    score += 20;
    reasons.push('too_many_other');
  }

  const titlePct = title.match(/(\d+(?:\.\d+)?)\s*%/);
  if (titlePct && rewards.some(r => Math.abs(r.pct - Number(titlePct[1])) < 0.51)) {
    score -= 25;
    reasons.push('title_pct_match');
  } else if (explicitPct && rewards.length) {
    score -= 10;
    reasons.push('explicit_pct_present');
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons: [...new Set(reasons)], tier: pickTier(score) };
}
