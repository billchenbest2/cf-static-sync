import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHsbcMerchants,
  parseHsbcHtml,
  parseUbotHtml,
  parseTableMiles,
  parseCathayAirmilesModel,
  parseCubeModel,
  extractPlanDefaultPercent,
  normalizeCtbcOfferPeriod,
  parseCtbcLinepayHtml,
  validateParsedOutput,
  formatEsunPlanText,
  parseEsunMilesEntries,
  parseUnicardHtml,
  parseDbsMilesPage,
  parseDbsMilesCategories,
  normalizeDbsMilesRate,
  formatDbsMilesRateRaw,
  DBS_MILES_PAGE_CONFIG,
  parseHsbcFlyMiles,
  parseHsbcTravelCardData,
  parseHsbcTravelPointsToCash,
  parseHsbcTravelEarnFromIndexHtml,
  extractUnicardSections,
  selectActiveUnicardSection,
  parseCathayAsiaMilesHtml,
  parseEsunStarluxHtml,
  parseCtbcCalHtml,
  parseDbsAovMerchants,
  mergeDbsAovCrawledData,
  parseRichartHtml,
  stampUpdatedAt,
  shouldRewriteManagedJson,
} from './parsers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CARDSWITCH_ROOT = path.resolve(__dirname, '../../../../CardSwitch-main');
const ROOT = path.resolve(
  process.env.CARDSWITCH_REPO_ROOT ||
    (fs.existsSync(path.join(DEFAULT_CARDSWITCH_ROOT, 'cards'))
      ? DEFAULT_CARDSWITCH_ROOT
      : path.resolve(__dirname, '../..')),
);

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function readRepoJson(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing CardSwitch file (ROOT=${ROOT}): ${relPath}`);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

describe('crawler parsers — fixture tests', () => {
  it('hsbc: expands parenthesized brand lists (no broken names)', () => {
    const html = readFixture('hsbc-merchants-snippet.html');
    const merchants = parseHsbcMerchants(html);
    const names = merchants.map((m) => m.name);
    assert.ok(names.includes('王品集團'), `names=${names.join(',')}`);
    assert.ok(names.includes('享鴨'), `names=${names.join(',')}`);
    assert.ok(names.includes('夏慕尼'), `names=${names.join(',')}`);
    assert.ok(names.includes('鼎泰豐'), `names=${names.join(',')}`);
    assert.ok(names.includes('饗饗'), `names=${names.join(',')}`);
    for (const name of names) {
      assert.ok(!/^[(\)（）]|[)）]$/.test(name), `broken name: ${name}`);
    }
    assert.deepEqual(validateParsedOutput('hsbc', { merchants, rewards: { domestic: { base: { rate: 1 } } } }), []);
  });

  it('cathay miles: parses official airmiles.model.json tables', () => {
    const model = JSON.parse(readFixture('cathay-airmiles-snippet.model.json'));
    const rows = parseCathayAirmilesModel(model);
    assert.ok(rows.length >= 20);
    const eva = rows.find((r) => r.airline === '長榮航空' && r.plan === '世界卡');
    assert.ok(eva);
    assert.equal(eva.cost_points, 300);
    assert.equal(eva.redeemed_miles, 1000);
    const cx = rows.find((r) => r.airline === '國泰航空' && r.plan === '世界卡');
    assert.ok(cx);
    assert.equal(cx.cost_points, 300);
    const emirates = rows.find((r) => r.airline === '阿聯酋航空Skywards');
    assert.ok(emirates);
    assert.equal(emirates.plan, '全卡別');
    assert.equal(emirates.cost_points, 550);
    const shangri = rows.find((r) => r.airline === '香格里拉會');
    assert.ok(shangri);
    assert.equal(shangri.redeemed_miles, 250);
    assert.deepEqual(validateParsedOutput('miles-row', rows), []);
    for (const row of rows) {
      assert.ok(!/還不是會員|點此註冊/.test(JSON.stringify(row)));
    }
  });

  it('cathay miles: legacy google sheet row format still supported', () => {
    const html = readFixture('cathay-miles-snippet.html');
    const rows = parseTableMiles(html, 'cathay');
    assert.ok(rows.length >= 2);
    const eva = rows.find((r) => r.airline === '長榮航空' && r.plan === '世界卡');
    assert.ok(eva);
    assert.equal(eva.cost_points, 300);
    assert.equal(eva.redeemed_miles, 1000);
  });

  it('esun miles: formats plan text like legacy (點→)', () => {
    const plan = formatEsunPlanText(
      '每1,200 點e point兌換 1,500 哩\n每月限量1,000份，兌換完為止',
    );
    assert.equal(plan, '每1,200 點→ 1,500 哩');
    const rows = parseEsunMilesEntries([
      {
        Name: '中華航空哩程',
        ProductDescription: '每200 點e point兌換 180 哩',
        IsStock: false,
        Stock: 0,
        productsDetailsResponse: [{ ExchangePoint: 200 }],
      },
    ]);
    assert.equal(rows[0].plan, '每200 點→ 180 哩');
  });

  it('unicard: picks table for active date range (H1 vs H2)', () => {
    const html = readFixture('unicard-dual-period.html');
    assert.equal(extractUnicardSections(html).length, 2);

    const jun25 = new Date(2026, 5, 25);
    const h1 = parseUnicardHtml(html, jun25).map((x) => x[0]);
    assert.ok(h1.includes('餐飲美食：EZTABLE'));
    assert.ok(!h1.includes('行動支付：支付寶'));
    assert.ok(!h1.includes('餐飲美食：王品瘋Pay'));

    const jul1 = new Date(2026, 6, 1);
    const h2 = parseUnicardHtml(html, jul1).map((x) => x[0]);
    assert.ok(h2.includes('行動支付：支付寶'));
    assert.ok(h2.includes('餐飲美食：王品瘋Pay'));
    assert.ok(!h2.includes('餐飲美食：EZTABLE'));

    const gap = new Date(2025, 8, 15);
    assert.equal(selectActiveUnicardSection(html, gap), null);
  });

  it('cube: excludes campaign-period promo lines from merchant lists', () => {
    const model = JSON.parse(readFixture('cube-campaign-snippet.model.json'));
    const out = parseCubeModel(model.root);
    const names = out.fun.map((x) => x[0]);
    assert.ok(names.includes('新光三越'));
    assert.ok(!names.some((n) => /外出用餐|美食家|前往活動網頁/.test(n)));
    assert.ok(!out.fun.some((x) => String(x[2]).startsWith('活動期間')));
  });

  it('cube: extractPlanDefaultPercent picks single designated rate from mainTitle', () => {
    const mainTitle = '<h3>全支付</h3><p>0.3%一般</p><p style="font-weight:bold">2%</p>';
    assert.equal(extractPlanDefaultPercent(mainTitle), '2%');
    const kidsTitle = '<p>1%</p><p>5%</p><p>10%</p>';
    assert.equal(extractPlanDefaultPercent(kidsTitle), '');
  });

  it('richart: parses Chill刷 merchants with per-store rates', () => {
    const html = `
      <div class="seven-plan chill-plan">
        <div class="plan-item">
          <div class="plan-tag">瘋聚會</div>
          <div class="item-row">
            <div class="item-col-full">
              <div class="item-col-title">【歡聚微醺】<span>10</span><small>%</small></div>
              <div class="item-col-text">海底撈 / 屋馬燒肉</div>
            </div>
            <div class="item-col-full">
              <div class="item-col-title">【約會犒賞】<span>5</span><small>%</small></div>
              <div class="item-col-text">饗饗 INPARADISE</div>
            </div>
          </div>
        </div>
      </div>
      <div class="search-area">
        <div class="seven-plan">
          <div class="tab-table active" id="tab-b">
            <div class="plan-item">
              <div class="plan-tag">Pay著刷</div>
              <div class="item-col-text">全家｜7-11</div>
            </div>
            <div class="plan-item">
              <div class="plan-tag">天天刷<span>3.3</span><small>%</small></div>
              <div class="item-col-text">萬家福｜樂家康</div>
            </div>
          </div>
        </div>
      </div>
      </section>`;
    const out = parseRichartHtml(html);
    assert.ok(out.chill.length >= 3);
    const hotpot = out.chill.find((row) => row[0] === '海底撈');
    assert.ok(hotpot);
    assert.equal(hotpot[1], '10%');
    const buffet = out.chill.find((row) => row[0] === '饗饗 INPARADISE');
    assert.ok(buffet);
    assert.equal(buffet[1], '5%');
    assert.ok(out.pay.some((row) => row[0] === '全家'));
    assert.ok(out.day.some((row) => row[0] === '萬家福'));
  });

  it('richart: chill keeps slash inside parentheses (date promos)', () => {
    const html = `
      <div class="seven-plan chill-plan">
        <div class="plan-item">
          <div class="item-row">
            <div class="item-col-full">
              <div class="item-col-title">【數位加碼】<span>3.3</span><small>%</small></div>
              <div class="item-col-text">愛爾達 / Samsung(7/30–8/31限時加碼!!) / Apple 直營(含官網)</div>
            </div>
          </div>
        </div>
      </div>
      <div class="search-area">
        <div class="seven-plan">
          <div class="tab-table active" id="tab-b"></div>
        </div>
      </div>
      </section>`;
    const out = parseRichartHtml(html);
    assert.ok(out.chill.some((row) => row[0] === '愛爾達' && row[1] === '3.3%'));
    assert.ok(out.chill.some((row) => row[0] === 'Samsung(7/30–8/31限時加碼!!)' && row[1] === '3.3%'));
    assert.ok(out.chill.some((row) => row[0] === 'Apple 直營(含官網)' && row[1] === '3.3%'));
    assert.equal(out.chill.some((row) => row[0] === 'Samsung(7'), false);
    assert.equal(out.chill.some((row) => row[0] === '30–8'), false);
  });

  it('richart: auto-discovers unknown classic plans into schemeNames', () => {
    const html = `
      <div class="search-area">
        <div class="seven-plan">
          <div class="tab-table active" id="tab-b">
            <div class="plan-item">
              <div class="plan-tag">Pay著刷</div>
              <div class="item-col-text">全家｜7-11</div>
            </div>
            <div class="plan-item">
              <div class="plan-tag">新方案刷</div>
              <div class="item-col-text">測試商家甲｜測試商家乙</div>
            </div>
          </div>
        </div>
      </div>
      </section>`;
    const out = parseRichartHtml(html);
    assert.ok(out.schemeNames);
    assert.equal(out.schemeNames.pay, 'Pay著刷');
    const extraKeys = Object.keys(out).filter(
      (k) => k !== 'schemeNames' && Array.isArray(out[k]) && !['chill', 'pay', 'day', 'big', 'eat', 'digital', 'travel', 'holiday'].includes(k),
    );
    assert.equal(extraKeys.length, 1);
    const extraKey = extraKeys[0];
    assert.equal(out.schemeNames[extraKey], '新方案刷');
    assert.ok(out[extraKey].some((row) => row[0] === '測試商家甲'));
    assert.ok(out[extraKey].some((row) => row[0] === '測試商家乙'));
  });

  it('richart: parses Pay著刷/假日刷 payment channels cleanly', () => {
    const html = `
      <div class="search-area">
        <div class="seven-plan">
          <div class="tab-table active" id="tab-b">
            <div class="plan-item">
              <div class="plan-tag">Pay著刷</div>
              <div class="item-col-text">
                * 台新Pay｜全家、7-11、新光三越、Richart Mart、康是美、IKEA、NET 等，詳見台新Pay官網<br>
                * 台新Pay(TWQR、台灣Pay)｜神腦、燦坤、全國電子、麥當勞、美廉社、大樹藥局等，詳見台灣Pay場域<br>
                * 台新Pay+｜日韓交易再享免1.5%國外交易手續費，含日本LAWSON、BicCamera；韓國GS25、DAISO等，詳見台新Pay+官網
              </div>
            </div>
            <div class="plan-item">
              <div class="plan-tag">假日刷</div>
              <div class="item-col-text">LINE Pay 及 全盈+Pay(7/8起新增)綁定支付享 2.3%</div>
            </div>
            <div class="plan-item">
              <div class="plan-tag">大筆刷</div>
              <div class="item-col-text">MITSUI OUTLET PARK (林口/台中港/台南)｜華泰名品城｜SKM
                Park Outlets</div>
            </div>
          </div>
        </div>
      </div>
      </section>`;
    const out = parseRichartHtml(html);
    assert.ok(out.pay.some((row) => row[0] === '全家'));
    assert.ok(out.pay.some((row) => row[0] === '大樹藥局'));
    assert.ok(out.pay.some((row) => /LAWSON/.test(row[0])));
    assert.ok(out.pay.some((row) => /GS25/.test(row[0])));
    assert.ok(out.holiday.some((row) => row[0] === 'LINE Pay') || out.pay.some((row) => row[0] === 'LINE Pay'));
    assert.ok(out.holiday.some((row) => /全盈\+Pay/.test(row[0])) || out.pay.some((row) => /全盈\+Pay/.test(row[0])));
    assert.ok(!out.pay.some((row) => /台灣Pay\)|BicCamera；韓國GS25/.test(row[0])));
    assert.ok(out.big.some((row) => row[0] === 'SKM Park Outlets'));
    assert.ok(!out.big.some((row) => row[0] === 'SKM'));
    assert.ok(!out.big.some((row) => row[0] === 'Park Outlets'));
  });
});

describe('crawler parsers — repo data invariants', () => {
  it('hsbc data.json passes structural validation', () => {
    const data = readRepoJson('cards/builtin/hsbc/data.json');
    const errors = validateParsedOutput('hsbc', data);
    assert.deepEqual(errors, [], errors.join('; '));
  });

  it('ubot data.json passes structural validation', () => {
    const data = readRepoJson('cards/builtin/ubot/data.json');
    const errors = validateParsedOutput('ubot', data);
    assert.deepEqual(errors, [], errors.join('; '));
  });

  it('ctbcLinepay data.json passes structural validation', () => {
    const data = readRepoJson('cards/builtin/ctbcLinepay/data.json');
    const errors = validateParsedOutput('ctbcLinepay', data);
    assert.deepEqual(errors, [], errors.join('; '));
  });

  it('ctbcLinepay: normalizes inverted period year typo from official HTML', () => {
    assert.equal(normalizeCtbcOfferPeriod('2026/1/1~2025/6/30'), '2026/1/1~2026/6/30');
    assert.equal(normalizeCtbcOfferPeriod('2026/1/1~2026/6/30'), '2026/1/1~2026/6/30');
    assert.equal(normalizeCtbcOfferPeriod(''), '');
  });

  it('ctbcLinepay: extracts and resolves store detailUrl from name link', () => {
    const html = `
      <div class="tab-content__item" id="food">
        <h2 class="store-title">脆饗食</h2>
        <div class="store-table__data">
          <div class="store-table__col">
            <a href="page_food.html#lightbox_demo" target="_blank">
              <h3 class="store-table__name">Demo Store</h3>
            </a>
            <p class="store-table__date">2026/7/1~2026/12/31</p>
          </div>
          <div class="store-table__col"><p class="store-table__txt"><span class="store-table__text">5%</span></p></div>
          <div class="store-table__col"><p class="store-table__noticeTxt"><span>Visa卡 需登錄</span></p></div>
        </div>
      </div>`;
    const sourceUrl = 'https://www.ctbcbank.com/content/dam/minisite/long/creditcard/LINEPay/store.html';
    const out = parseCtbcLinepayHtml(html, sourceUrl);
    assert.equal(out.merchants.length, 1);
    assert.equal(out.merchants[0].offers[0].detailUrl,
      'https://www.ctbcbank.com/content/dam/minisite/long/creditcard/LINEPay/page_food.html#lightbox_demo');
  });

  it('cathay miles_data passes row validation', () => {
    const data = readRepoJson('miles_data/cathay_miles_data.json');
    const errors = validateParsedOutput('miles-row', data);
    assert.deepEqual(errors, [], errors.join('; '));
    assert.ok(data.length >= 10);
  });

  it('dbs miles_data passes categorized validation', () => {
    const data = readRepoJson('miles_data/dbs_miles_data.json');
    const errors = validateParsedOutput('dbs-miles', data);
    assert.deepEqual(errors, [], errors.join('; '));
    assert.equal(data.categories.length, 4);
  });

  it('hsbc miles_data passes categorized validation', () => {
    const data = readRepoJson('miles_data/hsbc_miles_data.json');
    const errors = validateParsedOutput('hsbc-miles', data);
    assert.deepEqual(errors, [], errors.join('; '));
    assert.equal(data.categories.length, 4);
    const travel = data.categories.find((cat) => cat.id === 'travel');
    assert.ok(travel.rates.length >= 16);
    assert.ok(travel.rates.some((row) => row.airline === '華夏哩程酬賓計劃'));
    assert.ok(!travel.rates.some((row) => String(row.airline).startsWith('=')));
  });

  it('hsbc fly miles: parses travel and other card tables from fixture', () => {
    const html = readFixture('hsbc-fly-miles-snippet.html');
    const data = parseHsbcFlyMiles(html);
    const errors = validateParsedOutput('hsbc-miles', data);
    assert.deepEqual(errors, [], errors.join('; '));
    assert.equal(data.categories.length, 4);
    const travel = data.categories.find((cat) => cat.id === 'travel');
    assert.ok(travel.rates.length >= 16);
    assert.equal(travel.rates[0].airline, '華夏哩程酬賓計劃');
    const cash = data.categories.find((cat) => cat.id === 'cash_cards');
    assert.equal(cash.rates.length, 4);
    assert.ok(cash.rates.every((row) => row.pointsPerMile === 1 && row.milesEarned === 2));
  });

  it('dbs miles: normalizes point/mile ratios', () => {
    assert.deepEqual(normalizeDbsMilesRate(27000, 3000), {
      cost_points: 900,
      redeemed_miles: 100,
      plan: '每900點換100哩',
    });
    assert.deepEqual(normalizeDbsMilesRate(50, 100), {
      cost_points: 50,
      redeemed_miles: 100,
      plan: '每50點換100哩',
    });
  });

  it('dbs miles: preserves official page point/mile packages', () => {
    assert.deepEqual(formatDbsMilesRateRaw(27000, 3000, { pointLabel: '活利積分' }), {
      cost_points: 27000,
      redeemed_miles: 3000,
      plan: '每27,000點活利積分兌換3,000哩',
    });
    assert.deepEqual(formatDbsMilesRateRaw(6000, 6000, { carrier: '長榮航空' }), {
      cost_points: 6000,
      redeemed_miles: 6000,
      plan: '長榮航空｜每6,000點換6,000哩',
    });
  });

  it('dbs miles: parses categorized page snippets from __NEXT_DATA__', () => {
    const wrap = (body) =>
      `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { content: { TabBody: body } } },
      })}</script></html>`;

    const bonus = parseDbsMilesPage(
      wrap(
        '<p>活動期間：即日起~2026/12/31</p><p>兌換方式如下：</p><ul><li>每27,000點活利積分兌換3,000「華夏哩程酬賓計劃」哩程</li><li>每15,000點活利積分兌換3,000「長榮無限萬哩遊」哩程</li></ul>',
      ),
      DBS_MILES_PAGE_CONFIG[0],
    );
    assert.equal(bonus.id, 'bonus');
    assert.equal(bonus.rates.length, 2);
    assert.equal(bonus.rates[0].airline, '華夏哩程酬賓計劃');
    assert.equal(bonus.rates[0].cost_points, 27000);
    assert.equal(bonus.rates[0].redeemed_miles, 3000);

    const fly = parseDbsMilesPage(
      wrap(
        '<p>飛行積金兌換哩程獎勵計畫方式如下：</p><ul><li>長榮航空：6,000點飛行積金可兌換 6,000「長榮無限萬哩遊」哩程</li></ul>',
      ),
      DBS_MILES_PAGE_CONFIG[2],
    );
    assert.equal(fly.rates[0].cost_points, 6000);
    assert.equal(fly.rates[0].redeemed_miles, 6000);

    const grouped = parseDbsMilesCategories({
      bonus: wrap(
        '<p>兌換方式如下：</p><ul><li>每15,000點活利積分兌換3,000「亞洲萬里通」哩程</li></ul>',
      ),
      cash: wrap(
        '<p>兌換方式如下：</p><ul><li>每50點現金積點/現金紅利兌換100「長榮無限萬哩遊」哩程</li></ul>',
      ),
      fly: wrap(
        '<p>飛行積金兌換哩程獎勵計畫方式如下：</p><ul><li>新加坡航空：6,000點飛行積金可兌換 6,000「新航獎勵計劃KrisFlyer」哩程</li></ul>',
      ),
      pchome: wrap(
        '<p>PChome聯名紅利點數兌換</p><ul><li>每1,500點PChome聯名紅利點數兌換3,000「長榮無限萬哩遊」哩程</li></ul>',
      ),
    });
    const errors = validateParsedOutput('dbs-miles', grouped);
    assert.deepEqual(errors, [], errors.join('; '));
    assert.equal(grouped.categories.length, 4);
  });
});

describe('crawler parsers — live fetch (optional)', () => {
  it('hsbc live page parses without broken merchant names', { skip: !process.env.CRAWLER_LIVE_TEST }, async () => {
    const resp = await fetch('https://www.hsbc.com.tw/credit-cards/products/liveplus/', {
      headers: { 'User-Agent': 'CardSwitch-crawler-test/1.0' },
    });
    assert.equal(resp.status, 200);
    const data = parseHsbcHtml(await resp.text());
    const errors = validateParsedOutput('hsbc', data);
    assert.deepEqual(errors, [], errors.join('; '));
  });

  it('dbs live pages parse four categorized miles tables', { skip: !process.env.CRAWLER_LIVE_TEST }, async () => {
    const htmlById = Object.fromEntries(
      await Promise.all(
        DBS_MILES_PAGE_CONFIG.map(async (category) => {
          const url = `https://www.dbs.com.tw/personal-zh/cards/rewards/${category.path}`;
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'CardSwitch-crawler-test/1.0', 'Accept-Language': 'zh-TW,zh;q=0.9' },
          });
          assert.equal(resp.status, 200, url);
          return [category.id, await resp.text()];
        }),
      ),
    );
    const data = parseDbsMilesCategories(htmlById);
    const errors = validateParsedOutput('dbs-miles', data);
    assert.deepEqual(errors, [], errors.join('; '));
    assert.equal(data.categories.length, 4);
    assert.ok(data.categories.every((cat) => cat.rates.length >= 2));
  });

  it('cathay asia miles: parses AM product page tiers and accelerator stores', () => {
    const html = readFixture('cathay-asia-miles-snippet.html');
    const data = parseCathayAsiaMilesHtml(html);
    assert.equal(data.tiers.length, 4);
    const world = data.tiers.find((t) => t.id === 'world');
    assert.ok(world);
    assert.equal(world.billCapTwd, 150000);
    const general = world.options.find((o) => o.id === 'general');
    assert.equal(general.amount, 22);
    const acc = world.options.find((o) => o.id === 'accelerator');
    assert.equal(acc.amount, 10);
    const birthday = world.options.find((o) => o.id === 'birthday');
    assert.equal(birthday.amount, 5);
    const enjoy = data.tiers.find((t) => t.id === 'enjoy');
    assert.equal(enjoy.billCapTwd, null);
    assert.ok(data.acceleratorStores.includes('屈臣氏'));
    assert.ok(data.storeCategories['旅遊'].includes('KKday'));
    assert.deepEqual(validateParsedOutput('cathay-asia-miles', data), []);
  });

  it('esun starlux: parses co-branded page tiers and designated stores', () => {
    const html = readFixture('esun-starlux-snippet.html');
    const data = parseEsunStarluxHtml(html);
    assert.equal(data.tiers.length, 4);
    const world = data.tiers.find((t) => t.id === 'world');
    assert.ok(world);
    const domestic = world.options.find((o) => o.id === 'domestic');
    assert.equal(domestic.amount, 20);
    const overseas = world.options.find((o) => o.id === 'overseas');
    assert.equal(overseas.amount, 10);
    const designated = world.options.find((o) => o.id === 'designated');
    assert.equal(designated.amount, 10);
    const birthday = world.options.find((o) => o.id === 'birthday');
    assert.equal(birthday.name, '生日禮 (需登錄)');
    assert.equal(birthday.amount, 5);
    const titanium = data.tiers.find((t) => t.id === 'titanium');
    assert.ok(!titanium.options.some((o) => o.id === 'birthday'));
    assert.ok(data.designatedStores.includes('星宇航空形象門市'));
    assert.ok(data.designatedStores.includes('béshopping'));
    assert.ok(!data.designatedStores.some((s) => /Apple Pay|Google Pay|Samsung Pay|LINE Pay|PayPal|街口|Pi拍|持卡人/.test(s)));
    assert.deepEqual(validateParsedOutput('esun-starlux', data), []);
  });

  it('ctbc cal: parses CAL product page tiers and bonus stores', () => {
    const html = readFixture('ctbc-cal-snippet.html');
    const data = parseCtbcCalHtml(html);
    assert.equal(data.tiers.length, 3);
    const dingzun = data.tiers.find((t) => t.id === 'dingzun');
    assert.ok(dingzun);
    assert.equal(dingzun.bonusCap.primary, 80000);
    const domestic = dingzun.options.find((o) => o.id === 'domestic');
    assert.equal(domestic.amount, 18);
    const bonus = dingzun.options.find((o) => o.id === 'bonus');
    assert.equal(bonus.reward, 2);
    const birthday = dingzun.options.find((o) => o.id === 'birthday');
    assert.equal(birthday.reward, 3);
    const business = data.tiers.find((t) => t.id === 'business');
    assert.equal(business.options.find((o) => o.id === 'domestic').amount, 30);
    assert.ok(data.bonusStores.includes('中華航空官網購買機票'));
    assert.ok(data.bonusStoresWithTravel.includes('Agoda'));
    assert.deepEqual(validateParsedOutput('ctbc-cal', data), []);
  });

  it('ctbcCal data.json passes structural validation', () => {
    const data = readRepoJson('cards/builtin/ctbcCal/data.json');
    assert.deepEqual(validateParsedOutput('ctbc-cal', data), []);
  });

  it('hsbc travel: parses points-to-cash table from product page snippet', () => {
    const html = `
      <table class="desktop">
        <caption>現金折抵: 使用滙豐旅遊積分可兌換刷卡金</caption>
        <thead><tr><th scope="col">旅遊積分</th><th scope="col">刷卡金</th></tr></thead>
        <tbody>
          <tr><td>5,000</td><td>$1,500</td></tr>
          <tr><td>3,000</td><td>$800</td></tr>
          <tr><td>1,000</td><td>$200</td></tr>
        </tbody>
      </table>`;
    const ratios = parseHsbcTravelPointsToCash(html);
    assert.equal(ratios.length, 3);
    assert.equal(ratios[0].miles, 5000);
    assert.equal(ratios[0].cash, 1500);
    assert.equal(ratios[2].miles, 1000);
    assert.equal(ratios[2].cash, 200);
  });

  it('hsbc travel: parses earn rates from index fallback text', () => {
    const indexHtml = `
      滙豐旅人無限卡 海外消費新台幣10元=1旅遊積分 國內消費新台幣18元=1旅遊積分
      滙豐旅人御璽卡 海外消費新台幣15元=1旅遊積分 國內消費新台幣18元=1旅遊積分
      滙豐旅人輕旅卡 刷卡消費新台幣20元=1旅遊積分`;
    const fallback = parseHsbcTravelEarnFromIndexHtml(indexHtml);
    assert.equal(fallback.infinite.overseas, 10);
    assert.equal(fallback.infinite.domestic, 18);
    assert.equal(fallback.signature.overseas, 15);
    assert.equal(fallback.light.all, 20);
  });

  it('hsbc travel: builds full card data from product snippets', () => {
    const infiniteHtml = `
      海外消費(含網路交易)NT10元 = 1 旅遊積分
      國內消費NT18元 = 1 旅遊積分
      <table class="desktop"><tr><th>旅遊積分</th><th>刷卡金</th></tr>
      <tr><td>5,000</td><td>$1,500</td></tr>
      <tr><td>3,000</td><td>$800</td></tr>
      <tr><td>1,000</td><td>$200</td></tr></table>`;
    const signatureHtml = '海外消費（含網路交易）NT$15元=1旅遊積分 國內消費NT$18元=1旅遊積分';
    const lightHtml = '國內外消費NT$20元 = 1 旅遊積分';
    const indexHtml = readFixture('hsbc-fly-miles-snippet.html');
    const data = parseHsbcTravelCardData({
      infiniteHtml,
      signatureHtml,
      lightHtml,
      indexHtml,
    });
    assert.equal(data.tiers.length, 3);
    assert.equal(data.milesProgramId, 'hsbc_travel');
    assert.equal(data.milesToCashRatios.length, 3);
    const infinite = data.tiers.find((t) => t.id === 'infinite');
    assert.equal(infinite.options.find((o) => o.id === 'overseas').amount, 10);
    assert.deepEqual(validateParsedOutput('hsbc-travel', data), []);
  });

  it('dbs aov: parses lifestyle merchants with seed fallback', () => {
    const html = `
      ★娛樂無限
      應用程式商店 App Store | Google Play
      數位遊戲平台 Garena｜Steam｜巴哈姆特NEW
      ★影音充電
      國際串流 Netflix｜Disney+
      ★生活補給
      蝦皮｜Uber Eats｜麥當勞`;
    const merchants = parseDbsAovMerchants(html);
    const names = merchants.map((m) => m.name);
    assert.ok(names.includes('Netflix'), `names=${names.join(',')}`);
    assert.ok(names.includes('Garena'), `names=${names.join(',')}`);
    assert.ok(names.includes('麥當勞'), `names=${names.join(',')}`);
    const netflix = merchants.find((m) => m.name === 'Netflix');
    assert.ok(netflix.keywords.includes('NETFLIX'));
    const merged = mergeDbsAovCrawledData(readRepoJson('cards/builtin/dbsAov/data.json'), merchants, 'https://example.test/aov');
    assert.ok(merged.items.some((i) => i.type === 'overseas_region'));
    assert.ok(merged.items.filter((i) => i.type === 'lifestyle').length >= 10);
  });

  it('dbs aov: parses d-block HTML without tag artifacts or merged merchants', () => {
    const html = `
      <div class="head"><span>★</span>娛樂無限</div>
      <div class="subhead">應用程式商店</div>
      <div class="d-block mb-md-2 mb-1">App Store | Google Play</div>
      <div class="subhead">潮玩動漫<span class="badge bg-danger text-light rounded-0">NEW</span></div>
      <div class="d-block">Animate｜野獸國｜POPMART｜鼎美玩具｜<br> KHTOY｜TOYSNAP｜東海模型</div>
      <div class="head"><span>★</span>影音充電</div>
      <div class="subhead">影音平台</div>
      <div class="d-block mb-md-2 mb-1">愛奇藝｜Catchplay｜KKTV｜LiTV</div>
      <div class="head"><span>★</span>生活補給</div>
      <div class="d-block mb-md-2 mb-1">蝦皮｜淘寶<span class="badge bg-danger text-light rounded-0">NEW</span>｜Uber Eats｜foodpanda｜<br>麥當勞｜肯德基
        摩斯漢堡｜拿坡里｜Pizzahut</div>
      <div class="head_text fw-bold">玩家出國必備</div>`;
    const merchants = parseDbsAovMerchants(html);
    const names = merchants.map((m) => m.name);
    assert.ok(names.includes('KHTOY'), `names=${names.join(',')}`);
    assert.ok(names.includes('肯德基'), `names=${names.join(',')}`);
    assert.ok(names.includes('摩斯漢堡'), `names=${names.join(',')}`);
    assert.ok(names.includes('蝦皮'), `names=${names.join(',')}`);
    assert.ok(!names.some((n) => /class=|br>|span>/i.test(n)), `bad names=${names.join(',')}`);
    assert.ok(!names.some((n) => n.includes('肯德基') && n.includes('摩斯漢堡')), `merged=${names.join(',')}`);
  });
});

