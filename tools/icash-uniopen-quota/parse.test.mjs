import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  cadenceHoursForDay,
  hasCurrentMonthFull,
  parseIcashUniopenQuota,
  stripHtml,
} from './parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'advert-2371-snippet.html');

describe('icash-uniopen-quota parse', () => {
  it('strips tag-split years so 8/10 month notices are kept', () => {
    const html = `
      <p><strong><span>2026年7月【全通路單筆滿199元享4%】活動贈點已於2026/7/8 17:00額滿</span></strong></p>
      <p><span>2026</span></strong><strong><span>年8月【全通路單筆滿199元享4%】活動贈點已於2026/8/6 11:00額滿</span></strong></p>
      <p>2026年9月【全通路單筆滿199元享4%】活動贈點已於2026/9/6 11:00額滿</p>
      <p><span>2026</span><span>年10月【全通路單筆滿199元享4%】活動贈點已於2026/10/6 15:00額滿</span></p>
    `;
    const text = stripHtml(html);
    assert.match(text, /2026\s*年\s*8\s*月/);
    assert.match(text, /2026\s*年\s*10\s*月/);
    const parsed = parseIcashUniopenQuota(html, {
      now: new Date('2026-10-06T10:00:00+08:00'),
      sourceUrl: 'https://example.test/2371',
    });
    assert.equal(parsed.fullMonths['7'].at, '2026/7/8 17:00');
    assert.equal(parsed.fullMonths['8'].at, '2026/8/6 11:00');
    assert.equal(parsed.fullMonths['9'].at, '2026/9/6 11:00');
    assert.equal(parsed.fullMonths['10'].at, '2026/10/6 15:00');
    assert.equal(parsed.current.full, true);
    assert.equal(parsed.current.month, 10);
    assert.equal(parsed.current.at, '2026/10/6 15:00');
  });

  it('parses live fixture when present', { skip: !fs.existsSync(fixturePath) }, () => {
    const html = fs.readFileSync(fixturePath, 'utf8');
    const parsed = parseIcashUniopenQuota(html, {
      now: new Date('2026-10-06T10:00:00+08:00'),
    });
    assert.ok(parsed.fullMonths['10'], 'October full notice');
    assert.match(String(parsed.fullMonths['10'].at), /2026\/10\/6/);
    assert.equal(parsed.current.full, true);
  });

  it('keeps legacy data-closed-text months', () => {
    const html = 'x'.repeat(100) + ' data-closed-text="3月回饋已額滿" icash Pay';
    const parsed = parseIcashUniopenQuota(html, {
      now: new Date('2026-03-10T00:00:00+08:00'),
    });
    assert.ok(parsed.fullMonths['3']);
    assert.equal(parsed.current.full, true);
  });

  it('cadence hours match plan bands', () => {
    assert.equal(cadenceHoursForDay(1), 12);
    assert.equal(cadenceHoursForDay(3), 12);
    assert.equal(cadenceHoursForDay(4), 3);
    assert.equal(cadenceHoursForDay(8), 3);
    assert.equal(cadenceHoursForDay(9), 6);
    assert.equal(cadenceHoursForDay(15), 6);
    assert.equal(cadenceHoursForDay(16), null);
  });

  it('hasCurrentMonthFull respects year', () => {
    const status = {
      fullMonths: { 10: { year: 2026, at: '2026/10/6 15:00' } },
    };
    assert.equal(hasCurrentMonthFull(status, { year: 2026, month: 10 }), true);
    assert.equal(hasCurrentMonthFull(status, { year: 2027, month: 10 }), false);
    assert.equal(hasCurrentMonthFull(status, { year: 2026, month: 9 }), false);
  });
});
