import { quotaFromActivity, parseQuotaFull, labelQuotaNotices } from '../viewer/quota-full.js';
import { hashBodyText, bodiesMatch, preserveAiFields } from './activity-cache.mjs';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

const augBody =
  '2026年8月【筆筆回饋5%】活動贈點已於2026/08/03 12:30pm 額滿 2026年7月活動贈點已於2026/07/02 17:22pm 額滿';
const sepBody =
  '2026年9月【筆筆回饋5%】活動贈點已於2026/09/03 10:00am 額滿 2026年8月活動贈點已於2026/08/03 12:30pm 額滿';

const frozen = {
  title: '星巴克指定日最高回饋16%',
  quotaFull: {
    full: true,
    currentMonthFull: true,
    month: 8,
    at: '2026/08/03 12:30',
    label: '本月已額滿（8月）',
    note: '活動贈點已於2026/08/03 12:30pm 額滿',
    notices: [{ portion: null, month: 8, at: '2026/08/03 12:30', note: '活動贈點已於2026/08/03 12:30pm 額滿' }],
  },
  raw: { text: augBody },
};

const q = quotaFromActivity(frozen);
assert(q && q.full, 'should still be full');
assert(q.month === 8 || q.notices.some((n) => n.month === 8), 'keep August notice');
assert(q.currentMonthFull === false, `Sept should not treat Aug as currentMonthFull, got ${q.currentMonthFull} label=${q.label}`);
assert(!String(q.label).includes('本月'), `label should not say 本月, got ${q.label}`);

const sepParsed = parseQuotaFull(sepBody);
assert(sepParsed.currentMonthFull === true, 'Sept body is current month full');
assert(sepParsed.month === 9, `expected month 9, got ${sepParsed.month}`);

assert(hashBodyText(augBody) !== hashBodyText(sepBody), 'body hashes differ');
assert(
  !bodiesMatch({ raw: { text: augBody } }, { raw: { text: sepBody } }),
  'bodiesMatch false across months'
);

const prev = {
  id: 'x',
  raw: { text: augBody },
  aiVerifiedAt: '2026-08-19T00:00:00.000Z',
  rewards: [{ pct: 5 }],
};
const same = preserveAiFields({ raw: { text: augBody }, quotaFull: { month: 8 } }, prev);
assert(same.aiVerifiedAt, 'AI kept when body hash matches');
const changed = preserveAiFields({ raw: { text: sepBody }, quotaFull: { month: 9 } }, prev);
assert(!changed.aiVerifiedAt, 'AI dropped when body hash changes');

const coupon = {
  quotaFull: { full: true, source: 'jko_coupon', label: '已額滿', currentMonthFull: true },
};
assert(quotaFromActivity(coupon)?.source === 'jko_coupon', 'keep jko coupon quota');

console.log('quota-full + hash checks OK', q.label, sepParsed.label);
