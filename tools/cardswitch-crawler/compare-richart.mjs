/**
 * Compare crawled Richart (taishin) vs CardSwitch-main production data.
 */
import fs from 'node:fs';
import path from 'node:path';

const crawled = JSON.parse(
  fs.readFileSync(
    path.resolve(
      'c:/Users/Bill Chen/OneDrive/CardSwitch NEW Version/PaymentMapTW資料夾/cf-static-sync-main/data/cardswitch-test/cards/builtin/taishin/data.json',
    ),
    'utf8',
  ),
);
const current = JSON.parse(
  fs.readFileSync(
    path.resolve(
      'c:/Users/Bill Chen/OneDrive/CardSwitch NEW Version/CardSwitch-main/cards/builtin/taishin/data.json',
    ),
    'utf8',
  ),
);

function planKeys(obj) {
  return Object.keys(obj).filter((k) => Array.isArray(obj[k])).sort();
}

function sample(arr, n = 3) {
  return (arr || []).slice(0, n).map((row) => row[0]);
}

const crawlPlans = planKeys(crawled);
const currPlans = planKeys(current);

console.log('=== Richart / taishin compare ===');
console.log('crawled plans:', crawlPlans.join(', '));
console.log('current plans:', currPlans.join(', '));
console.log('crawled schemeNames:', crawled.schemeNames);
console.log('current schemeNames:', current.schemeNames);

const missingInCrawl = currPlans.filter((p) => !crawlPlans.includes(p));
const extraInCrawl = crawlPlans.filter((p) => !currPlans.includes(p));
console.log('missing in crawl (bad if any standard):', missingInCrawl);
console.log('extra in crawl (auto new plans OK):', extraInCrawl);

let ok = true;
for (const plan of ['chill', 'pay', 'day', 'big', 'eat', 'digital', 'travel', 'holiday']) {
  const a = crawled[plan] || [];
  const b = current[plan] || [];
  const ratio = b.length ? a.length / b.length : a.length ? 1 : 0;
  const status = a.length === 0 ? 'EMPTY' : ratio < 0.5 ? 'LOW' : 'OK';
  if (status !== 'OK') ok = false;
  console.log(
    `${plan}: crawl=${a.length} current=${b.length} ratio=${ratio.toFixed(2)} [${status}] samples=`,
    sample(a),
  );
}

if (!crawled.schemeNames || typeof crawled.schemeNames !== 'object') {
  console.log('FAIL: crawled missing schemeNames');
  ok = false;
} else {
  for (const plan of crawlPlans) {
    if (!crawled.schemeNames[plan]) {
      console.log('FAIL: schemeNames missing label for', plan);
      ok = false;
    }
  }
  console.log('schemeNames covers all plan keys:', ok ? 'yes' : 'check above');
}

// chill should have rates
const chillWithRate = (crawled.chill || []).filter((r) => r[1] && String(r[1]).includes('%'));
console.log(`chill rows with %: ${chillWithRate.length}/${(crawled.chill || []).length}`);
if (chillWithRate.length === 0) {
  console.log('FAIL: chill has no rates');
  ok = false;
}

console.log(ok ? '\nRESULT: Richart crawl looks GOOD' : '\nRESULT: Richart crawl has ISSUES');
process.exit(ok ? 0 : 1);
