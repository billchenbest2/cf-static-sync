/** Hi-Life VIP app store API — GET member/V2/store.aspx (loc / district query). */
const BASE = 'https://appapi.hilife.com.tw';
const UA = 'Mobile';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function appGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': UA, Accept: 'application/json' }
  });
  const text = await res.text();
  if (!text.trim().startsWith('{')) throw new Error(`Hi-Life app API non-json: ${url}`);
  const json = JSON.parse(text);
  if (String(json?.RC) !== '1') {
    throw new Error(`Hi-Life app API RC=${json?.RC} RM=${json?.RM} url=${url}`);
  }
  return json;
}

export async function fetchHiLifeZipCodeTree() {
  const json = await appGet('/member/V2/get_zipcode_list.aspx');
  return json.results?.city || [];
}

export async function fetchHiLifeAppStoresByLoc(lat, lng) {
  const json = await appGet('/member/V2/store.aspx', { loc: `${lat},${lng}` });
  return json.results || [];
}

export async function fetchHiLifeAppStoresByDistrict(cityName, townName) {
  const json = await appGet('/member/V2/store.aspx', {
    district: `${cityName},${townName}`
  });
  return json.results || [];
}

/** Fetch all stores by iterating official zipcode districts; dedupe by id. */
export async function fetchAllHiLifeAppStores(options = {}) {
  const delayMs = options.delayMs ?? 180;
  const cities = await fetchHiLifeZipCodeTree();
  const byId = new Map();
  let queries = 0;
  for (const city of cities) {
    const dists = city.dist || [];
    for (const dist of dists) {
      queries++;
      process.stdout.write(`Hi-Life app ${city.name}${dist.name}...\r`);
      const rows = await fetchHiLifeAppStoresByDistrict(city.name, dist.name);
      for (const row of rows) {
        const id = String(row.id || '').trim();
        if (!id) continue;
        byId.set(id, { ...row, _cityName: city.name, _townName: dist.name });
      }
      if (delayMs) await sleep(delayMs);
    }
  }
  process.stdout.write('\n');
  console.log(`Hi-Life app API: ${queries} districts -> ${byId.size} unique stores`);
  return byId;
}

/** Taiwan grid for optional loc-based supplement. */
export function taiwanGridPoints(step = 0.35) {
  const points = [];
  for (let lat = 21.9; lat <= 25.5; lat += step) {
    for (let lng = 119.3; lng <= 122.1; lng += step) {
      points.push({ lat: +lat.toFixed(4), lng: +lng.toFixed(4) });
    }
  }
  return points;
}

export async function fetchHiLifeAppCoordsGrid(options = {}) {
  const delayMs = options.delayMs ?? 250;
  const byId = new Map();
  for (const { lat, lng } of taiwanGridPoints(options.gridStep ?? 0.35)) {
    const rows = await fetchHiLifeAppStoresByLoc(lat, lng);
    for (const row of rows) {
      const id = String(row.id || '').trim();
      const latN = parseFloat(row.latitude);
      const lngN = parseFloat(row.longitude);
      if (!id || !Number.isFinite(latN) || !Number.isFinite(lngN)) continue;
      byId.set(id, row);
    }
    if (delayMs) await sleep(delayMs);
  }
  return byId;
}
