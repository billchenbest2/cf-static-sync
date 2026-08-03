/**
 * Fetch FPCC city page HTML via headless Chromium (Playwright).
 * Used when plain fetch returns captcha / blocked shell (common on datacenter IPs).
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = await import('playwright');
    browserPromise = chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage']
    });
  }
  return browserPromise;
}

export async function closeFpccBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchHtmlWithPlaywright(url) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport: { width: 1365, height: 900 },
    extraHTTPHeaders: {
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    }
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    const title = await page.title();
    if (/安全驗證|Security Verification/i.test(title)) {
      // Give challenge scripts a moment; still often blocked on automated browsers.
      await page.waitForTimeout(3000);
    } else {
      await page
        .waitForSelector('.li-item[data-id], .li-item', { timeout: 12000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    }
    return await page.evaluate(() => document.documentElement.outerHTML);
  } finally {
    await context.close();
  }
}
