/**
 * Unified CVS service taxonomy + official API parsers.
 * 711: emap.pcsc.com.tw StoreImageTitle
 * Family: api.map.com.tw familyShop.aspx `all` + `twoice`
 */

export const CVS_SERVICE_LABELS = {
  toilet: '廁所',
  atm: 'ATM',
  ibon: 'ibon',
  famiport: 'FamiPort',
  wifi: 'Wi-Fi',
  open_24h: '24 小時',
  parking: '停車',
  ev_charging: '電動車充電',
  laundry: '洗衣',
  delivery: '寄取件',
  coffee: '咖啡',
  famicafe: 'FamiCafe',
  hot_food: '熱食',
  fresh_food: '生鮮',
  dessert: '甜點',
  tea: '現萃茶',
  slurpee: '思樂冰',
  ice_cream: '霜淇淋',
  ice_cream_single: '單口味霜淇淋',
  ice_cream_double: '雙口味霜淇淋',
  ice_cream_special: '圓滾滾',
  ice_cream_drink: '霜淇淋飲',
  ice_cream_snow: '雪淋霜',
  ice_cream_coldstone: '酷聖石',
  health: '健康量測站',
  muji: '無印良品',
  starbucks: '星巴克',
  pet: '寵物專區',
  books: '博客來',
  recycle: '智慧回收機',
  rest_area: '休憩區',
  power_rental: '行動電源租借',
  smart_coffee: '精品咖啡',
  fami_super: '生鮮超市',
  costco: '好市多專架',
  gogoro: 'Gogoro 換電'
};

/** Filter chips shown per brand (subset; detail may list more). */
export const CVS_SERVICE_BY_BRAND = {
  '711': [
    'toilet', 'atm', 'ibon', 'wifi', 'open_24h', 'coffee', 'hot_food', 'fresh_food',
    'parking', 'ev_charging', 'slurpee', 'ice_cream_snow', 'ice_cream_coldstone',
    'dessert', 'health', 'muji', 'starbucks', 'pet', 'books', 'delivery'
  ],
  family: [
    'toilet', 'atm', 'famiport', 'wifi', 'open_24h', 'coffee', 'hot_food', 'fresh_food',
    'parking', 'ev_charging', 'laundry', 'delivery', 'slurpee', 'ice_cream', 'ice_cream_single',
    'ice_cream_double', 'ice_cream_special', 'ice_cream_drink', 'dessert', 'tea', 'smart_coffee',
    'fami_super', 'costco', 'gogoro', 'rest_area'
  ],
  hilife: ['toilet', 'atm', 'open_24h', 'wifi', 'coffee', 'slurpee', 'hot_food', 'ev_charging', 'parking'],
  ok: ['toilet', 'atm', 'open_24h', 'wifi', 'coffee', 'slurpee', 'hot_food'],
  simple: ['toilet', 'atm', 'open_24h', 'fresh_food', 'parking']
};

/** 7-ELEVEN StoreImageTitle -> service id (reference: emap.pcsc.com.tw). */
const SEVEN_TITLE_MAP = {
  '01停車場': 'parking',
  '02廁所': 'toilet',
  '03ATM': 'atm',
  '04座位區': 'rest_area',
  '05ibon WiFi': 'wifi',
  '06思樂冰': 'slurpee',
  '07OPEN! STORE': 'open_24h',
  '08寵物生活專區': 'pet',
  '09OPEN! PLAZA專櫃': 'open_24h',
  '11千禧血壓站': 'health',
  '12行動電源租賃': 'power_rental',
  '13生鮮蔬菜': 'fresh_food',
  '14酷聖石複合店': 'ice_cream_coldstone',
  '15Mister Donut甜甜圈': 'dessert',
  '16美妝': 'dessert',
  '17甜點專櫃': 'dessert',
  '18高效智慧回收機': 'recycle',
  '19ibon': 'ibon',
  '20酒BAR': 'coffee',
  '21現萃茶': 'tea',
  '22現蒸地瓜': 'hot_food',
  '24雪淋霜霜淇淋': 'ice_cream_snow',
  '25OPEN!兒童閱覽室': 'open_24h',
  '2821TOGO': 'hot_food',
  '29聖娜麵包': 'hot_food',
  '30不可思議咖啡': 'coffee',
  '31博客來': 'books',
  '32糖果屋': 'dessert',
  '33OPEN iECO循環杯': 'recycle',
  '34CITY系列熱燕麥飲': 'coffee',
  '36精品咖啡': 'coffee',
  '37天素地蔬': 'fresh_food',
  '38嚴選素材冷凍鮮物': 'fresh_food',
  '39原賞熱壓土司': 'hot_food',
  '66冷凍交貨便': 'delivery',
  '78拋棄式隱形眼鏡': 'dessert',
  '79精品威士忌咖啡': 'coffee',
  '80霹靂DVD': 'books',
  '82天素地蔬複合店': 'fresh_food',
  '83蒸食機': 'hot_food',
  '84gogoro': 'gogoro',
  '85ionex': 'ev_charging',
  '86OPEN Bar': 'coffee',
  '88酷聖石霜淇淋': 'ice_cream_coldstone',
  '89自助微波': 'hot_food',
  '90饗喫鍋': 'hot_food',
  '91蒸玉米': 'hot_food',
  '92現烤地瓜': 'hot_food',
  '94EC自助取件': 'delivery',
  '95藥商執照(快篩試劑)': 'health',
  '96瓜地馬拉豆': 'coffee',
  'A1所長茶葉蛋': 'hot_food',
  'A2黃金滷蛋': 'hot_food',
  'A2動福滷蛋': 'hot_food',
  'A8BEAMS DESIGN': 'muji',
  'A9BEAMS DESIGN專區': 'muji',
  'B0奶油爆米花風味拿鐵': 'coffee',
  'B2開心食堂': 'hot_food',
  'B6特選咖啡': 'coffee'
};

