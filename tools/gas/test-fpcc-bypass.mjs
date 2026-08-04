#!/usr/bin/env node
/**
 * Try multiple FPCC fetch strategies and report which bypass bot checks.
 * Usage:
 *   node tools/gas/test-fpcc-bypass.mjs [city]
 *   node tools/gas/test-fpcc-bypass.mjs 臺南市 --only=playwright-home-first,chrome-ua-referer
 */
import { chromium, firefox, webkit } from 'playwright';

const cityArg = process.argv.slice(2).find((a) => !a.startsWith('-') && (a.endsWith('市') || a.endsWith('縣')));
const city = cityArg || '臺南市';
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',').filter(Boolean)) : null;

const BASE = 'https://www.fpcc.com.tw';
const cityPath = `/tw/events/stations/${encodeURIComponent(city)}/0/0/0`;
const cityUrl = `${BASE}${cityPath}`;

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function analyzeHtml(html) {
  const text = String(html || '');
  const items = [...text.matchAll(/class="li-item" data-id="([^"]+)"/g)].length;
  const title = text.match(/<title>([^<]+)/)?.[1]?.trim() || '';
  const blocked =
    /安全驗證|Security Verification|captcha|cf-challenge|challenge-platform/i.test(text) ||
    (text.length < 8000 && items === 0);
  const protection = [];
  if (/安全驗證|Security Verification/i.test(text)) protection.push('fpcc-security-page');
  if (/cf-challenge|challenge-platform|cloudflare/i.test(text)) protection.push('cloudflare');
  if (/captcha|recaptcha|hcaptcha/i.test(text)) protection.push('captcha');
  if (/bot|automated|webdriver/i.test(text)) protection.push('bot-keyword');
  return {
    ok: items > 0 && !/安全驗證|Security Verification/i.test(title),
    items,
    len: text.length,
    title: title.slice(0, 60),
    blocked,
    protection: protection.length ? protection : blocked ? ['unknown-shell'] : []
  };
}

async function runStrategy(name, fn) {
  if (only && !only.has(name)) return null;
  const started = Date.now();
  try {
    const html = await fn();
    const stats = analyzeHtml(html);
    return {
      name,
      ms: Date.now() - started,
      ...stats,
      error: null
    };
  } catch (e) {
    return {
      name,
      ms: Date.now() - started,
      ok: false,
      items: 0,
      len: 0,
      title: '',
      blocked: true,
      protection: ['exception'],
      error: e.message
    };
  }
}

async function fetchPlain(headers, url = cityUrl) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function chromeHeaders(extra = {}) {
  return {
    'User-Agent': CHROME_UA,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    ...extra
  };
}

const STEALTH_INIT = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-TW', 'zh', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {} };
};

async function playwrightFetch({
  browserType = chromium,
  launchOptions = {},
  contextOptions = {},
  waitUntil = 'domcontentloaded',
  timeout = 45000,
  homeFirst = false,
  mobile = false,
  extraWaitMs = 800,
  waitSelector = '.li-item[data-id], .li-item'
}) {
  const browser = await browserType.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ],
    ...launchOptions
  });
  try {
    const context = await browser.newContext({
      userAgent: mobile ? MOBILE_UA : CHROME_UA,
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
      extraHTTPHeaders: { 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' },
      ...contextOptions
    });
    await context.addInitScript(STEALTH_INIT);
    const page = await context.newPage();
    if (homeFirst) {
      await page.goto(`${BASE}/tw`, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForTimeout(1200);
    }
    await page.goto(cityUrl, { waitUntil, timeout });
    const title = await page.title();
    if (/安全驗證|Security Verification/i.test(title)) {
      await page.waitForTimeout(5000);
    } else if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(extraWaitMs);
    }
    return await page.evaluate(() => document.documentElement.outerHTML);
  } finally {
    await browser.close();
  }
}

const strategies = [
  {
    name: 'bot-ua-plain',
    run: () =>
      fetchPlain({
        'User-Agent': 'PaymentMapTW-gas-station-bot/1.0',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9'
      })
  },
  {
    name: 'chrome-ua-plain',
    run: () => fetchPlain(chromeHeaders())
  },
  {
    name: 'chrome-ua-referer',
    run: () =>
      fetchPlain(
        chromeHeaders({
          Referer: `${BASE}/tw/events/stations`,
          'Sec-Fetch-Site': 'same-origin'
        })
      )
  },
  {
    name: 'session-warmup-cookies',
    run: async () => {
      const home = await fetch(`${BASE}/tw`, { headers: chromeHeaders() });
      const setCookies = home.headers.getSetCookie?.() || [];
      const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
      return fetchPlain(
        chromeHeaders({
          Referer: `${BASE}/tw`,
          Cookie: cookie,
          'Sec-Fetch-Site': 'same-origin'
        })
      );
    }
  },
  {
    name: 'english-url',
    run: () =>
      fetchPlain(
        chromeHeaders(),
        `${BASE}/en/events/stations/${encodeURIComponent(city)}/0/0/0`
      )
  },
  {
    name: 'playwright-domcontentloaded',
    run: () => playwrightFetch({ waitUntil: 'domcontentloaded' })
  },
  {
    name: 'playwright-networkidle',
    run: () => playwrightFetch({ waitUntil: 'networkidle', timeout: 60000 })
  },
  {
    name: 'playwright-home-first',
    run: () => playwrightFetch({ homeFirst: true, waitUntil: 'domcontentloaded' })
  },
  {
    name: 'playwright-long-wait',
    run: () =>
      playwrightFetch({
        homeFirst: true,
        waitUntil: 'domcontentloaded',
        extraWaitMs: 8000,
        waitSelector: '.li-item[data-id], .li-item, body'
      })
  },
  {
    name: 'playwright-mobile',
    run: () => playwrightFetch({ mobile: true, homeFirst: true })
  },
  {
    name: 'playwright-firefox',
    run: () =>
      playwrightFetch({
        browserType: firefox,
        homeFirst: true,
        waitUntil: 'domcontentloaded'
      })
  },
  {
    name: 'playwright-webkit',
    run: () =>
      playwrightFetch({
        browserType: webkit,
        homeFirst: true,
        waitUntil: 'domcontentloaded'
      })
  }
];

console.log('FPCC bypass experiment');
console.log('city', city);
console.log('url', cityUrl);
console.log('node', process.version);
console.log('CI', process.env.GITHUB_ACTIONS === 'true' ? 'yes' : 'no');
console.log('---');

const results = [];
for (const s of strategies) {
  process.stdout.write(`try ${s.name} ... `);
  const row = await runStrategy(s.name, s.run);
  if (!row) {
    console.log('skip');
    continue;
  }
  results.push(row);
  console.log(row.ok ? `OK items=${row.items}` : `FAIL ${row.error || row.title || row.protection.join(',')}`);
}

console.log('\n=== summary (best first) ===');
results.sort((a, b) => (b.ok - a.ok) || (b.items - a.items) || (a.ms - b.ms));
for (const r of results) {
  console.log(
    JSON.stringify({
      name: r.name,
      ok: r.ok,
      items: r.items,
      ms: r.ms,
      len: r.len,
      title: r.title,
      protection: r.protection,
      error: r.error
    })
  );
}

const winners = results.filter((r) => r.ok);
if (winners.length) {
  console.log('\nRecommended:', winners[0].name, `(${winners[0].items} stations, ${winners[0].ms}ms)`);
  process.exit(0);
}
console.log('\nNo strategy succeeded on this network.');
process.exit(1);
