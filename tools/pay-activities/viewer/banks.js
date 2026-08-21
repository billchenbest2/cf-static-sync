/**
 * Canonical Taiwan bank names + aliases.
 * Crawlers and the viewer share this so "玉山信用卡" and "玉山銀行" match.
 */

export const BANKS = [
  { name: '台灣銀行', aliases: ['臺灣銀行'] },
  { name: '土地銀行', aliases: ['臺銀土地', '台灣土地銀行'] },
  { name: '合作金庫', aliases: ['合庫', '合作金庫銀行'] },
  { name: '第一銀行', aliases: ['第一金', '第一商業銀行'] },
  { name: '華南銀行', aliases: ['華南商銀', '華南商業銀行'] },
  { name: '彰化銀行', aliases: ['彰銀'] },
  { name: '兆豐銀行', aliases: ['兆豐', '兆豐商銀'] },
  { name: '國泰世華銀行', aliases: ['國泰世華', '國泰'] },
  { name: '台北富邦銀行', aliases: ['台北富邦', '富邦銀行', '富邦'] },
  { name: '中國信託銀行', aliases: ['中國信託', '中信銀行', '中信', 'CTBC'] },
  { name: '台新銀行', aliases: ['台新', '臺新', 'Richart'] },
  { name: '玉山銀行', aliases: ['玉山'] },
  { name: '元大銀行', aliases: ['元大'] },
  { name: '永豐銀行', aliases: ['永豐', '京城銀行', '京城'] },
  { name: '聯邦銀行', aliases: ['聯邦'] },
  { name: '遠東商銀', aliases: ['遠東銀行', '遠銀'] },
  { name: '星展銀行', aliases: ['星展', 'DBS'] },
  { name: '渣打銀行', aliases: ['渣打'] },
  { name: '匯豐銀行', aliases: ['匯豐', 'HSBC'] },
  { name: '上海商銀', aliases: ['上海銀行', '上海商業儲蓄銀行'] },
  { name: '華泰銀行', aliases: ['華泰'] },
  { name: '王道銀行', aliases: ['王道', 'O-Bank', 'O Bank'] },
  { name: '樂天銀行', aliases: ['樂天'] },
  { name: '將來銀行', aliases: ['將來', 'NEXT Bank', 'New New Bank'] },
  { name: 'LINE Bank', aliases: ['連線銀行', '連線商業銀行', 'Line Bank'] },
  { name: '台中銀行', aliases: ['臺中銀行'] },
  { name: '高雄銀行', aliases: [] },
  { name: '新光銀行', aliases: ['新光'] },
  { name: '陽信銀行', aliases: ['陽信'] },
  { name: '板信銀行', aliases: ['板信'] },
  { name: '三信銀行', aliases: ['三信商銀'] },
  { name: '安泰銀行', aliases: ['安泰'] },
  { name: '凱基銀行', aliases: ['凱基'] },
  { name: '台企銀', aliases: ['台灣中小企銀', '臺灣中小企銀'] },
  { name: '瑞興銀行', aliases: ['瑞興'] },
];

const SKIP_LABEL = /^(指定)?(信用卡|銀行帳戶|銀行\/信用卡|主活動|優惠|帳戶|銀行)$/;

function keysOf(bank) {
  return [bank.name, ...(bank.aliases || [])].filter(Boolean);
}

export function allBankNames() {
  return BANKS.map((b) => b.name);
}

export function normalizeBankName(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 48 || SKIP_LABEL.test(s)) return '';

  let best = '';
  let bestLen = 0;
  for (const bank of BANKS) {
    for (const key of keysOf(bank)) {
      if (key.length < 2) continue;
      if (s.includes(key) && key.length > bestLen) {
        best = bank.name;
        bestLen = key.length;
      }
    }
  }
  if (best) return best;

  const cleaned = s
    .replace(/信用卡|簽帳卡|Green\s*卡|聯名卡|帳戶|活期存款|數位帳戶/g, '')
    .replace(/\s+/g, '')
    .trim();
  for (const bank of BANKS) {
    if (cleaned === bank.name) return bank.name;
    for (const key of keysOf(bank)) {
      if (key.length >= 2 && cleaned === key) return bank.name;
    }
  }
  if (/^[A-Za-z][A-Za-z0-9 .&-]{1,24} Bank$/i.test(s.trim())) return s.trim();
  return '';
}

export function canonOwnedBanks(list) {
  const out = [];
  for (const item of list || []) {
    const n = normalizeBankName(item);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
