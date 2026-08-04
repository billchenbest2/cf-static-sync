#!/usr/bin/env node
/** UTF-8: cvs/index.html, manifest.json, sitemap patch */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const INDEX = path.join(ROOT, 'index.html');
const CVS_DIR = path.join(ROOT, 'cvs');
const CVS_INDEX = path.join(CVS_DIR, 'index.html');

const SITE = 'https://paymentmaptw.pages.dev';
const CVS_URL = `${SITE}/cvs/`;
const CVS_TITLE = '台灣超商地圖 - 服務設施查詢';
const CVS_DESC =
  '台灣超商地圖：查詢 7-ELEVEN、全家等超商位置與服務設施（廁所、ATM、ibon、FamiPort 等），可依品牌與服務篩選。';

const CVS_SEO_LANDING = `
  <section class="seo-landing" aria-label="關於台灣超商地圖">
    <h1>台灣超商地圖</h1>
    <p>查詢全台 7-ELEVEN、全家等超商門市位置，篩選廁所、ATM、ibon、FamiPort、咖啡等服務設施。資料來自官方公開來源定期更新，僅供參考。</p>
    <p>另提供 <a href="/">台灣支付地圖</a> 與 <a href="/gas/">台灣加油站地圖</a>。</p>
  </section>`;

function relPathAssets(html) {
  return html.replace(/(\s(?:href|src)=["'])\.\//g, '$1../');
}

function swapCvsModeTabs(html) {
  let out = html.replace(
    /<button type="button" class="mode-tab active" role="tab" data-mode="pay"([^>]*)>/,
    '<button type="button" class="mode-tab" role="tab" data-mode="pay"$1>'
  );
  out = out.replace(
    /(<button type="button" class="mode-tab" role="tab" data-mode="pay"[^>]*?)aria-selected="true"/,
    '$1aria-selected="false"'
  );
  if (!out.includes('data-mode="cvs"')) {
    out = out.replace(
      `<button type="button" class="mode-tab" role="tab" data-mode="gas"`,
      `<button type="button" class="mode-tab" role="tab" data-mode="cvs" aria-selected="false" title="超商" aria-label="超商">
          <i class="fa-solid fa-store" aria-hidden="true"></i>
        </button>
        <button type="button" class="mode-tab" role="tab" data-mode="gas"`
    );
  }
  out = out.replace(
    /<button type="button" class="mode-tab" role="tab" data-mode="cvs" aria-selected="false"([^>]*)>/,
    '<button type="button" class="mode-tab active" role="tab" data-mode="cvs" aria-selected="true"$1>'
  );
  out = out.replace('placeholder="搜尋支付地圖..."', 'placeholder="搜尋超商..."');
  return out;
}

function replaceSeoLanding(html, landing) {
  if (html.includes('class="seo-landing"')) {
    return html.replace(/<section class="seo-landing"[\s\S]*?<\/section>/, landing.trim());
  }
  return html.replace(/<body[^>]*>\s*\n/, (m) => m + landing + '\n');
}

function buildCvsBody(html) {
  let out = swapCvsModeTabs(html);
  out = out.replace(/<body(?: class="[^"]*")?>/, '<body class="app-mode-cvs">');
  out = replaceSeoLanding(out, CVS_SEO_LANDING);
  out = out.replace(
    'aria-label="台灣地圖，顯示店家支付資訊"',
    'aria-label="台灣地圖，顯示超商與服務設施"'
  );
  return relPathAssets(out);
}

function writeManifest() {
  const manifest = {
    name: CVS_TITLE,
    short_name: '超商地圖',
    description: CVS_DESC,
    start_url: '/cvs/',
    scope: '/cvs/',
    display: 'standalone',
    background_color: '#f5f7fa',
    theme_color: '#f5f7fa',
    icons: [
      { src: '../icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '../icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  };
  fs.writeFileSync(path.join(CVS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function patchSitemap() {
  const sm = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(sm)) return;
  let xml = fs.readFileSync(sm, 'utf8');
  if (!xml.includes('/cvs/')) {
    xml = xml.replace(
      '</urlset>',
      `  <url><loc>${CVS_URL}</loc><changefreq>weekly</changefreq><priority>0.85</priority></url>\n</urlset>`
    );
    fs.writeFileSync(sm, xml, 'utf8');
  }
}

function main() {
  const patchScript = path.join(__dirname, 'patch-index-html.mjs');
  if (fs.existsSync(patchScript)) {
    spawnSync(process.execPath, [patchScript], { cwd: ROOT, stdio: 'inherit' });
  }
  fs.mkdirSync(CVS_DIR, { recursive: true });
  let html = fs.readFileSync(INDEX, 'utf8');
  const headMatch = html.match(/<head>[\s\S]*?<\/head>/);
  if (!headMatch) throw new Error('head not found');
  let head = headMatch[0]
    .replace(/<title>[^<]*<\/title>/, `<title>${CVS_TITLE}</title>`)
    .replace(/content="台灣支付地圖[^"]*"/g, `content="${CVS_DESC}"`)
    .replace(/https:\/\/paymentmaptw\.pages\.dev\/?"/g, `${CVS_URL}"`)
    .replace('<base href="/">', '')
    .replace(
      'href="./manifest.json',
      'href="./manifest.json'
    );
  head = relPathAssets(head);
  head = head.replace(
    /<link rel="manifest" href="[^"]*">/,
    '<link rel="manifest" href="./manifest.json?v=20260804a">'
  );
  const bodyMatch = html.match(/<body>[\s\S]*<\/body>/);
  if (!bodyMatch) throw new Error('body not found');
  const cvsHtml = head + '\n' + buildCvsBody(bodyMatch[0]);
  fs.writeFileSync(CVS_INDEX, `<!DOCTYPE html>\n<html lang="zh-Hant">\n${cvsHtml}\n</html>`, 'utf8');
  writeManifest();
  patchSitemap();
  console.log('Wrote', CVS_INDEX);
}

main();
