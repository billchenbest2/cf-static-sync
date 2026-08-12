#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const p = path.join(ROOT, 'toilet', 'index.html');
let h = fs.readFileSync(p, 'utf8');

h = h.replace('class="app-mode-cvs"', 'class="app-mode-toilet"');
h = h.replace(
  /if \(p !== '\/cvs'\) return;\s*window\.__PMTW_TOILET_ENTRY = true;/,
  "if (p !== '/cvs') return;\n      window.__PMTW_CVS_ENTRY = true;"
);

const TITLE = '台灣公共廁所地圖｜等級・無障礙・親子篩選';
const DESC =
  '台灣公共廁所地圖：依定位查詢附近公廁，可篩選特優／優等等級、男廁／女廁／親子／無障礙與尿布台。資料來源為環境部環境管理署「全國公廁建檔資料」。';

if (!h.includes('pmtw-toilet-path-boot')) {
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
  h = h.replace('</head>', boot + '</head>');
}

fs.writeFileSync(p, h, 'utf8');
const s = fs.readFileSync(p, 'utf8');
console.log('body', (s.match(/body class="[^"]+"/) || [])[0]);
console.log('toilet-boot', s.includes('pmtw-toilet-path-boot'));
console.log('???', (s.match(/\?\?\?/g) || []).length);

// Validate JSON-LD
const m = s.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!m) console.log('no ld');
else {
  try {
    JSON.parse(m[1]);
    console.log('ld ok');
  } catch (e) {
    console.log('ld FAIL', e.message);
  }
}

// Also harden build-seo-static for next runs
const buildPath = path.join(ROOT, 'tools/toilet/build-seo-static.mjs');
let build = fs.readFileSync(buildPath, 'utf8');
if (!build.includes('pmtw-toilet-path-boot')) {
  build = build.replace(
    "html = html.replace(/window\\.__PMTW_CVS_ENTRY = true/, 'window.__PMTW_TOILET_ENTRY = true');\n  html = html.replace(/__PMTW_CVS_ENTRY/g, '__PMTW_TOILET_ENTRY');\n",
    "html = html.replace(/class=\"app-mode-cvs\"/, 'class=\"app-mode-toilet\"');\n"
  );
  fs.writeFileSync(buildPath, build, 'utf8');
  console.log('updated build-seo-static.mjs body class replace');
}
