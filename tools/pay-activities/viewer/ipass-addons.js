/**
 * Parse iPASS MONEY card/account add-on lines from campaign copy.
 * Consumption % add-ons stack with the base activity; one-time task bonuses do not.
 */

import { normalizeBankName } from './banks.js';

function isCampaignSlogan(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (n.length > 16) return true;
  if (/綁定|開立|完成任務|最高享|回饋！/.test(n) && !/^TWQR/.test(n)) return true;
  return false;
}

function looksLikeBankLabel(label) {
  return Boolean(normalizeBankName(label)) || /銀行|信用卡|帳戶|Unicard|LINE Bank|Richart/i.test(String(label || ''));
}

function canonBank(raw) {
  return normalizeBankName(raw) || String(raw || '').trim();
}

function isFirstTimeOnlyBonus(text) {
  const t = String(text || '');
  return /首次(使用|消費)/.test(t) && !/綁定.{0,16}(信用卡|Unicard|快點卡).{0,40}最高享/.test(t);
}

function isHubAddOnPage(title) {
  const t = String(title || '');
  return /連結銀行帳戶/.test(t) && /信用卡享優惠/.test(t);
}

function isCouponTitle(title) {
  const t = String(title || '');
  if (/\d+(?:\.\d+)?\s*%/.test(t.replace(/優惠券/g, ''))) return false;
  return /優惠券|贈\s*\d+\s*元|送\s*\d+\s*元/.test(t);
}

function isMarketingMaxTitle(title) {
  return /最高再賺|再賺最高/.test(String(title || ''));
}

export function parseIpassPayAddOns(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const rewards = [];
  const seen = new Set();

  const pushCard = (rawName, rate, detail) => {
    if (!(rate > 0) || rate > 40) return;
    if (!/聯邦|玉山|LINE|王道|台新|國泰|星展|樂天|unicard|快點卡/i.test(rawName)) return;
    if (isFirstTimeOnlyBonus(detail)) return;
    const bank = canonBank(rawName);
    if (!bank || seen.has(`card|${bank}`)) return;
    seen.add(`card|${bank}`);
    rewards.push({
      label: bank,
      detail: String(detail || '').trim(),
      pct: rate,
      role: 'card',
    });
  };

  const cardRe =
    /綁定\s*([^，。\n]{2,24}?)(信用卡|簽帳卡|Unicard|unicard|快點卡)[^。\n]{0,80}?最高享\s*(\d+(?:\.\d+)?)\s*%/gi;
  let m;
  while ((m = cardRe.exec(s))) {
    pushCard(`${m[1]}${m[2]}`, Number(m[3]), m[0]);
  }

  const fedGreen = s.match(/一卡通綠點\s*(\d+(?:\.\d+)?)\s*%\s*回饋[\s\S]{0,320}【聯邦信用卡】/);
  if (fedGreen) pushCard('聯邦信用卡', Number(fedGreen[1]), fedGreen[0]);

  const camp = s.match(/綁定信用卡付款[^。]{0,60}加碼再享(?:一卡通綠點)?\s*(\d+(?:\.\d+)?)\s*%/);
  if (camp) {
    const rate = Number(camp[1]);
    if (rate > 0 && rate <= 40 && !seen.has('campaignCard')) {
      seen.add('campaignCard');
      rewards.push({
        label: '本活動綁卡加碼',
        detail: camp[0].trim(),
        pct: rate,
        role: 'campaignCard',
      });
    }
  }

  return rewards;
}

function recoverMerchantBase(activity, blob) {
  const title = activity?.title || '';
  if (isHubAddOnPage(title)) return null;
  if (/現折/.test(title)) {
    const m = title.match(/(\d+(?:\.\d+)?)\s*%\s*現折/) || blob.match(/(\d+(?:\.\d+)?)\s*%\s*現折/);
    if (m) {
      return {
        label: '主活動（現折）',
        detail: m[0],
        pct: Number(m[1]),
        role: 'base',
      };
    }
  }
  if (isMarketingMaxTitle(title)) {
    const m = blob.match(/優惠[一二][：:][^。]{0,120}享(?:一卡通綠點)?\s*(\d+(?:\.\d+)?)\s*%\s*回饋/);
    if (m) {
      const rate = Number(m[1]);
      if (rate > 0 && rate <= 40) {
        return { label: '主活動', detail: m[0].slice(0, 120), pct: rate, role: 'base' };
      }
    }
  }
  return null;
}

export function ipassTwqrMerchants(text) {
  const s = String(text || '');
  if (!/TWQR/.test(s)) return [];
  if (/掃描任一\s*TWQR|TWQR\s*立牌|TWQR皆適用|任一 TWQR/.test(s)) {
    return ['TWQR消費'];
  }
  return [];
}

export function enrichIpassActivity(activity, extraText = '') {
  const blob = [
    extraText,
    activity?.title,
    activity?.raw?.text,
    ...(activity?.rewards || []).map((r) => `${r.label || ''} ${r.detail || ''}`),
  ].join('\n');

  const addOns = parseIpassPayAddOns(blob);
  const recoveredBase = recoverMerchantBase(activity, blob);
  let rewards = [...(activity?.rewards || [])].filter((r) => {
    const blobRow = `${r?.label || ''} ${r?.detail || ''}`;
    if (r?.role === 'base' && (isHubAddOnPage(activity?.title) || isMarketingMaxTitle(activity?.title) || isCouponTitle(activity?.title) || recoveredBase)) {
      return false;
    }
    if (r?.role === 'card' || r?.role === 'account' || r?.role === 'bank') {
      if (isFirstTimeOnlyBonus(blobRow)) return false;
      if (/^指定信用卡$|^指定銀行/.test(String(r.label || ''))) return false;
      return looksLikeBankLabel(r.label) && /聯邦|玉山|LINE|王道|台新|國泰|星展|樂天|unicard|快點卡|銀行/i.test(r.label);
    }
    return true;
  });
  if (recoveredBase) rewards.unshift(recoveredBase);
  const seen = new Set(rewards.map((r) => `${r.role}|${r.label}`));
  for (const row of addOns) {
    const key = `${row.role}|${row.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rewards.push(row);
  }

  const merchants = [...(activity?.merchants || [])].filter((m) => !isCampaignSlogan(m));
  const titleStore = String(activity?.title || '').match(/【([^】]{2,16})】/);
  if (titleStore?.[1] && !isCampaignSlogan(titleStore[1]) && !looksLikeBankLabel(titleStore[1]) && !/iPASS|PayPay/i.test(titleStore[1])) {
    if (!merchants.includes(titleStore[1])) merchants.push(titleStore[1]);
  }
  for (const name of ipassTwqrMerchants(blob)) {
    if (!merchants.includes(name)) merchants.push(name);
  }

  const scopeHints = [...(activity?.scopeHints || [])];
  if (/TWQR/.test(blob) && !scopeHints.includes('TWQR掃碼')) scopeHints.push('TWQR掃碼');
  if (/付款碼/.test(blob) && !scopeHints.includes('付款碼')) scopeHints.push('付款碼');

  const extraSearch = [...addOns.map((r) => r.label), ...merchants, ...scopeHints]
    .join(' ')
    .toLowerCase();
  const searchText = extraSearch && !(activity?.searchText || '').includes(extraSearch)
    ? `${activity?.searchText || ''} ${extraSearch}`.trim()
    : activity?.searchText;

  return { ...activity, rewards, merchants, scopeHints, searchText };
}
