#!/usr/bin/env node
// يدمج توثيقات الصور v-<sec>-<n>.json في docs/assets/imgs.json بعد التحقّق من الملفات.
// node tools/merge-imgs.mjs <مجلد gen/img> [--write]
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
const imgDir = join(root, 'docs/assets/img');
const files = readdirSync(src).filter(f => /^v-\d-\d+\.json$/.test(f)).sort();
const out = { 1: {}, 2: {}, 3: {}, 4: {} };
const errs = []; let okCount = 0, skips = 0;

for (const f of files) {
  let m;
  try { m = JSON.parse(readFileSync(join(src, f), 'utf8')); }
  catch (e) { errs.push(`${f}: JSON — ${e.message}`); continue; }
  if (m.skip) { skips++; continue; }
  const bad = [];
  if (!(m.sec >= 1 && m.sec <= 4 && Number.isInteger(m.n))) bad.push('sec/n');
  for (const k of ['file', 'what', 'author', 'license', 'sourcePage']) if (!m[k]) bad.push(k);
  if (!bad.length) {
    const p = join(imgDir, m.file);
    if (!existsSync(p)) bad.push('ملف الصورة غير موجود');
    else {
      const sz = statSync(p).size;
      if (sz < 10 * 1024) bad.push(`صغير جدًّا ${sz}B`);
      if (sz > 900 * 1024) bad.push(`كبير ${Math.round(sz / 1024)}KB`);
      const head = readFileSync(p).subarray(0, 4);
      const isJpg = head[0] === 0xFF && head[1] === 0xD8;
      const isPng = head[0] === 0x89 && head[1] === 0x50;
      if (!isJpg && !isPng) bad.push('ليس JPG/PNG');
    }
    if (!/^(PD|CC0|CC.BY)/i.test(m.license) && !/public domain/i.test(m.license)) bad.push('رخصة غير مقبولة: ' + m.license);
  }
  if (bad.length) { errs.push(`${f}: ${bad.join(' · ')}`); continue; }
  out[m.sec][m.n] = { file: m.file, what: m.what, author: m.author, date: m.date || '', license: m.license, sourcePage: m.sourcePage, sourceLabel: m.sourceLabel || 'ويكيميديا كومنز' };
  okCount++;
}
console.log(`صور صالحة: ${okCount} · تخطٍّ: ${skips} · مشاكل: ${errs.length}`);
errs.forEach(e => console.log('  - ' + e));
if (process.argv.includes('--write')) {
  writeFileSync(join(root, 'docs/assets/imgs.json'), JSON.stringify(out));
  console.log('كُتب docs/assets/imgs.json');
}
process.exit(errs.length ? 1 : 0);
