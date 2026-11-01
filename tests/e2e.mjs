#!/usr/bin/env node
// اختبارات ما قبل النشر: تشغّل docs/ كما هو في متصفّحات حقيقية وتتحقّق من كلّ ما تَعِد به ورقة الإرشاد.
// Playwright مثبَّت خارج سطح المكتب لأنّ iCloud يُخلي node_modules فتفشل القراءة (ETIMEDOUT).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const TOOLS = join(homedir(), '.cache', 'jarida-23222-tools');
if (!existsSync(join(TOOLS, 'node_modules', 'playwright'))) {
  console.log('تثبيت Playwright في ' + TOOLS + ' …');
  execSync(`mkdir -p "${TOOLS}" && cd "${TOOLS}" && npm init -y >/dev/null && npm i playwright@1.64.0 >/dev/null && npx playwright install chromium webkit`, { stdio: 'inherit' });
}
const { chromium, webkit, devices } = createRequire(join(TOOLS, 'x.js'))('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const RAW = read('data.json'), NAMES = read('names-ar.json'), MODELS = read('models.json'), IMGS = read('imgs.json'), PRES = read('pres.json');
const DOCS = join(root, 'docs');
const PORT = 4174, BASE = `http://localhost:${PORT}/`;
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.bin': 'application/octet-stream' };
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
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log((pass ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : '')); };
const SAMPLE = RAW.students.filter((_, i) => i % 17 === 0);
const student = code => RAW.students.find(s => s.code === code);
const firstCode = RAW.students[0].code;
const toArabic = c => c.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const toPersian = c => c.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

