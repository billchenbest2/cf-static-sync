/** OK mart ecservice store map API (ShowStore_Mobile.aspx WebMethods). */
const BASE = 'https://ecservice.okmart.com.tw/ECMapInquiry/ShowStore_Mobile.aspx';
const REF =
  'https://ecservice.okmart.com.tw/ECMapInquiry/ShowStore_Mobile?userip=&cvsid=&cvstemp=&temperature=01';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function okEcCall(method, payload, options = {}) {
  const retries = options.retries ?? 4;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}/${method}`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Referer: REF,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      lastErr = new Error(`OK ec ${method} HTTP ${res.status}`);
      if (attempt < retries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      throw lastErr;
    }
    if (!res.ok) throw new Error(`OK ec ${method} HTTP ${res.status}`);
    const json = await res.json();
    if (json?.Message && !json.d) throw new Error(`OK ec ${method}: ${json.Message}`);
    return Array.isArray(json.d) ? json.d : [];
  }
  throw lastErr || new Error(`OK ec ${method} failed`);
}

export async function fetchOkCities(temperature = '01') {
  const rows = await okEcCall('GetStoresCity', { temperature });
  const cities = [];
  const seen = new Set();
  for (const row of rows) {
    const city = String(row.STCITY || row.stcity || '').trim();
    if (!city || seen.has(city)) continue;
    seen.add(city);
    cities.push(city);
  }
  return cities;
}

export async function fetchOkDistricts(city, temperature = '01') {
  const rows = await okEcCall('GetStoresCntry', { city, temperature });
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const cntry = String(row.STCNTRY || row.stcntry || '').trim();
    if (!cntry || seen.has(cntry)) continue;
    seen.add(cntry);
    out.push(cntry);
  }
  return out;
}

export async function fetchOkRoads(city, cntry, temperature = '01') {
  const rows = await okEcCall('GetStoresRoad', { city, cntry, temperature });
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const road = String(row.STROAD || row.stroad || '').trim();
    if (!road || seen.has(road)) continue;
    seen.add(road);
    out.push(road);
  }
  return out;
}

export async function fetchOkStoresOnRoad(city, cntry, road, temperature = '01') {
  return okEcCall('GetStoresStreetResult', {
    city,
    cntry,
    road,
    userip: '',
    cvsid: '',
    uricvstemp: '',
    temperature
  });
}

/** Walk city -> district -> road and return deduped raw API rows keyed by STNO. */
export async function fetchAllOkEcRows(options = {}) {
  const temperature = options.temperature || '01';
  const delayMs = options.delayMs ?? 120;
  const cityFilter = options.cityFilter || null;
  const byStno = new Map();
  let roadsScanned = 0;

  const cities = await fetchOkCities(temperature);
  const targetCities = cityFilter ? cities.filter((c) => cityFilter.includes(c)) : cities;

  for (const city of targetCities) {
    const districts = await fetchOkDistricts(city, temperature);
    if (delayMs) await sleep(delayMs);
    for (const cntry of districts) {
      const roads = await fetchOkRoads(city, cntry, temperature);
      if (delayMs) await sleep(delayMs);
      for (const road of roads) {
        roadsScanned++;
        process.stdout.write(`OK ${city}${cntry}${road} (${byStno.size})...\r`);
        const stores = await fetchOkStoresOnRoad(city, cntry, road, temperature);
        for (const row of stores) {
          const stno = String(row.STNO || row.stno || '').trim();
          if (!stno) continue;
          byStno.set(stno, row);
        }
        if (delayMs) await sleep(delayMs);
      }
    }
  }

  process.stdout.write('\n');
  console.log(`OK ec API: ${roadsScanned} roads -> ${byStno.size} unique stores`);
  return byStno;
}