const SEVEN_XML_FLAGS = {
  isLavatory: 'toilet',
  isATM: 'atm',
  isIbon: 'ibon',
  isCityCafe: 'coffee',
  is7WiFi: 'wifi',
  isIce: 'slurpee',
  isDining: 'hot_food',
  isFruit: 'fresh_food',
  isParking: 'parking',
  isHealthStations: 'health',
  isMuji: 'muji',
  isStarBucks: 'starbucks',
  isOpenStore: 'open_24h'
};

/** Family `all` token -> service id (case-insensitive). */
const FAMILY_TOKEN_MAP = {
  toilet: 'toilet',
  rest: 'rest_area',
  ice: 'ice_cream',
  icecream: 'ice_cream_single',
  twoice: 'ice_cream_double',
  famiice: 'ice_cream_special',
  dri: 'ice_cream_drink',
  cs: 'power_rental',
  hd: 'hot_food',
  sweetpotato: 'hot_food',
  rpotato: 'hot_food',
  grill: 'hot_food',
  cooknow: 'hot_food',
  tripk: 'hot_food',
  dessert: 'dessert',
  fresh: 'fresh_food',
  veg: 'fresh_food',
  tea: 'tea',
  lcoffee: 'coffee',
  smart: 'smart_coffee',
  super: 'fami_super',
  laundry: 'laundry',
  costco: 'costco',
  famiport: 'famiport',
  wifi: 'wifi',
  eco: 'recycle',
  evc: 'ev_charging',
  goro: 'gogoro',
  fzo: 'delivery',
  photo: 'delivery'
};

export function mergeServiceIds(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort();
}

function map711TitlePart(part) {
  const t = String(part || '').trim();
  if (!t) return null;
  if (SEVEN_TITLE_MAP[t]) return SEVEN_TITLE_MAP[t];
  const label = t.replace(/^\d+/, '').trim();
  for (const [key, id] of Object.entries(SEVEN_TITLE_MAP)) {
    if (key.replace(/^\d+/, '').trim() === label) return id;
  }
  if (/思樂冰/.test(t)) return 'slurpee';
  if (/雪淋霜/.test(t)) return 'ice_cream_snow';
  if (/酷聖石/.test(t)) return 'ice_cream_coldstone';
  if (/廁所|洗手間/.test(t)) return 'toilet';
  if (/ATM/i.test(t)) return 'atm';
  if (/ibon/i.test(t)) return 'ibon';
  if (/WiFi|Wi-Fi/i.test(t)) return 'wifi';
  if (/咖啡|Cafe/i.test(t)) return 'coffee';
  if (/24/.test(t)) return 'open_24h';
  if (/停車/.test(t)) return 'parking';
  if (/霜淇淋|冰淇淋/.test(t)) return 'ice_cream_snow';
  return null;
}

export function parse711ServicesFromXml(xmlChunk) {
  const ids = [];
  for (const [flag, id] of Object.entries(SEVEN_XML_FLAGS)) {
    const m = xmlChunk.match(new RegExp(`<${flag}>([^<]*)</${flag}>`));
    if (m && /^Y$/i.test(String(m[1]).trim())) ids.push(id);
  }
  const title = xmlChunk.match(/<StoreImageTitle>([^<]*)<\/StoreImageTitle>/);
  if (title) {
    for (const part of String(title[1]).split(',')) {
      const mapped = map711TitlePart(part);
      if (mapped) ids.push(mapped);
    }
  }
  return mergeServiceIds(ids);
}

export function parse711ServicesFromTitle(titleRaw) {
  const ids = [];
  for (const part of String(titleRaw || '').split(',')) {
    const mapped = map711TitlePart(part);
    if (mapped) ids.push(mapped);
  }
  return mergeServiceIds(ids);
}

