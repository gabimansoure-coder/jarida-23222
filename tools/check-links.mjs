#!/usr/bin/env node
// يفتح كلّ رابط مصدر في متصفّح حقيقيّ ويطبع ما لم يُفتح. 403/429 قد تعني حجب الآليّين لا رابطًا معطوبًا: يُفحص يدويًّا.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';

const { chromium } = createRequire(join(homedir(), '.cache', 'jarida-23222-tools', 'x.js'))('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = JSON.parse(readFileSync(join(root, 'data', 'data.json'), 'utf8'));
const urls = new Map();
const add = u => { const x = /^https?:/.test(u) ? u : 'https://' + u; urls.set(x, (urls.get(x) || 0) + 1); };
for (const s in D.sections) {
  D.sections[s].bank.forEach(b => add(b.u));
  D.angles[s].forEach(a => a.sources.forEach(x => add(x.u)));
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'ar', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' });
const bad = [];
let good = 0;
for (const [u, n] of urls) {
  const p = await ctx.newPage();
  let code = 0, note = '';
  try {
    const r = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
    code = r ? r.status() : 0;
    note = (await p.title()).slice(0, 50);
  } catch (e) {
    // ملفّات PDF تبدأ تنزيلًا بدل فتح صفحة: هذا رابط يعمل
    if (/Download is starting/.test(String(e))) code = 200;
    else note = String(e).split('\n')[0].slice(0, 70);
  }
  await p.close();
  if (code >= 200 && code < 400) good++;
  else bad.push({ code, n, u, note });
  await new Promise(r => setTimeout(r, 400));
}
await browser.close();
console.log(`روابط فريدة ${urls.size} · فُتحت ${good} · لم تُفتح ${bad.length}`);
for (const b of bad) console.log(`${b.code}\t${b.n} إحالة\t${b.u}\t${b.note}`);