const pageErrors = [];
function watch(page) {
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/404|ERR_FAILED|ERR_INTERNET_DISCONNECTED|fonts\.g/.test(m.text() + m.location().url)) pageErrors.push(m.text()); });
  return page;
}
const inside = p => p.waitForSelector('#who:not([hidden])', { timeout: 30000 });
async function freshPage(ctx) {
  const page = watch(await ctx.newPage());
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(BASE);
  await page.waitForSelector('#codeIn');
  return page;
}
async function login(page, code) {
  await page.fill('#codeIn', String(code));
  await page.click('#loginBtn');
}
const logout = page => page.click('[data-act=logout]');
const text = (page, sel = 'body') => page.locator(sel).innerText();
const hasBadText = t => /undefined|\[object|\{\{|NaN/.test(t);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await freshPage(ctx);

/* 1 — كلّ رموز ورقة الإرشاد */
{
  let fails = [], minSrc = Infinity;
  for (const n of NAMES) {
    const st = student(n.code);
    const ang = RAW.angles[st.sec].find(a => a.n === st.angle);
    await login(page, n.code);
    try {
      await inside(page);
      const who = await text(page, '#who'), body = await text(page, '#view');
      const own = await page.locator('#sources ul.src').first().locator('a').count();
      const links = await page.locator('#sources ul.src a').count();
      const bankOpen = await page.locator('#sources details').evaluate(d => d.open);
      const expectedOwn = ang.sources.length || 3;
      if (own !== expectedOwn) fails.push(n.code + ': مصادر الزاوية ' + own + ' بدل ' + expectedOwn);
      if (own < 3 && !bankOpen) fails.push(n.code + ': مصادر قليلة والبنك مطويّ');
      minSrc = Math.min(minSrc, links);
      if (!who.includes(n.he)) fails.push(n.code + ': الاسم');
      if (n.ar && !/^_+$/.test(n.ar) && !who.includes(n.ar.replace(/\s+/g, ' ').trim())) fails.push(n.code + ': الاسم العربيّ');
      if (!body.includes(ang.angle)) fails.push(n.code + ': الزاوية');
      if (hasBadText(body)) fails.push(n.code + ': نصّ معطوب');
      if (links < 3) fails.push(n.code + ': مصادر مع البنك أقلّ من 3');
      await logout(page);
    } catch (e) { fails.push(n.code + ': ' + String(e).slice(0, 60)); await page.goto(BASE); await page.waitForSelector('#codeIn'); }
  }
  ok(`دخول كلّ الرموز المطبوعة في الورقة (${NAMES.length})`, NAMES.length === 136 && !fails.length, fails.slice(0, 5).join(' | ') + (fails.length ? '' : `أقلّ عدد مصادر: ${minSrc}`));
}

/* 2 — أشكال كتابة الرمز */
for (const [label, make] of [['أرقام عربية ٠١٢٣', toArabic], ['أرقام فارسية ۰۱۲۳', toPersian], ['فراغات داخل الرمز', c => c.slice(0, 2) + ' ' + c.slice(2)], ['علامات اتجاه خفيّة (نسخ ولصق)', c => '‏' + c + '‎ ']]) {
  let bad = 0;
  for (const st of SAMPLE) {
    await login(page, make(st.code));
    try { await inside(page); await logout(page); } catch { bad++; await page.goto(BASE); await page.waitForSelector('#codeIn'); }
  }
  ok(`الدخول بـ${label} (${SAMPLE.length} طلاب)`, bad === 0, bad ? bad + ' فشلوا' : '');
}
{
  await login(page, '0000');
  await page.waitForFunction(() => document.querySelector('#loginMsg').textContent.includes('غير صحيح'));
  ok('رمز خاطئ يعطي رسالة واضحة ولا يفتح شيئًا', !(await page.locator('#who').isVisible()));
  await login(page, '12');
  await page.waitForFunction(() => document.querySelector('#loginMsg').textContent.includes('وكتبت 2'));
  ok('رمز ناقص يعطي رسالة بعدد الأرقام', true);
  await page.fill('#codeIn', '');
  await page.press('#codeIn', 'Enter');
  await page.waitForFunction(() => document.querySelector('#loginMsg').textContent.includes('أوّلًا'));
  ok('ضغط Enter بحقل فارغ لا يعيد تحميل الصفحة', true);
}

/* 3 — الشبكة البطيئة والمنقطعة (أسباب الفشل في النسخة القديمة) */
{
  const c = await browser.newContext();
  const p = watch(await c.newPage());
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.route('**/assets/**', async r => { await new Promise(s => setTimeout(s, 2500)); await r.continue(); });
  let navs = 0; p.on('framenavigated', f => { if (f === p.mainFrame()) navs++; });
  await p.goto(BASE);
  await p.fill('#codeIn', firstCode);
  await p.click('#loginBtn');
  await inside(p);
  ok('شبكة بطيئة: الضغط فورًا بعد فتح الصفحة يدخل دون إعادة تحميل', navs === 1, 'تنقّلات: ' + navs);
  await c.close();

  const c2 = await browser.newContext();
  const p2 = watch(await c2.newPage());
  await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p2.goto(BASE);
  await p2.waitForSelector('#codeIn');
  await c2.setOffline(true);
  await p2.fill('#codeIn', firstCode);
  await p2.click('#loginBtn');
  await p2.waitForFunction(() => document.querySelector('#loginMsg').textContent.includes('لا اتصال'), null, { timeout: 40000 });
  const keptValue = await p2.inputValue('#codeIn');
  ok('انقطاع الشبكة: رسالة «لا اتصال» صادقة والرمز يبقى في الحقل', keptValue === firstCode);
  await c2.setOffline(false);
  await p2.click('#loginBtn');
  await inside(p2);
  ok('بعد عودة الشبكة: الضغط مرّة أخرى يدخل', true);
  await c2.close();
}

/* 4 — صفحات الطالب الستّ */
{
  await page.goto(BASE); await page.waitForSelector('#codeIn');
  await login(page, firstCode); await inside(page);
  const st = student(firstCode), ang = RAW.angles[st.sec].find(a => a.n === st.angle);

  await page.click('#nav a[data-r=guide]');
  await page.waitForSelector('.band');
  ok('حلّ الوظيفة: البنود الثمانية و19 خطوة', (await page.locator('.band').count()) === 8 && (await page.locator('.gstep').count()) === 19);
  await page.click('.first [data-copy="1"]');
  await page.waitForFunction(() => document.querySelector('.first [data-copy="1"]').textContent.includes('نُسخ'));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok('الأمر 1 يُنسخ مملوءًا بالزاوية', clip.includes(ang.angle) && !clip.includes('{{'));
  ok('الدليل بلا نصوص معطوبة', !hasBadText(await text(page, '#view')));

  await page.goBack(); await page.waitForSelector('.steps');
  ok('زرّ الرجوع في المتصفّح يعود إلى الصفحة الرئيسية ولا يخرج', await page.locator('#who').isVisible());

  await page.click('#nav a[data-r=model]');
  await page.waitForSelector('article.paper');
  const m = MODELS[st.sec][st.angle];
  const modelTxt = await text(page, 'article.paper');
  await page.waitForFunction(() => { const i = document.querySelector('article.paper img'); return !i || (i.complete && i.naturalWidth > 0); });
  ok('النموذج: العناوين وكلمة المحرّر والصورة', modelTxt.includes(m.mainTitle) && modelTxt.includes(m.editor.title) && !hasBadText(modelTxt));

  await page.click('#nav a[data-r=prompts]');
  await page.waitForSelector('#promptList');
  let promptCount = 0;
  for (const g of RAW.promptGroups) { await page.click(`[data-group=${g.k}]`); promptCount += await page.locator('#promptList .pcard').count(); }
  ok('الأوامر: 32 أمرًا في ستّ مجموعات', promptCount === 32, 'العدد ' + promptCount);
  ok('الأوامر بلا قوالب غير مملوءة', !hasBadText(await text(page, '#view')));

  await page.click('#nav a[data-r=check]');
  await page.waitForSelector('#rubList');
  const count = async () => page.evaluate(() => [...document.querySelectorAll('#rubList .pts')].reduce((a, e) => a + +e.textContent, 0));
  const s2 = await count();
  await page.click('[data-stage="3"]');
  const s3 = await count();
  ok('المئشار: 30 + 70', s2 === 30 && s3 === 70, `${s2} + ${s3}`);
  await page.click('[data-stage="2"]');
  await page.locator('#rubList input').first().check();
  await page.locator('[data-c="0"]').check();
  const score1 = await text(page, '#rubScore');
  await page.reload();
  await page.waitForSelector('#rubList');
  const persisted = await page.locator('#rubList input').first().isChecked() && await page.locator('[data-c="0"]').isChecked();
  ok('علامات التقييم تبقى بعد إعادة التحميل، والطالب يبقى داخلًا في الصفحة نفسها', persisted && score1.includes('2 من 30'));

  await page.click('#nav a[data-r=voice]');
  await page.waitForSelector('[data-copy="26"]');
  ok('المردودية: الأسئلة والأوامر 26-28', (await text(page, '#view')).includes('التأمّل في المسار') && (await page.locator('[data-copy="28"]').count()) === 1);
  await logout(page);
  await page.waitForSelector('#codeIn');
  ok('الخروج يعيد صفحة الدخول ويخلي الصفحة', !(await text(page)).includes(st.name));
}

/* 5 — كلّ النماذج عبر لوحة المعلّم */
{
  await login(page, RAW.teacherCode); await inside(page);
  await page.waitForSelector('#tRows tr');
  const rows = [];
  for (const s of [1, 2, 3, 4]) { await page.click(`#nav a[data-r="t/${s}"]`); await page.waitForFunction(n => document.querySelector('.kicker')?.innerText.includes('יב-' + n), s); rows.push(await page.locator('#tRows tr').count()); }
  ok('لوحة المعلّم: 34، 37، 34، 31', rows.join() === '34,37,34,31', rows.join());

  await page.click('#nav a[data-r="t/1"]');
  await page.waitForFunction(() => document.querySelector('.kicker')?.innerText.includes('יב-1'));
  const s1 = RAW.students.find(x => x.sec === 1);
  await page.fill('#tSearch', String(s1.code));
  const vis = await page.locator('#tRows tr:visible').count();
  ok('البحث برمز الطالب يجد صفّه', vis === 1);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=csv]')]);
  const csv = readFileSync(await dl.path(), 'utf8');
  ok('تصدير CSV بالأسماء والرموز', csv.includes(s1.name) && csv.includes(String(s1.code)) && csv.split('\n').length === 35);

  let bad = [], imgCount = 0, total = 0;
  for (const s of Object.keys(RAW.angles)) for (const a of RAW.angles[s]) {
    total++;
    await page.goto(`${BASE}#/t/model/${s}/${a.n}`);
    await page.waitForSelector('article.paper');
    const t = await text(page, 'article.paper');
    if (!t.includes(MODELS[s][a.n].mainTitle) || hasBadText(t)) bad.push(s + '-' + a.n);
    if (IMGS[s]?.[a.n]) {
      const loaded = await page.waitForFunction(() => { const i = document.querySelector('article.paper img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).then(() => true, () => false);
      if (loaded) imgCount++; else bad.push('صورة ' + s + '-' + a.n);
    }
  }
  ok(`كلّ النماذج تُفتح (${total}) وكلّ الصور تُحمَّل (${imgCount})`, total === 142 && imgCount === 137 && !bad.length, bad.slice(0, 5).join(' '));

  await page.goto(BASE + '#/t/pres');
  await page.waitForSelector('a[href^="#/t/pres/"]');
  const presLinks = await page.locator('a[href^="#/t/pres/"]').count();
  await page.locator('a[href^="#/t/pres/"]').first().click();
  await page.waitForSelector('article.paper');
  ok('وظائف العرض الشخصيّ: 20 وتُفتح', presLinks === PRES.items.length && presLinks === 20 && !hasBadText(await text(page, 'article.paper')));
  await page.goto(BASE + '#/t/notes');
  await page.waitForSelector('.kicker');
  ok('ملاحظات الحسم معروضة', (await text(page, '#view')).includes(RAW.flags[0].slice(0, 20)));
  await logout(page);
}

/* 6 — جهاز مشترك */
{
  const c = await browser.newContext();
  const p = await freshPage(c);
  await login(p, firstCode); await inside(p);
  const stored = await p.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  const p2 = await freshPage(c);
  await p2.waitForTimeout(800);
  ok('حاسوب المدرسة: تبويب جديد لا يفتح صفحة الطالب السابق', !(await p2.locator('#who').isVisible()));
  ok('الرمز لا يُحفظ دائمًا دون طلب الطالب', !stored.includes(firstCode));
  await p2.close();
  await p.evaluate(() => localStorage.setItem('jr23222:last', '"' + document.title + '"'));
  await p.goto(BASE); await p.waitForTimeout(500);
  ok('مفتاح «آخر رمز» القديم يُمحى عند الفتح', (await p.evaluate(() => localStorage.getItem('jr23222:last'))) === null);
  await c.close();

  const c3 = await browser.newContext();
  const p3 = await freshPage(c3);
  await p3.check('#remember');
  await login(p3, firstCode); await inside(p3);
  const p4 = await freshPage(c3);
  await inside(p4);
  ok('«هذا جهازي» يُبقي الطالب داخلًا بطلبه', true);
  await logout(p4);
  await p4.waitForSelector('#codeIn');
  const p5 = await freshPage(c3);
  await p5.waitForTimeout(600);
  ok('الخروج يلغي التذكّر', !(await p5.locator('#who').isVisible()));
  await c3.close();

  // علامات النسخة القديمة محفوظة بمفتاح الرمز ويجب ألّا تضيع
  const c4 = await browser.newContext();
  const p6 = await freshPage(c4);
  await p6.evaluate(code => localStorage.setItem('jr23222:' + code, JSON.stringify({ p: { 1: true }, c: { 2: true }, r: { '1.0': true } })), firstCode);
  await login(p6, firstCode); await inside(p6);
  await p6.goto(BASE + '#/check'); await p6.waitForSelector('#rubList');
  const migrated = await p6.locator('[data-c="2"]').isChecked() && await p6.locator('#rubList input').first().isChecked();
  const oldGone = await p6.evaluate(code => localStorage.getItem('jr23222:' + code), firstCode);
  ok('علامات النسخة القديمة تنتقل ولا تضيع، ومفتاح الرمز القديم يُمحى', migrated && oldGone === null);
  await c4.close();
}

/* 7 — الهاتف: 360 بكسل، أندرويد وآيفون */
async function mobile(label, type, opts) {
  const b = type === 'webkit' ? await webkit.launch() : browser;
  const c = await b.newContext(opts);
  const p = await freshPage(c);
  await login(p, toArabic(firstCode)); await inside(p);
  const overflow = [];
  for (const r of ['', 'guide', 'model', 'prompts', 'check', 'voice']) {
    await p.goto(BASE + '#/' + r);
    await p.waitForTimeout(150);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) overflow.push((r || 'home') + ':' + o);
  }
  ok(`${label}: دخول بأرقام عربية وكلّ الصفحات بلا تمرير أفقيّ`, !overflow.length, overflow.join(' '));
  await p.goto(BASE + '#/'); await p.waitForTimeout(150);
  const navBox = await p.locator('#nav').boundingBox();
  ok(`${label}: شريط التنقّل ظاهر في أسفل الشاشة`, !!navBox && navBox.y + navBox.height <= (opts.viewport?.height || 900) + 1);
  await c.close();
  if (b !== browser) await b.close();
}
await mobile('هاتف صغير 360px', 'chromium', { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
await mobile('أندرويد Pixel 7', 'chromium', { ...devices['Pixel 7'] });
await mobile('آيفون iPhone 13 (WebKit)', 'webkit', { ...devices['iPhone 13'] });

/* 8 — الخصوصية في الملفّات المنشورة */
{
  const walk = d => readdirSync(d).flatMap(f => { const x = join(d, f); return statSync(x).isDirectory() ? walk(x) : [x]; });
  const files = walk(DOCS).filter(f => !/\.(jpg|jpeg|png|gif|webp)$/i.test(f));
  const haystack = files.map(f => readFileSync(f, 'latin1') + readFileSync(f, 'utf8')).join('\n');
  const leakedNames = RAW.students.filter(s => haystack.includes(s.name.trim()));
  const leakedAr = NAMES.filter(n => n.ar && !/^_+$/.test(n.ar) && haystack.includes(n.ar.replace(/\s+/g, ' ').trim()));
  ok('لا اسم طالب بالعبرية أو العربية نصًّا في أيّ ملفّ منشور', !leakedNames.length && !leakedAr.length, leakedNames.length + leakedAr.length ? (leakedNames.length + leakedAr.length) + ' تسريبات' : '');
  ok('رمز المعلّم لا يظهر في أيّ ملفّ منشور', !haystack.includes(String(RAW.teacherCode)));
  ok('لا بيانات خامّ منشورة', !existsSync(join(DOCS, 'data.json')) && !existsSync(join(DOCS, 'assets', 'data.json')) && !existsSync(join(DOCS, 'assets', 'models.json')));
  const html = readFileSync(join(DOCS, 'index.html'), 'utf8');
  ok('الصفحة noindex والدومين محفوظ', html.includes('noindex') && readFileSync(join(DOCS, 'CNAME'), 'utf8').trim() === 'jarida.gabimansour.com');
}

ok('لا أخطاء JavaScript في أيّ اختبار', !pageErrors.length, pageErrors.slice(0, 3).join(' | '));
await browser.close();
server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} نجحت`);
if (failed.length) { console.log('فشلت:\n- ' + failed.map(f => f.name).join('\n- ')); process.exit(1); }
