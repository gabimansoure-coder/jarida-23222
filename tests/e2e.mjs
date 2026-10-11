#!/usr/bin/env node
// اختبارات ما قبل النشر — تعمل على docs/ المبنيّ فعليًّا (البيانات المشفَّرة).
// تقرأ الحقيقة من data.json الخامّ وتتحقّق أنّ الموقع يعرضها لكلّ طالب.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));
const DOCS = join(root, 'docs');
const PORT = 4173;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = readFileSync(join(DOCS, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log((pass ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : '')); };

const browser = await chromium.launch();
const consoleErrors = [];
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  return page;
}

async function login(page, code) {
  await page.fill('#codeIn', String(code));
  await page.click('#loginForm .btn');
}
async function logout(page) {
  await page.evaluate(() => { localStorage.clear(); });
  const btn = page.locator('#logoutBtn:visible, #tLogout:visible, #gLogout:visible').first();
  if (await btn.count()) await btn.click();
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await newPage(ctx);
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#codeIn');

/* 1 — كلّ طالب من الـ136 */
let fails = 0, minSrc = Infinity;
for (const st of RAW.students) {
  const sec = RAW.sections[String(st.sec)];
  const ang = RAW.angles[String(st.sec)].find(a => a.n === st.angle);
  await login(page, st.code);
  try {
    await page.waitForSelector('#student:not([hidden]) .who .name', { timeout: 8000 });
  } catch {
    fails++; console.log('  ✗ دخول فشل: ' + st.id + ' (' + st.code + ')'); continue;
  }
  const got = await page.evaluate(() => ({
    name: document.querySelector('#student .who .name').textContent,
    angle: (document.querySelector('#student .angle') || {}).textContent || '',
    srcCount: document.querySelectorAll('#student .src li').length,
    p1: (document.querySelector('#promptList .prompt .body') || {}).textContent || '',
  }));
  const bad = [];
  if (got.name !== st.name) bad.push('الاسم');
  if (!got.angle.includes(ang.angle)) bad.push('الزاوية');
  if (got.srcCount < 3) bad.push('مصادر<3 (' + got.srcCount + ')');
  if (!got.p1.includes(ang.angle) || !got.p1.includes(sec.topic) || got.p1.includes('{{')) bad.push('الأمر 1 غير مملوء');
  minSrc = Math.min(minSrc, got.srcCount);
  if (bad.length) { fails++; console.log('  ✗ ' + st.id + ': ' + bad.join('، ')); }
  await logout(page);
  await page.waitForSelector('#login:not([hidden])');
}
ok('دخول 136 طالبًا: الاسم والزاوية و≥3 مصادر والأمر 1 مملوء', fails === 0, fails ? fails + ' إخفاقات' : 'أقلّ عدد مصادر معروض: ' + minSrc);

/* 2 — رمز خاطئ */
{
  const codes = new Set(RAW.students.map(s => s.code));
  let wrong = '0000'; while (codes.has(wrong) || wrong === RAW.teacherCode) wrong = String(Math.floor(Math.random() * 9000) + 1000);
  await login(page, wrong);
  await page.waitForFunction(() => document.querySelector('#loginErr').textContent.length > 0);
  const state = await page.evaluate(() => ({
    err: document.querySelector('#loginErr').textContent,
    student: document.querySelector('#student').hidden, teacher: document.querySelector('#teacher').hidden,
    studentEmpty: document.querySelector('#student').innerHTML === '', teacherEmpty: document.querySelector('#teacher').innerHTML === '',
  }));
  ok('رمز خاطئ لا يعرض شيئًا', state.err.length > 0 && state.student && state.teacher && state.studentEmpty && state.teacherEmpty);
  await page.fill('#codeIn', '');
}

/* 3 — لوحة المعلّم: أربع شعب 34/37/34/31 */
{
  await login(page, RAW.teacherCode);
  await page.waitForSelector('#teacher:not([hidden]) .tabs');
  const tabs = await page.$$eval('#teacher .tabs button', bs => bs.map(b => b.textContent.trim()));
  const expect = [34, 37, 34, 31];
  let pass = tabs.length === 4 && expect.every((n, i) => tabs[i].endsWith('· ' + n));
  // عدد الصفوف في كلّ شعبة
  const rowCounts = [];
  for (let i = 0; i < 4; i++) {
    await page.click(`#teacher .tabs button[data-s="${i + 1}"]`);
    await page.waitForSelector('#tBody table tbody tr');
    rowCounts.push(await page.$$eval('#tBody table tbody tr', r => r.length));
  }
  pass = pass && expect.every((n, i) => rowCounts[i] === n);
  const csv = await page.$('#csvBtn') !== null;
  ok('رمز المعلّم يفتح اللوحة بأربع شعب (34، 37، 34، 31)', pass, 'الصفوف: ' + rowCounts.join('، '));
  ok('زرّا «نسخ القائمة» و«تصدير CSV» موجودان', csv && (await page.$('#copyCodes')) !== null);
  await logout(page);
  await page.waitForSelector('#login:not([hidden])');
}

/* 4 — مجاميع المئشار وعدد الأوامر */
{
  const s2 = RAW.rubric.filter(r => r.stage === '2').reduce((a, r) => a + r.pts, 0);
  const s3 = RAW.rubric.filter(r => r.stage === '3').reduce((a, r) => a + r.pts, 0);
  ok('مجموع بنود المئشار = 30 و70 (في البيانات)', s2 === 30 && s3 === 70, s2 + ' و' + s3);
  const st = RAW.students[0];
  await login(page, st.code);
  await page.waitForSelector('#student:not([hidden])');
  await page.waitForSelector('#rubScore');
  const t2 = await page.textContent('#rubScore');
  await page.click('#student [data-r="3"]');
  const t3 = await page.textContent('#rubScore');
  ok('الموقع يعرض «من 30» و«من 70» في التقييم الذاتيّ', t2.includes('من 30') && t3.includes('من 70'));
  const nPrompts = Object.keys(RAW.prompts).length;
  const h = await page.textContent('#student h2:has-text("أوامرك الجاهزة")').catch(() => '');
  ok('عدد الأوامر 32', nPrompts === 32 && h.includes('32'), 'في البيانات: ' + nPrompts);

  /* 5 — صفحة «حلّ وظيفتي بحسب المئشار» */
  await page.click('#toGuide');
  await page.waitForSelector('#guide:not([hidden])');
  const g = await page.evaluate(() => ({
    items: document.querySelectorAll('#guide .gitem').length,
    nums: [...document.querySelectorAll('#guide .gitem .num')].map(x => x.textContent),
    p1: document.querySelector('#guide .gfirst .pbox').textContent,
    steps: document.querySelectorAll('#guide .gstep').length,
    btns: document.querySelectorAll('#guide .gstep .copy').length,
  }));
  const ang = RAW.angles[String(st.sec)].find(a => a.n === st.angle);
  ok('صفحة الحلّ: 8 بنود بترتيب المئشار', g.items === 8 && g.nums.join(',') === '1,2,3,4,5,6,7,8');
  ok('صفحة الحلّ: الأمر 1 أوّلًا ومملوء بالزاوية', g.p1.includes(ang.angle) && g.p1.includes(RAW.sections[String(st.sec)].topic));
  ok('صفحة الحلّ: ' + g.steps + ' خطوة من دليل الزاوية وبجانبها أزرار الأوامر', g.steps === 19 && g.btns >= 19);
  // فتح أمر من خطوة والتحقّق من ملئه
  await page.click('#guide .gstep .copy >> nth=0');
  const boxTxt = await page.evaluate(() => document.querySelector('#guide .gstep .pbox.open').textContent);
  ok('زرّ الخطوة يفتح الأمر الملائم مملوءًا', boxTxt.length > 50 && !boxTxt.includes('{{'));

  /* 5ب — الجريدة النموذجية */
  await page.click('#guide #backBtn');
  await page.waitForSelector('#student:not([hidden])');
  await page.click('#toModel');
  await page.waitForSelector('#model:not([hidden]) .modelpaper', { timeout: 15000 });
  const MOD = JSON.parse(readFileSync(join(root, 'docs/assets/models.json'), 'utf8'));
  const nModels = Object.values(MOD).reduce((a, s) => a + Object.keys(s).length, 0);
  const everyStudent = RAW.students.every(s => MOD[s.sec] && MOD[s.sec][s.angle]);
  ok('ملف النماذج: نموذج لكلّ زاوية ولكلّ طالب', nModels === 142 && everyStudent, nModels + ' نموذجًا');
  const mm = MOD[String(st.sec)][String(st.angle)];
  const got = await page.evaluate(() => ({
    name: document.querySelector('.mname').textContent,
    main: document.querySelector('.mmain').textContent,
    terms: document.querySelectorAll('.mtext mark.term').length,
    refs: document.querySelectorAll('.mrefs').length,
    warn: (document.querySelector('#model .warn') || {}).textContent || '',
    print: !!document.querySelector('#mPrint'),
  }));
  ok('النموذج يُعرض كاملًا بعناوينه ومصطلحاته المظلَّلة ومراجعه', got.name === mm.paperName && got.main === mm.mainTitle && got.terms >= 3 && got.refs >= 2 && got.print);
  ok('تنبيه «للتعلّم لا للنسخ» ظاهر فوق النموذج', got.warn.includes('ممنوع نسخ'));
  await page.click('#mBack');
  await page.waitForSelector('#student:not([hidden])');
  await logout(page);
  await page.waitForSelector('#login:not([hidden])');
}

/* 6 — هاتف 360px: لا تمرير أفقيّ */
{
  const mctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const mp = await newPage(mctx);
  await mp.goto(`http://localhost:${PORT}/`);
  await mp.waitForSelector('#codeIn');
  const noH = async () => mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  let pass = await noH();
  const st = RAW.students.find(s => s.sec === 4);
  await login(mp, st.code);
  await mp.waitForSelector('#student:not([hidden]) .who .name');
  pass = pass && await noH();
  await mp.click('#toGuide');
  await mp.waitForSelector('#guide:not([hidden])');
  pass = pass && await noH();
  await mp.click('#guide #backBtn');
  await mp.waitForSelector('#student:not([hidden])');
  await mp.click('#toModel');
  await mp.waitForSelector('#model:not([hidden]) .modelpaper', { timeout: 15000 });
  pass = pass && await noH();
  await mp.click('#mBack');
  await mp.waitForSelector('#student:not([hidden])');
  await mp.evaluate(() => localStorage.clear());
  await mp.click('#logoutBtn');
  await mp.waitForSelector('#login:not([hidden])');
  await login(mp, RAW.teacherCode);
  await mp.waitForSelector('#teacher:not([hidden]) .tabs');
  pass = pass && await noH();
  ok('لا تمرير أفقيّ على عرض 360px (دخول، طالب، حلّ، نموذج، معلّم)', pass);
  await mctx.close();
}

/* 7 — لا أخطاء console */
ok('لا أخطاء في console طوال الاختبارات', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = results.filter(r => !r.pass);
console.log('\n===== النتيجة: ' + (results.length - failed.length) + '/' + results.length + ' =====');
process.exit(failed.length ? 1 : 0);
