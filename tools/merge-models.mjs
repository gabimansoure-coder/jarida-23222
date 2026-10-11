#!/usr/bin/env node
// يتحقّق من ملفات الجرائد النموذجية m-<sec>-<n>.json ويدمجها في docs/assets/models.json
// الاستعمال: node tools/merge-models.mjs <مجلد الملفات>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('أعطني مجلد الملفات.'); process.exit(2); }

const RAW = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));
const wc = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const LIMITS = { central: [200, 400], secondary: [200, 400], editor: [250, 450] };

const files = readdirSync(src).filter(f => /^m-\d-\d+\.json$/.test(f)).sort();
const out = { 1: {}, 2: {}, 3: {}, 4: {} };
const errs = [];
let okCount = 0;

for (const f of files) {
  const p = join(src, f);
  let m;
  try { m = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { errs.push(`${f}: JSON غير صالح — ${e.message}`); continue; }
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(msg); };
  need(m.sec >= 1 && m.sec <= 4 && Number.isInteger(m.n), 'sec/n');
  need(m.paperName && m.issueDate && m.mainTitle && m.subTitle, 'الرأس والعناوين');
  need(m.visual && m.visual.what && m.visual.caption && m.visual.source, 'المركّب البصريّ');
  need(m.central && m.central.text && Array.isArray(m.central.refs) && m.central.refs.length >= 2, 'المركزيّ ومرجعاه');
  need(m.secondary && m.secondary.type && m.secondary.title && m.secondary.text && m.secondary.ref, 'الثانويّ');
  need(m.editor && m.editor.title && m.editor.text, 'كلمة المحرّر');
  need(m.terms && Array.isArray(m.terms.central) && m.terms.central.length === 2 && m.terms.secondary && m.terms.editor, 'المصطلحات');
  if (!bad.length) {
    const cw = wc(m.central.text), sw = wc(m.secondary.text), ew = wc(m.editor.text);
    if (cw < LIMITS.central[0] || cw > LIMITS.central[1]) bad.push(`كلمات المركزيّ ${cw}`);
    if (sw < LIMITS.secondary[0] || sw > LIMITS.secondary[1]) bad.push(`كلمات الثانويّ ${sw}`);
    if (ew < LIMITS.editor[0] || ew > LIMITS.editor[1]) bad.push(`كلمات المحرّر ${ew}`);
    // لاحقة تصنيف مثل «(قيمة)» ليست جزءًا من المصطلح المدمج في النصّ
    m.terms.central = m.terms.central.map(t => {
      if (m.central.text.includes(t)) return t;
      const core = t.replace(/\s*\(.*?\)\s*$/, '').trim();
      if (core && m.central.text.includes(core)) return core;
      bad.push(`المصطلح «${t}» غير مدمج في المركزيّ`);
      return t;
    });
    if (/مقابلة/.test(m.secondary.type) && !m.secondary.fictionNote) bad.push('مقابلة بلا fictionNote');
    const ang = (RAW.angles[String(m.sec)] || []).find(a => a.n === m.n);
    if (!ang) bad.push('زاوية غير موجودة في data.json');
  }
  if (bad.length) { errs.push(`${f}: ${bad.join(' · ')}`); continue; }
  out[m.sec][m.n] = m;
  okCount++;
}

const expected = Object.entries(RAW.angles).flatMap(([s, arr]) => arr.map(a => `m-${s}-${a.n}.json`));
const have = new Set(files);
const missing = expected.filter(f => !have.has(f));

console.log(`صالح: ${okCount} / متوقَّع: ${expected.length}`);
if (missing.length) console.log('ناقص: ' + missing.join('، '));
if (errs.length) { console.log('مشاكل:'); errs.forEach(e => console.log('  - ' + e)); }

if (process.argv.includes('--write')) {
  writeFileSync(join(root, 'docs/assets/models.json'), JSON.stringify(out));
  console.log('كُتب docs/assets/models.json');
}
process.exit(errs.length || missing.length ? 1 : 0);
