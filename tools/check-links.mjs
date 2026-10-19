#!/usr/bin/env node
// يفحص كلّ روابط المصادر (مصادر الزوايا + بنوك الشعب) ويكتب تقريرًا JSON.
// node tools/check-links.mjs <تقرير الإخراج.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));
const out = process.argv[2] || join(root, 'link-report.json');

const entries = [];
for (const [sec, s] of Object.entries(D.sections))
  s.bank.forEach((b, i) => entries.push({ where: `bank:${sec}:${i}`, t: b.t, u: b.u }));
for (const [sec, arr] of Object.entries(D.angles))
  for (const a of arr) (a.sources || []).forEach((src, i) => entries.push({ where: `angle:${sec}:${a.n}:${i}`, t: src.t, u: src.u }));

const norm = u => /^https?:/.test(u) ? u : 'https://' + u;
const uniq = [...new Map(entries.map(e => [norm(e.u), e])).keys()];
console.log(`روابط: ${entries.length} (فريدة: ${uniq.length})`);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
async function probe(url, method = 'GET') {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { method, redirect: 'follow', signal: ctl.signal,
      headers: { 'user-agent': UA, 'accept': 'text/html,application/pdf,*/*', 'accept-language': 'ar,en;q=0.8,he;q=0.6' } });
    clearTimeout(to);
    let size = r.headers.get('content-length');
    let sample = '';
    if (method === 'GET' && (r.headers.get('content-type') || '').includes('html')) {
      const buf = await r.arrayBuffer();
      size = buf.byteLength;
      sample = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 4000));
    }
    return { status: r.status, finalUrl: r.url, type: r.headers.get('content-type'), size: +size || null, sample };
  } catch (e) { clearTimeout(to); return { status: 0, error: String(e.cause?.code || e.message || e).slice(0, 120) }; }
}

const results = {};
let done = 0;
const queue = [...uniq];
async function worker() {
  while (queue.length) {
    const u = queue.shift();
    let r = await probe(u);
    if (r.status === 403 || r.status === 429 || r.status === 0) { await new Promise(s => setTimeout(s, 2500)); r = await probe(u); }
    // صفحات "غير موجود" الناعمة
    let soft = '';
    if (r.sample) {
      const low = r.sample.toLowerCase();
      if (/page not found|404|لم يتم العثور|הדף לא נמצא|no longer available/.test(low) && r.status === 200) soft = 'soft404?';
    }
    results[u] = { status: r.status, finalUrl: r.finalUrl !== u ? r.finalUrl : undefined, type: r.type, size: r.size, error: r.error, soft: soft || undefined };
    done++;
    if (done % 20 === 0) console.log(`${done}/${uniq.length}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const report = { checkedAt: new Date().toISOString(), total: uniq.length, entries, results };
writeFileSync(out, JSON.stringify(report, null, 1));
const bad = Object.entries(results).filter(([u, r]) => r.status !== 200 || r.soft);
console.log(`\nسليم: ${uniq.length - bad.length} / مشكوك أو ميّت: ${bad.length}`);
bad.forEach(([u, r]) => console.log(`  [${r.status}${r.soft ? ' ' + r.soft : ''}${r.error ? ' ' + r.error : ''}] ${u}`));
