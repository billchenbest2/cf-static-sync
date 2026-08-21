/**
 * Pay activities pipeline for cf-static-sync.
 * Crawlers: tools/pay-activities ; output: CARDSWITCH checkout data/pay
 *
 *   node tools/pay-pipeline/run.mjs
 *   PAY_DATA_DIR=/abs/path/data/pay node tools/pay-pipeline/run.mjs --platform linepay
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.join(__dirname, '..', '..');
const ENGINE = path.join(SYNC_ROOT, 'tools', 'pay-activities');

const args = process.argv.slice(2);
const skipFetch = args.includes('--skip-fetch');
const skipOcr = args.includes('--skip-ocr');
const skipAi = args.includes('--skip-ai');
const aiForceAll = args.includes('--ai-force-all');
const platform =
  args.find((a) => a.startsWith('--platform='))?.split('=')[1] ||
  (args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null);

const FETCH_MAP = {
  easy: 'scripts/fetch-easy.mjs',
  icash: 'scripts/fetch-icash.mjs',
  linepay: 'scripts/fetch-linepay.mjs',
  plus: 'scripts/fetch-plus.mjs',
  jko: 'scripts/fetch-jko.mjs',
  ipass: 'scripts/fetch-ipass.mjs',
  pxplus: 'scripts/fetch-activities.mjs',
};

function resolvePayDataDir() {
  if (process.env.PAY_DATA_DIR) return path.resolve(process.env.PAY_DATA_DIR);
  // Prefer in-repo cache (seeded / committed under data/pay) to speed CI re-runs.
  const candidates = [
    path.join(SYNC_ROOT, 'data', 'pay'),
    path.join(SYNC_ROOT, 'cardswitch', 'data', 'pay'),
    path.join(SYNC_ROOT, '..', '..', 'CardSwitch-main', 'data', 'pay'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(SYNC_ROOT, 'data', 'pay');
}

function run(cmd, cmdArgs, cwd, envExtra = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n>> ${cmd} ${cmdArgs.join(' ')}`);
    const child = spawn(cmd, cmdArgs, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...envExtra },
      shell: false,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

function runNode(rel, extra = [], payData) {
  return run(process.execPath, [rel, ...extra], ENGINE, { PAY_DATA_DIR: payData });
}

function loadDotEnv() {
  for (const envFile of [
    path.join(ENGINE, '.env'),
    path.join(SYNC_ROOT, '.env'),
  ]) {
    if (!fs.existsSync(envFile)) continue;
    const text = fs.readFileSync(envFile, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] == null || process.env[m[1]] === '') process.env[m[1]] = val;
    }
  }
}

async function ensureDeps() {
  if (fs.existsSync(path.join(ENGINE, 'node_modules'))) return;
  console.log('Installing tools/pay-activities dependencies...');
  await run('npm', ['ci'], ENGINE).catch(() => run('npm', ['install'], ENGINE));
}

async function main() {
  const t0 = Date.now();
  const payData = resolvePayDataDir();
  console.log('cf-static-sync pay-activities pipeline');
  console.log('  data:', payData);
  console.log('  engine:', ENGINE);
  console.log(
    `  platform=${platform || 'all'} fetch=${skipFetch ? 'off' : 'on'} ocr=${skipOcr ? 'off' : 'on'} ai=${skipAi ? 'off' : 'on'}`
  );

  if (!fs.existsSync(path.join(ENGINE, 'package.json'))) {
    console.error('Missing tools/pay-activities');
    process.exit(1);
  }

  fs.mkdirSync(payData, { recursive: true });
  loadDotEnv();
  await ensureDeps();

  if (!skipFetch) {
    console.log('\n[1/3] Crawl (ended cache skips re-fetch)');
    if (platform) {
      const rel = FETCH_MAP[platform];
      if (!rel) throw new Error(`Unknown platform: ${platform}`);
      await runNode(rel, [], payData);
    } else {
      await runNode('scripts/fetch-all.mjs', [], payData);
    }
  } else {
    console.log('\n[1/3] Crawl skipped');
  }

  if (!skipOcr && (!platform || platform === 'pxplus')) {
    console.log('\n[2/3] OCR dates (PX Pay Plus)');
    await runNode('scripts/ocr-dates.mjs', [], payData);
  } else {
    console.log('\n[2/3] OCR skipped');
  }

  if (!skipAi) {
    if (!process.env.GEMINI_API_KEY) {
      console.error('Missing GEMINI_API_KEY');
      process.exit(1);
    }
    console.log('\n[3/3] AI backfill (gemini-3.1-flash-lite + risk escalate)');
    const aiArgs = [];
    if (platform) aiArgs.push('--platform', platform);
    if (aiForceAll) aiArgs.push('--force', '--no-skip');
    else aiArgs.push('--force');
    await runNode('scripts/ai-backfill.mjs', aiArgs, payData);

    console.log('\n[3b] AI escalate pass');
    const escArgs = [];
    if (platform) escArgs.push('--platform', platform);
    await runNode('scripts/ai-escalate.mjs', escArgs, payData);
  } else {
    console.log('\n[3/3] AI skipped');
  }

  console.log(`\nDone in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${payData}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
