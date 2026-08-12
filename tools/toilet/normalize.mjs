/** Normalize + coordinate field-shift repair for MOENV FAC_P_07 rows. */
import crypto from 'node:crypto';

export const COUNTY_CODE_MAP = {
  '10002': '台北市',
  '10003': '新北市',
  '10004': '桃園市',
  '10005': '台中市',
  '10006': '台南市',
  '10007': '高雄市',
  '10008': '基隆市',
  '10009': '新竹市',
  '10010': '嘉義市',
  '10018': '新竹縣',
  '10013': '苗栗縣',
  '10015': '彰化縣',
  '10016': '南投縣',
  '10017': '雲林縣',
  '10019': '嘉義縣',
  '10020': '屏東縣',
  '10021': '宜蘭縣',
  '10022': '花蓮縣',
  '10023': '台東縣',
  '10014': '澎湖縣',
  '10024': '金門縣',
  '10025': '連江縣',
  '63000': '台北市',
  '65000': '新北市',
  '68000': '桃園市',
  '66000': '台中市',
  '67000': '台南市',
  '64000': '高雄市'
};

export const COUNTY_EN_MAP = {
  台北市: 'Taipei',
  新北市: 'NewTaipei',
  桃園市: 'Taoyuan',
  台中市: 'Taichung',
  台南市: 'Tainan',
  高雄市: 'Kaohsiung',
  基隆市: 'Keelung',
  新竹市: 'HsinchuCity',
  嘉義市: 'ChiayiCity',
  新竹縣: 'HsinchuCounty',
  苗栗縣: 'Miaoli',
  彰化縣: 'Changhua',
  南投縣: 'Nantou',
  雲林縣: 'Yunlin',
  嘉義縣: 'ChiayiCounty',
  屏東縣: 'Pingtung',
  宜蘭縣: 'Yilan',
  花蓮縣: 'Hualien',
  台東縣: 'Taitung',
  澎湖縣: 'Penghu',
  金門縣: 'Kinmen',
  連江縣: 'Lienchiang'
};

const GRADE_RANK = {
  excellent: 5,
  good: 4,
  fair: 3,
  needs_improvement: 2,
  fail: 1
};

export function gradeFromZh(raw) {
  const s = String(raw || '');
  if (s.includes('特優')) return { grade: 'excellent', gradeZh: s || '特優' };
  if (s.includes('優等') || (s.includes('優') && !s.includes('特優'))) {
    return { grade: 'good', gradeZh: s || '優等' };
  }
  if (s.includes('普通')) return { grade: 'fair', gradeZh: s || '普通' };
  if (s.includes('加強')) return { grade: 'needs_improvement', gradeZh: s || '加強' };
  if (s.includes('不合格') || s.includes('不及格')) {
    return { grade: 'fail', gradeZh: s || '不合格' };
  }
  return { grade: 'fair', gradeZh: s || '普通' };
}

export function gradeRank(grade) {
  return GRADE_RANK[grade] || 0;
}

export function normalizeAddressKey(addr) {
  return String(addr || '')
    .replace(/\s+/g, '')
    .replace(/臺/g, '台')
    .toLowerCase();
}

export function getCountyFromAddress(address) {
  if (!address) return null;
  const a = String(address).replace(/臺/g, '台');
  const prefix = a.substring(0, 3);
  const map = {
    台北市: '台北市',
    新北市: '新北市',
    桃園市: '桃園市',
    台中市: '台中市',
    台南市: '台南市',
    高雄市: '高雄市',
    基隆市: '基隆市',
    新竹市: '新竹市',
    新竹縣: '新竹縣',
    嘉義市: '嘉義市',
    嘉義縣: '嘉義縣',
    苗栗縣: '苗栗縣',
    彰化縣: '彰化縣',
    南投縣: '南投縣',
    雲林縣: '雲林縣',
    屏東縣: '屏東縣',
    宜蘭縣: '宜蘭縣',
    花蓮縣: '花蓮縣',
    台東縣: '台東縣',
    澎湖縣: '澎湖縣',
    金門縣: '金門縣',
    連江縣: '連江縣'
  };
  return map[prefix] || null;
}

function inTaiwan(lat, lng) {
  return lat >= 20 && lat <= 27 && lng >= 118 && lng <= 123;
}

/** Recover lat/lng when MOENV fields are shifted (ported from where-toilets). */
export function repairCoordinates(raw) {
  let latitude = parseFloat(raw.latitude);
  let longitude = parseFloat(raw.longitude);
  let repaired = false;

  if ((!Number.isFinite(latitude) || !latitude) && raw.latitude && typeof raw.latitude === 'string') {
    const altLat1 = parseFloat(raw.longitude);
    const altLng1 = parseFloat(raw.grade);
    if (Number.isFinite(altLat1) && Number.isFinite(altLng1) && inTaiwan(altLat1, altLng1)) {
      latitude = altLat1;
      longitude = altLng1;
      repaired = true;
    }
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !latitude || !longitude) {
    const altLat2 = parseFloat(raw.grade);
    const altLng2 = parseFloat(raw.type2);
    if (Number.isFinite(altLat2) && Number.isFinite(altLng2) && inTaiwan(altLat2, altLng2)) {
      latitude = altLat2;
      longitude = altLng2;
      repaired = true;
    }
  }

  if (!Number.isFinite(latitude)) latitude = 0;
  if (!Number.isFinite(longitude)) longitude = 0;
  return { latitude, longitude, repaired };
}

