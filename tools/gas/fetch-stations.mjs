#!/usr/bin/env node
/**
 * Fetch CPC open-data stations + FPCC official Formosa-network stations, write stations.json.
 *
 * Output: data/gas/stations.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveBrandId,
  normalizeFranchiseType,
  BRAND_BY_ID
} from './brands.mjs';
import { fetchAllFpccStations, mergeFpccStations } from './fetch-fpcc-stations.mjs';
import { fetchAllSmileStations } from './fetch-smile-stations.mjs';
import { mergeExternalStations } from './station-merge.mjs';
import { parseCpcServices } from './services.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'data/gas/stations.json');
const RAW_DIR = path.join(ROOT, 'data/gas/raw');

const CPC_STATION_URL =
  'https://vipmbr.cpc.com.tw/CPCSTN/STNWebService.asmx/getStationInfo_XML';

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
}

function parseCpcStations(xml) {
  const chunks = xml.split(/<\/Table>/i);
  const list = [];
  for (const chunk of chunks) {
    if (!/<站代號>/.test(chunk)) continue;
    const open = tag(chunk, '營業中');
    if (open === '0') continue;
    const stationCode = tag(chunk, '站代號');
    const name = tag(chunk, '站名');
    const category = tag(chunk, '類別');
    const city = tag(chunk, '縣市');
    const town = tag(chunk, '鄉鎮區');
    const address = tag(chunk, '地址');
    const phone = tag(chunk, '電話');
    const lng = parseFloat(tag(chunk, '經度'));
    const lat = parseFloat(tag(chunk, '緯度'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const brandId = resolveBrandId(name, category.includes('台糖') ? '台糖' : name);
    let brand = brandId;
    if (brand === 'other') brand = /台糖/.test(name) ? 'taisugar' : 'cpc';

    const products = [];
    if (tag(chunk, '無鉛92') === '1') products.push('92');
    if (tag(chunk, '無鉛95') === '1') products.push('95');
    if (tag(chunk, '無鉛98') === '1') products.push('98');
    if (tag(chunk, '超柴') === '1') products.push('diesel');

    const fullAddress = `${city}${town}${address}`.replace(/\s+/g, '');
    const services = parseCpcServices(chunk, tag);
    const hours = tag(chunk, '營業時間');
    list.push({
      stationId: `cpc_${stationCode}`,
      name: /中油|台糖|台塑|全國|台亞|福懋|速邁樂|山隆|北基/.test(name)
        ? name
        : `中油${name}`,
      lat,
      lng,
      address: fullAddress,
      phone,
      city,
      town,
      brandId: brand,
      franchiseType: normalizeFranchiseType(category),
      oilSupply: (BRAND_BY_ID[brand] && BRAND_BY_ID[brand].oilSupplyDefault) || 'cpc',
      products,
      services,
      hours: hours || undefined,
      source: 'cpc_opendata',
      sourceUpdatedAt: new Date().toISOString().slice(0, 10),
      status: 'open',
      sourceStationCode: stationCode,
      sourceCategory: category
    });
  }
  return list;
}

function brandCounts(stations) {
  const c = {};
  for (const s of stations) {
    c[s.brandId] = (c[s.brandId] || 0) + 1;
  }
  return c;
}

async function main() {
  console.log('Fetching CPC stations...');
  const res = await fetch(CPC_STATION_URL, {
    headers: { 'User-Agent': 'PaymentMapTW-gas-station-bot/1.0' }
  });
  if (!res.ok) throw new Error(`CPC stations HTTP ${res.status}`);
  const xml = await res.text();
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, 'cpc-stations.xml'), xml, 'utf8');

  let stations = parseCpcStations(xml);
  console.log('CPC open stations:', stations.length);

  try {
    const fpccStations = await fetchAllFpccStations();
    console.log('FPCC total rows:', fpccStations.length);
    stations = mergeFpccStations(stations, fpccStations);
  } catch (e) {
    console.error('FPCC merge failed:', e.message);
    process.exit(1);
  }

  try {
    const smileStations = await fetchAllSmileStations();
    stations = mergeExternalStations(stations, smileStations, 'Smile', { preferSourceBrand: true });
  } catch (e) {
    console.warn('Smile merge skipped:', e.message);
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    count: stations.length,
    brandCounts: brandCounts(stations),
    stations
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload), 'utf8');
  console.log('Wrote', OUT);
  console.log('brandCounts', payload.brandCounts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