describe('updatedAt stamps', () => {
  it('wraps root arrays and stamps objects', () => {
    const now = new Date('2026-08-30T07:00:00.000Z');
    assert.deepEqual(stampUpdatedAt([{ airline: 'x' }], now), {
      updatedAt: '2026-08-30T07:00:00.000Z',
      items: [{ airline: 'x' }],
    });
    assert.equal(stampUpdatedAt({ digital: [] }, now).updatedAt, '2026-08-30T07:00:00.000Z');
    assert.deepEqual(stampUpdatedAt({ updatedAt: 'old', digital: [] }, now), {
      updatedAt: '2026-08-30T07:00:00.000Z',
      digital: [],
    });
  });

  it('does not rewrite when only updatedAt changed', () => {
    const prev = { updatedAt: '2026-01-01T00:00:00.000Z', digital: [['ChatGPT']] };
    const next = stampUpdatedAt({ digital: [['ChatGPT']] }, new Date('2026-08-30T07:00:00.000Z'));
    assert.equal(shouldRewriteManagedJson(prev, next), false);
  });

  it('rewrites when first adding updatedAt or wrapping an array', () => {
    const nextObj = stampUpdatedAt({ digital: [['ChatGPT']] }, new Date('2026-08-30T07:00:00.000Z'));
    assert.equal(shouldRewriteManagedJson({ digital: [['ChatGPT']] }, nextObj), true);
    const nextArr = stampUpdatedAt([['LINE Pay']], new Date('2026-08-30T07:00:00.000Z'));
    assert.equal(shouldRewriteManagedJson([['LINE Pay']], nextArr), true);
  });
});