export function detectType(rawName, rawType) {
  const name = String(rawName || '');
  const type = String(rawType || '');
  const blob = name + ' ' + type;
  if (/無障礙/.test(blob) || /accessible/i.test(blob)) return 'accessible';
  if (/親子|育嬰|尿布/.test(blob) || /family/i.test(type)) return 'family';
  if (/混合|男女|兩性/.test(blob) || /mixed/i.test(type)) return 'mixed';
  if (/女/.test(blob) && !/男女/.test(blob)) return 'female';
  if (/男/.test(blob) && !/男女/.test(blob)) return 'male';
  if (/女廁/.test(type)) return 'female';
  if (/男廁/.test(type)) return 'male';
  return 'mixed';
}

export function detectCategory(type2) {
  const s = String(type2 || '');
  if (/交通|場站|捷運|高鐵|台鐵|車站|機場|客運/.test(s)) {
    return { category: 'transport', categoryZh: s || '交通場站' };
  }
  if (/公園|綠地/.test(s)) return { category: 'park', categoryZh: s || '公園綠地' };
  if (/風景|遊憩|觀光|遊樂/.test(s)) {
    return { category: 'tourist', categoryZh: s || '風景遊憩' };
  }
  if (/商業|營業|賣場|百貨|商場/.test(s)) {
    return { category: 'commercial', categoryZh: s || '商業營業場所' };
  }
  return { category: 'other', categoryZh: s || '其他' };
}

export function hasChangingTable(unit) {
  const name = String((unit && (unit.name || unit.name_zh)) || '');
  const type = String((unit && unit.type) || '');
  const diaper =
    unit &&
    (unit.hasDiaper != null
      ? unit.hasDiaper
      : unit.diaper != null
        ? unit.diaper
        : unit.has_diaper);

  if (diaper === true || diaper === 1 || diaper === '1' || diaper === '是' || diaper === 'true') {
    return true;
  }
  if (/親子|育嬰|尿布|baby/i.test(name) || type === 'family') return true;
  if (
    diaper === false ||
    diaper === 0 ||
    diaper === '0' ||
    diaper === '無' ||
    diaper === 'false' ||
    diaper === 'no'
  ) {
    if (/親子/.test(name) || type === 'family') return true;
    return false;
  }
  return false;
}

export function stripTypeSuffix(name) {
  let s = String(name || '').trim();
  s = s.replace(
    /[-_－—\s]*(無障礙廁所|無障礙|親子廁所|親子|男女混合|混合廁所|混合|男廁所|女廁所|男廁|女廁|男女|男|女)\s*$/u,
    ''
  );
  s = s.replace(/[-_－—\s]+$/u, '');
  return s.trim() || String(name || '').trim();
}

export function normalizeToiletRow(raw) {
  const address = String(raw.address || '').trim();
  let countyZh = getCountyFromAddress(address);
  if (!countyZh) {
    const code = String(raw.county || '').trim();
    countyZh = COUNTY_CODE_MAP[code] || null;
    if (!countyZh && /[縣市]$/.test(code)) {
      countyZh = code.replace(/臺/g, '台');
    }
  }
  const { latitude, longitude, repaired } = repairCoordinates(raw);
  const name = String(raw.name || '').trim();
  const type = detectType(name, raw.type);
  const gradeInfo =
    repaired && !String(raw.grade || '').match(/[優普加不特]/)
      ? { grade: 'fair', gradeZh: '' }
      : gradeFromZh(raw.grade);
  const cat = detectCategory(raw.type2);
  const diaperRaw = raw.diaper;
  const hasDiaper =
    diaperRaw === 1 || diaperRaw === '1' || diaperRaw === true || diaperRaw === '是';

  return {
    sourceId: String(raw.number || '').trim(),
    name,
    baseName: stripTypeSuffix(name),
    address,
    city: countyZh || '',
    town: String(raw.areacode || raw.village || '').trim(),
    village: String(raw.village || '').trim(),
    lat: latitude,
    lng: longitude,
    coordRepaired: repaired,
    type,
    typeZh: String(raw.type || '').trim(),
    grade: gradeInfo.grade,
    gradeZh: gradeInfo.gradeZh || String(raw.grade || '').trim(),
    category: cat.category,
    categoryZh: cat.categoryZh,
    hasDiaper,
    administration: String(raw.administration || '').trim(),
    manager: String(raw.exec || '').trim(),
    countyEn: COUNTY_EN_MAP[countyZh] || '',
    raw
  };
}

export function normalizeAll(rawRows) {
  const units = [];
  const filtered = {
    noCoordinates: [],
    unknownCounty: [],
    invalidData: [],
    repairedCoords: 0
  };

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    try {
      const u = normalizeToiletRow(raw);
      if (!u.lat || !u.lng || !inTaiwan(u.lat, u.lng)) {
        filtered.noCoordinates.push({
          index: i,
          id: raw.number,
          name: raw.name,
          address: raw.address,
          reason: 'missing_or_out_of_range'
        });
        continue;
      }
      if (!u.city || !COUNTY_EN_MAP[u.city]) {
        filtered.unknownCounty.push({
          index: i,
          id: raw.number,
          name: raw.name,
          address: raw.address,
          county: raw.county
        });
        continue;
      }
      if (u.coordRepaired) filtered.repairedCoords += 1;
      units.push(u);
    } catch (e) {
      filtered.invalidData.push({ index: i, error: String(e && e.message) });
    }
  }

  return { units, filtered };
}

export function hashId(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}
