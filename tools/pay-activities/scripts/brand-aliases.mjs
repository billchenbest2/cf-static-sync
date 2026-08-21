/**
 * Canonicalize merchant / brand names after extraction.
 * ASCII keys in ALIASES are lowercase folded (no spaces, no middle dots).
 */
const ALIASES = {
  okmart: 'OK超商',
  ok超商: 'OK超商',
  abcmart: 'ABC-MART',
  'abc-mart': 'ABC-MART',
  uwash: 'UWASH',
  jetfi: 'JetFi',
  jetfimobile: 'JetFi',
  mycard: 'MyCard',
  '55688': '台灣大車隊',
  '55688台灣大車隊': '台灣大車隊',
  台灣大車隊: '台灣大車隊',
  九乘九: '九乘九文具',
  九乘九文具: '九乘九文具',
  可不可熟成茶行: '可不可熟成紅茶',
  可不可熟成紅茶: '可不可熟成紅茶',
  躍獅藥局: '躍獅連鎖藥局',
  躍獅連鎖藥局: '躍獅連鎖藥局',
  品都串燒: '品都串燒攤',
  品都串燒攤: '品都串燒攤',
  大全聯美食商店街: '大全聯美商店',
  大全聯美商店: '大全聯美商店',
  三創生活: '三創生活園區',
  三創生活園區: '三創生活園區',
  台茂購物: '台茂購物中心',
  台茂購物中心: '台茂購物中心',
  迪化商圈: '迪化街',
  迪化街商圈: '迪化街',
  迪化街: '迪化街',
  劍湖山世界: '劍湖山世界主題樂園',
  劍湖山世界主題樂園: '劍湖山世界主題樂園',
  神腦: '神腦國際',
  神腦國際: '神腦國際',
  東森k區地下街: '東森K區地下街',
  北車東森k區地下街: '東森K區地下街',
  美賣: 'meimaii 美賣',
  meimaii美賣: 'meimaii 美賣',
  focus流行館: 'FOCUS 流行館',
  focus時尚流行館: 'FOCUS 流行館',
  時尚流行館: 'FOCUS 流行館',
  focus13: 'FOCUS 流行館',
  統領廣場: '統領百貨',
  統領百貨: '統領百貨',
  skylark洋食芳鄰: 'Skylark洋食·芳鄰',
  saobao手機自動貼模機: 'Saobao 手機自動貼膜機',
  saobao手機自動貼膜機: 'Saobao 手機自動貼膜機',
  麥當勞手機點餐: "McDonald's 麥當勞",
  麥當勞線上點餐: "McDonald's 麥當勞",
  "mcdonald's麥當勞": "McDonald's 麥當勞",
};

function foldKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·．.．]/g, '')
    .replace(/^-+/, '');
}

function splitGluedNames(name) {
  const raw = String(name || '').replace(/^-+/, '').trim();
  if (!raw) return [];

  const marketPair = raw.match(/^(.{2,12}市場)(.{2,12}市場)$/);
  if (marketPair) return [marketPair[1], marketPair[2]];
  const nightPair = raw.match(/^(.{2,12}夜市)(.{2,12}夜市)$/);
  if (nightPair) return [nightPair[1], nightPair[2]];

  if (raw.includes('與') && !raw.startsWith('有之')) {
    const parts = raw.split('與').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2 && parts.every((p) => p.length >= 2 && p.length <= 18)) {
      return parts;
    }
  }
  return [raw];
}

function applyAlias(name) {
  const key = foldKey(name);
  return ALIASES[key] || name;
}

function dropPrefixDuplicates(names) {
  const unique = [...new Set(names.filter(Boolean))];
  return unique.filter((name) => {
    const folded = foldKey(name);
    return !unique.some((other) => {
      if (other === name) return false;
      const otherFolded = foldKey(other);
      return otherFolded.length > folded.length && otherFolded.startsWith(folded);
    });
  });
}

export function canonicalizeMerchants(names) {
  const expanded = [];
  for (const name of names || []) {
    for (const part of splitGluedNames(name)) {
      const canonical = applyAlias(part.trim());
      if (canonical) expanded.push(canonical);
    }
  }
  return dropPrefixDuplicates(expanded);
}