export function parseFamilyServices(raw, twoiceField) {
  const ids = [];
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
  for (const part of text.split(',')) {
    const token = part.trim().toLowerCase();
    const mapped = FAMILY_TOKEN_MAP[token];
    if (mapped) ids.push(mapped);
  }
  if (String(twoiceField || '').trim().toUpperCase() === 'Y') {
    ids.push('ice_cream_double');
  }
  if (/\bicecream\b/i.test(text)) ids.push('ice_cream_single');
  if (/\bfamiice\b/i.test(text)) ids.push('ice_cream_special');
  if (/\bice\b/i.test(text) && !/\bicecream\b/i.test(text)) ids.push('ice_cream');
  return mergeServiceIds(ids);
}

const HILIFE_FIELD_MAP = {
  atm: 'atm',
  coff: 'coffee',
  wifi: 'wifi',
  smoothie: 'slurpee',
  bbq: 'hot_food',
  lifeet: 'delivery',
  bike: 'delivery',
  tcard: 'fresh_food',
  grocer: 'fresh_food',
  candy: 'dessert',
  restspace: 'rest_area',
  medical: 'health',
  printer: 'delivery',
  photo: 'delivery',
  sock: 'dessert',
  makeup: 'dessert'
};

/** Hi-Life VIP app `equipment` token -> service id. */
const HILIFE_APP_EQUIPMENT_MAP = {
  atm: 'atm',
  coffee: 'coffee',
  hicafe: 'coffee',
  wifi: 'wifi',
  toilet: 'toilet',
  recreation: 'rest_area',
  rest: 'rest_area',
  medical: 'health',
  print: 'delivery',
  copyservice: 'delivery',
  photowash: 'delivery',
  moothie: 'slurpee',
  smoothie: 'slurpee',
  candy: 'dessert',
  carpark: 'parking',
  bbq: 'hot_food',
  grocer: 'fresh_food',
  ev: 'ev_charging'
};

export function parseHiLifeServices(row) {
  const ids = [];
  for (const [field, id] of Object.entries(HILIFE_FIELD_MAP)) {
    if (String(row?.[field] || '').trim() === '*') ids.push(id);
  }
  const equip = row?.equipment;
  if (Array.isArray(equip)) {
    for (const token of equip) {
      const mapped = HILIFE_APP_EQUIPMENT_MAP[String(token || '').trim().toLowerCase()];
      if (mapped) ids.push(mapped);
    }
  }
  const twEquip = row?.tw_equipment;
  if (Array.isArray(twEquip)) {
    const text = twEquip.join(' ');
    if (/思樂冰|冰沙|Smoot/i.test(text)) ids.push('slurpee');
    if (/咖啡|Caf/i.test(text)) ids.push('coffee');
    if (/廁所|洗手/i.test(text)) ids.push('toilet');
    if (/ATM/i.test(text)) ids.push('atm');
    if (/Wi[- ]?Fi/i.test(text)) ids.push('wifi');
    if (/停車/i.test(text)) ids.push('parking');
    if (/休息/i.test(text)) ids.push('rest_area');
  }
  if (/24\s*\/\s*7|24小時|24 小時/.test(String(row?.opening_hours || ''))) ids.push('open_24h');
  return mergeServiceIds(ids);
}

/** OK mart ecservice row -> service ids. */
export function parseOkServices(row) {
  const ids = [];
  const text = [
    row?.EX_DESC,
    row?.STNM,
    row?.PICKBYSELF,
    row?.NORMAL,
    row?.FRIDGE,
    row?.FREEZE
  ]
    .map((v) => String(v || ''))
    .join(' ');
  if (/廁所|洗手間/.test(text)) ids.push('toilet');
  if (/ATM/i.test(text)) ids.push('atm');
  if (/WiFi|Wi-Fi/i.test(text)) ids.push('wifi');
  if (/咖啡|OK\s*CAFE|CAFE/i.test(text)) ids.push('coffee');
  if (/霜淇淋|冰淇淋|哈燒|熱點|現煮餐|鮮食/.test(text)) ids.push('hot_food');
  if (/思樂冰|冰沙/.test(text)) ids.push('slurpee');
  if (/寄取|網購|宅配|PICKBYSELF/i.test(text)) ids.push('delivery');

  const bgn = String(row?.BGN_TIME || '').trim();
  const end = String(row?.END_TIME || '').trim();
  if (bgn === '2359' && end === '0000') ids.push('open_24h');
  if (bgn === '0000' && end === '0000') ids.push('open_24h');
  if (/24\s*小時|24H/i.test(text)) ids.push('open_24h');

  return mergeServiceIds(ids);
}

export function servicesForBrand(brandId) {
  return CVS_SERVICE_BY_BRAND[brandId] || [];
}
