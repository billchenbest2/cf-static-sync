#!/usr/bin/env node
/**
 * Build /toilet/ static entry + patch mode tabs / filter blocks / scripts (UTF-8 safe).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const TITLE = '台灣公共廁所地圖｜等級・無障礙・親子篩選';
const DESC =
  '台灣公共廁所地圖：依定位查詢附近公廁，可篩選特優／優等等級、男廁／女廁／親子／無障礙與尿布台。資料來源為環境部環境管理署「全國公廁建檔資料」。';
const CANONICAL = 'https://paymentmaptw.pages.dev/toilet/';

const TOILET_TAB =
  '<button type="button" class="mode-tab" role="tab" data-mode="toilet" aria-selected="false" title="公廁" aria-label="公廁">\n' +
  '          <i class="fa-solid fa-restroom" aria-hidden="true"></i>\n' +
  '        </button>';

const TOILET_FILTER =
  '      <div class="toilet-filter-block" id="toilet-filter-block" hidden>\n' +
  '      <div class="chip-row-label">等級</div>\n' +
  '      <div class="chip-scroll" id="chips-toilet-grade" role="toolbar" aria-label="公廁等級篩選"></div>\n' +
  '      <div class="chip-row-label">類型</div>\n' +
  '      <div class="chip-scroll" id="chips-toilet-types" role="toolbar" aria-label="公廁類型篩選"></div>\n' +
  '      <div class="chip-row-label">設施</div>\n' +
  '      <div class="chip-scroll" id="chips-toilet-baby" role="toolbar" aria-label="尿布台篩選"></div>\n' +
  '      <div class="chip-row-label">場所類別</div>\n' +
  '      <div class="chip-scroll" id="chips-toilet-category" role="toolbar" aria-label="場所類別篩選"></div>\n' +
  '      </div>\n';

function ensureToiletTab(html) {
  if (html.includes('data-mode="toilet"')) return html;
  return html.replace(
    /(<button type="button" class="mode-tab[^"]*" role="tab" data-mode="cvs"[\s\S]*?<\/button>)/,
    '$1\n        ' + TOILET_TAB
  );
}

function ensureToiletFilter(html) {
  if (html.includes('id="toilet-filter-block"')) return html;
  return html.replace(
    /(<div class="cvs-filter-block" id="cvs-filter-block"[\s\S]*?<\/div>\n)/,
    '$1' + TOILET_FILTER
  );
}

function ensureToiletScript(html) {
  if (html.includes('toilet-mode.js')) return html;
  return html.replace(
    /(<script src="(\.\.\/|\.\/)cvs-mode\.js"><\/script>)/,
    '$1\n<script src="$2toilet-mode.js"></script>'
  );
}

function patchSharedShell(html) {
  let out = html;
  out = ensureToiletTab(out);
  out = ensureToiletFilter(out);
  out = ensureToiletScript(out);
  return out;
}

function buildToiletIndexFromCvs() {
  const cvsPath = path.join(ROOT, 'cvs', 'index.html');
  let html = fs.readFileSync(cvsPath, 'utf8');

  html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + TITLE + '</title>');
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    '<meta name="description" content="' + DESC.replace(/"/g, '&quot;') + '">'
  );
  html = html.replace(
    /href="https:\/\/paymentmaptw\.pages\.dev\/cvs\/"/g,
    'href="' + CANONICAL + '"'
  );
  html = html.replace(
    /content="https:\/\/paymentmaptw\.pages\.dev\/cvs\/"/g,
    'content="' + CANONICAL + '"'
  );
  html = html.replace(
    /property="og:site_name" content="[^"]*"/,
    'property="og:site_name" content="' + TITLE + '"'
  );
  html = html.replace(
    /property="og:title" content="[^"]*"/,
    'property="og:title" content="' + TITLE + '"'
  );
  html = html.replace(
    /property="og:description" content="[^"]*"/,
    'property="og:description" content="' + DESC.replace(/"/g, '&quot;') + '"'
  );
  html = html.replace(
    /"url": "https:\/\/paymentmaptw\.pages\.dev\/cvs\/"/,
    '"url": "' + CANONICAL + '"'
  );
  html = html.replace(/"name": "台灣支付地圖"/, '"name": "' + TITLE + '"');
  html = html.replace(/class="app-mode-cvs"/, 'class="app-mode-toilet"');

  // Mode tab active state
  html = html.replace(
    /data-mode="cvs" aria-selected="true"/g,
    'data-mode="cvs" aria-selected="false"'
  );
  html = html.replace(
    /class="mode-tab active" role="tab" data-mode="cvs"/g,
    'class="mode-tab" role="tab" data-mode="cvs"'
  );
  html = ensureToiletTab(html);
  html = html.replace(
    /data-mode="toilet" aria-selected="false"/,
    'data-mode="toilet" aria-selected="true"'
  );
  html = html.replace(
    /class="mode-tab" role="tab" data-mode="toilet"/,
    'class="mode-tab active" role="tab" data-mode="toilet"'
  );

  html = ensureToiletFilter(html);
  html = html.replace(
    /id="cvs-filter-block"(?![^>]*hidden)/,
    'id="cvs-filter-block" hidden'
  );
  // Ensure toilet filter not hidden on toilet entry (remove hidden on toilet block)
  html = html.replace(
    /id="toilet-filter-block" hidden/,
    'id="toilet-filter-block"'
  );

  html = ensureToiletScript(html);

  if (!html.includes('pmtw-toilet-path-boot')) {
    const boot =
      '\n  <script id="pmtw-toilet-path-boot">\n' +
      '  (function () {\n' +
      '    try {\n' +
      "      var p = (location.pathname || '/').replace(/\\/index\\.html$/i, '').replace(/\\/+$/, '') || '/';\n" +
      "      if (p !== '/toilet') return;\n" +
      '      window.__PMTW_TOILET_ENTRY = true;\n' +
      "      var t = '" +
      TITLE +
      "';\n" +
      "      var d = '" +
      DESC +
      "';\n" +
      '      document.title = t;\n' +
      "      var desc = document.querySelector('meta[name=\"description\"]');\n" +
      "      if (desc) desc.setAttribute('content', d);\n" +
      "      var ogTitle = document.querySelector('meta[property=\"og:title\"]');\n" +
      "      if (ogTitle) ogTitle.setAttribute('content', t);\n" +
      "      var ogDesc = document.querySelector('meta[property=\"og:description\"]');\n" +
      "      if (ogDesc) ogDesc.setAttribute('content', d);\n" +
      "      var ogUrl = document.querySelector('meta[property=\"og:url\"]');\n" +
      "      if (ogUrl) ogUrl.setAttribute('content', 'https://paymentmaptw.pages.dev/toilet/');\n" +
      "      var canon = document.querySelector('link[rel=\"canonical\"]');\n" +
      "      if (canon) canon.setAttribute('href', 'https://paymentmaptw.pages.dev/toilet/');\n" +
      "      var apple = document.querySelector('meta[name=\"apple-mobile-web-app-title\"]');\n" +
      "      if (apple) apple.setAttribute('content', '台灣LifeMap');\n" +
      '    } catch (e) {}\n' +
      '  })();\n' +
      '  </script>\n';
    html = html.replace('</head>', boot + '</head>');
  }

  // noscript / intro links
  if (!html.includes('/toilet/')) {
    html = html.replace(
      /另提供 <a href="\/">台灣支付地圖<\/a>/,
      '另提供 <a href="/">台灣支付地圖</a>'
    );
  }
  html = html.replace(
    /另提供 <a href="\/">台灣支付地圖<\/a> 與 <a href="\/gas\/">台灣加油站地圖<\/a>。/,
    '另提供 <a href="/">台灣支付地圖</a>、<a href="/gas/">台灣加油站地圖</a> 與 <a href="/cvs/">台灣超商地圖</a>。'
  );

  // Search placeholder
  html = html.replace(/placeholder="搜尋超商\.\.\."/g, 'placeholder="搜尋公廁..."');
  html = html.replace(/搜尋超商/g, '搜尋公廁');

  // Boot path script: fix gas/cvs SEO redirects if present — leave as-is from cvs template

  const faqLd = {
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: '台灣公共廁所地圖的資料從哪裡來？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '資料來源為環境部環境管理署「全國公廁建檔資料」（FAC_P_07），定期同步更新。非官方工具，現場狀況可能與建檔不符。'
        }
      },
      {
        '@type': 'Question',
        name: '可以篩選無障礙或親子廁所嗎？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '可以。篩選列支援等級、男廁／女廁／混合／親子／無障礙、尿布台與場所類別，方便快速找到合適的公廁。'
        }
      },
      {
        '@type': 'Question',
        name: '公廁等級代表什麼？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '等級來自環境部建檔評等，常見為特優、優等、普通、加強與不合格，可作為參考，實際清潔與開放狀況以現場為準。'
        }
      }
    ]
  };

  if (!html.includes('FAQPage')) {
    html = html.replace(
      /("offers": \{ "@type": "Offer", "price": "0", "priceCurrency": "TWD" \}\s*\})/,
      '$1,\n      ' + JSON.stringify(faqLd)
    );
  }

  const outDir = path.join(ROOT, 'toilet');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

  const cvsManifest = path.join(ROOT, 'cvs', 'manifest.json');
  const toiletManifest = path.join(outDir, 'manifest.json');
  if (fs.existsSync(cvsManifest)) {
    const m = JSON.parse(fs.readFileSync(cvsManifest, 'utf8'));
    m.name = '台灣公共廁所地圖';
    m.short_name = '公廁地圖';
    m.description = DESC;
    m.start_url = '/toilet/';
    m.id = '/toilet/';
    m.scope = '/toilet/';
    fs.writeFileSync(toiletManifest, JSON.stringify(m, null, 2), 'utf8');
  }

  console.log('Wrote', path.join(outDir, 'index.html'));
}

function patchHtmlFile(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.warn('skip missing', rel);
    return;
  }
  const before = fs.readFileSync(p, 'utf8');
  let after = patchSharedShell(before);
  // Cross-links mention toilet where CVS intro exists
  if (rel === 'index.html' && !after.includes('/toilet/') && after.includes('/gas/')) {
    after = after.replace(
      /另提供 <a href="\/gas\/">台灣加油站地圖<\/a>/,
      '另提供 <a href="/gas/">台灣加油站地圖</a>、<a href="/cvs/">台灣超商地圖</a> 與 <a href="/toilet/">台灣公共廁所地圖</a>'
    );
  }
  if (after !== before) {
    fs.writeFileSync(p, after, 'utf8');
    console.log('Patched', rel);
  } else {
    console.log('Unchanged', rel);
  }
}

function patchSitemap() {
  const p = path.join(ROOT, 'sitemap.xml');
  let xml = fs.readFileSync(p, 'utf8');
  if (xml.includes('/toilet/')) return;
  xml = xml.replace(
    '</urlset>',
    '  <url><loc>https://paymentmaptw.pages.dev/toilet/</loc><changefreq>weekly</changefreq><priority>0.85</priority></url>\n</urlset>'
  );
  fs.writeFileSync(p, xml, 'utf8');
  console.log('Patched sitemap.xml');
}

buildToiletIndexFromCvs();
for (const rel of ['index.html', 'GAS/index.html', 'cvs/index.html', 'toilet/index.html']) {
  patchHtmlFile(rel);
}
patchSitemap();

// Verify no mojibake
for (const rel of ['toilet/index.html', 'index.html', 'cvs/index.html']) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const bad = (s.match(/\?\?\?/g) || []).length;
  console.log(rel, '???=', bad, 'toiletTab=', s.includes('data-mode="toilet"'), 'script=', s.includes('toilet-mode.js'));
}
