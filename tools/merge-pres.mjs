#!/usr/bin/env node
// يدمج مئشار العرض + وظائف p-*.json في docs/assets/pres.json بعد التحقّق.
// node tools/merge-pres.mjs <مجلد gen> [--write]   (يتوقّع gen/pres-rubric.json و gen/pres/p-*.json)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gen = process.argv[2];
const wc = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const errs = [];

const R = JSON.parse(readFileSync(join(gen, 'pres-rubric.json'), 'utf8'));
const s2 = R.rubric.filter(r => r.stage === '2').reduce((a, r) => a + r.pts, 0);
const s3 = R.rubric.filter(r => r.stage === '3').reduce((a, r) => a + r.pts, 0);
if (s2 !== 30 || s3 !== 70) errs.push(`مجاميع المئشار: ${s2}/${s3}`);
for (const r of R.rubric) {
  const sum = r.items.reduce((a, it) => a + it[0], 0);
  if (sum !== r.pts) errs.push(`البند ${r.n}: مجموع التفريعات ${sum} ≠ ${r.pts}`);
}

const presDir = join(gen, 'pres');
const files = readdirSync(presDir).filter(f => /^p-\d+\.json$/.test(f)).sort();
const items = [];
for (const f of files) {
  let p;
  try { p = JSON.parse(readFileSync(join(presDir, f), 'utf8')); }
  catch (e) { errs.push(`${f}: JSON — ${e.message}`); continue; }
  const bad = [];
  for (const k of ['id', 'cluster', 'name', 'topic', 'desc', 'aspect', 'insight', 'slides', 'sources', 'sourcesEval', 'terms', 'refl']) if (!p[k]) bad.push(k);
  if (!bad.length) {
    const dw = wc(p.desc);
    if (dw < 150 || dw > 300) bad.push(`كلمات الوصف ${dw}`);
    if (!(p.slides.length >= 6 && p.slides.length <= 10)) bad.push(`شرائح ${p.slides.length}`);
    if (p.sources.length !== 3) bad.push(`مصادر ${p.sources.length}`);
    if (p.sourcesEval.length !== 3) bad.push(`تقييمات ${p.sourcesEval.length}`);
    if (!(Array.isArray(p.terms.main) && p.terms.main.length === 2 && p.terms.aspect)) bad.push('terms');
    else {
      p.terms.main = p.terms.main.map(t => {
        if (p.desc.includes(t)) return t;
        const core = t.replace(/\s*\(.*?\)\s*$/, '').trim();
        if (core && p.desc.includes(core)) return core;
        bad.push(`«${t}» غير مدمج في الوصف`); return t;
      });
      if (!p.aspect.text.includes(p.terms.aspect)) {
        const core = p.terms.aspect.replace(/\s*\(.*?\)\s*$/, '').trim();
        if (core && p.aspect.text.includes(core)) p.terms.aspect = core;
        else bad.push(`«${p.terms.aspect}» غير مدمج في الجانب`);
      }
    }
    if (!(p.refl && p.refl.length >= 4)) bad.push('refl');
  }
  if (bad.length) { errs.push(`${f}: ${bad.join(' · ')}`); continue; }
  items.push(p);
}
const perCluster = [1, 2, 3, 4].map(c => items.filter(x => x.cluster === c).length);
console.log(`وظائف صالحة: ${items.length}/20 (بالعناقيد: ${perCluster.join('، ')})`);
if (errs.length) { console.log('مشاكل:'); errs.forEach(e => console.log('  - ' + e)); }
if (process.argv.includes('--write')) {
  items.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  writeFileSync(join(root, 'docs/assets/pres.json'), JSON.stringify({ update: R.update, intro: R.intro, stages: R.stages, rubric: R.rubric, notes: R.notes, items }));
  console.log('كُتب docs/assets/pres.json');
}
process.exit(errs.length || items.length !== 20 ? 1 : 0);
