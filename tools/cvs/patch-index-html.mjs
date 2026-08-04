#!/usr/bin/env node
/** UTF-8 safe patch for index.html — add CVS mode tab, filters, boot script, script tag. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const INDEX = path.join(ROOT, 'index.html');

let html = fs.readFileSync(INDEX, 'utf8');

if (!html.includes('data-mode="cvs"')) {
  html = html.replace(
    `<button type="button" class="mode-tab" role="tab" data-mode="gas" aria-selected="false" title="加油站" aria-label="加油站">
          <i class="fa-solid fa-gas-pump" aria-hidden="true"></i>
        </button>
      </div>`,
    `<button type="button" class="mode-tab" role="tab" data-mode="gas" aria-selected="false" title="加油站" aria-label="加油站">
          <i class="fa-solid fa-gas-pump" aria-hidden="true"></i>
        </button>
        <button type="button" class="mode-tab" role="tab" data-mode="cvs" aria-selected="false" title="超商" aria-label="超商">
          <i class="fa-solid fa-store" aria-hidden="true"></i>
        </button>
      </div>`
  );
}

if (!html.includes('id="cvs-filter-block"')) {
  html = html.replace(
    `<div class="pay-filter-block" id="pay-filter-block">`,
    `<div class="cvs-filter-block" id="cvs-filter-block" hidden>
      <div class="chip-row-label">品牌</div>
      <div class="chip-scroll" id="chips-cvs-brands" role="toolbar" aria-label="超商品牌篩選"></div>
      <div class="chip-row-label">服務項目</div>
      <div class="chip-scroll" id="chips-cvs-services" role="toolbar" aria-label="超商服務篩選"></div>
      </div>
      <div class="pay-filter-block" id="pay-filter-block">`
  );
}

if (!html.includes('id="pmtw-cvs-path-boot"')) {
  const boot = `
  <script id="pmtw-cvs-path-boot">
  (function () {
    try {
      var p = (location.pathname || '/').replace(/\\/index\\.html$/i, '').replace(/\\/+$/, '') || '/';
      if (p !== '/cvs') return;
      window.__PMTW_CVS_ENTRY = true;
      var t = '台灣超商地圖 - 服務設施查詢';
      var d = '台灣超商地圖：查詢 7-ELEVEN、全家等超商位置與服務設施（廁所、ATM、ibon、FamiPort 等），可依品牌與服務篩選。';
      document.title = t;
      var desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute('content', d);
      var ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute('content', t);
      var ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute('content', d);
      var ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl) ogUrl.setAttribute('content', 'https://paymentmaptw.pages.dev/cvs/');
      var canon = document.querySelector('link[rel="canonical"]');
      if (canon) canon.setAttribute('href', 'https://paymentmaptw.pages.dev/cvs/');
      var apple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (apple) apple.setAttribute('content', '超商地圖');
    } catch (e) {}
  })();
  </script>`;
  html = html.replace('</head>', boot + '\n</head>');
}

if (!html.includes('./cvs-mode.js')) {
  html = html.replace('<script src="./gas-mode.js"></script>', '<script src="./gas-mode.js"></script>\n<script src="./cvs-mode.js"></script>');
}

fs.writeFileSync(INDEX, html, 'utf8');
const bad = (html.match(/\?\?\?/g) || []).length;
console.log('patched index.html, ??? count:', bad);
if (bad > 0) process.exit(1);
