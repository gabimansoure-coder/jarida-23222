#!/usr/bin/env node
// يبني docs/ من data/ و src/: يفحص البيانات، يشفّر ملفّ كلّ طالب، ويدمج الصفحة في ملف واحد.
// أيّ خلل في البيانات يوقف البناء، فلا يُنشر موقع ناقص.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pbkdf2Sync, createCipheriv, createHash, createHmac } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const RAW = read('data.json'), MODELS = read('models.json'), IMGS = read('imgs.json'), PRES = read('pres.json'), NAMES = read('names-ar.json');
const DOCS = join(root, 'docs'), ASSETS = join(DOCS, 'assets'), KDIR = join(ASSETS, 'k');
const SALT = '23222', ITER = 150000;
// تاريخ آخر تحديث في حاشية المئشار الرسميّ: 02 الوثائق الرسمية/مئشار الجريدة الشخصية — عربي — 1.9.2026.pdf
const RUBRIC_DATE = '1.9.2026';

const problems = [];
const must = (cond, msg) => { if (!cond) problems.push(msg); };
const withScheme = u => (/^https?:/.test(u) ? u : 'https://' + u);

/* ---------- فحص البيانات ---------- */
const expected = { 1: 34, 2: 37, 3: 34, 4: 31 };
const codes = RAW.students.map(s => String(s.code));
must(RAW.students.length === 136, `عدد الطلاب ${RAW.students.length} وليس 136`);
must(new Set(codes).size === codes.length, 'رموز مكرَّرة بين الطلاب');
must(codes.every(c => /^\d{4}$/.test(c)), 'رمز طالب ليس من أربعة أرقام');
must(/^\d{6}$/.test(String(RAW.teacherCode)), 'رمز المعلّم ليس من ستّة أرقام');
must(!codes.includes(String(RAW.teacherCode)), 'رمز المعلّم مطابق لرمز طالب');
for (const [s, n] of Object.entries(expected)) must(RAW.students.filter(x => x.sec === +s).length === n, `شعبة ${s} ليست ${n} طلاب`);
must(Object.keys(RAW.prompts).length === 32, 'عدد الأوامر ليس 32');
must(RAW.sevenErrors.length === 7, 'الأخطاء ليست سبعة');
const stageTotal = st => RAW.rubric.filter(r => r.stage === st).reduce((a, r) => a + r.pts, 0);
must(stageTotal('2') === 30 && stageTotal('3') === 70, 'مجموع المئشار ليس 30 + 70');
for (const r of RAW.rubric) must(r.items.reduce((a, i) => a + i[0], 0) === r.pts, `تفريعات البند ${r.n} لا تساوي ${r.pts}`);
const nameByCode = new Map(NAMES.map(n => [n.code, n]));
const seenAngle = new Set();
for (const st of RAW.students) {
  const a = (RAW.angles[st.sec] || []).find(x => x.n === st.angle);
  must(a, `${st.id}: زاوية ${st.angle} غير موجودة`);
  must(MODELS[st.sec]?.[st.angle], `${st.id}: لا نموذج لزاوية ${st.angle}`);
  must(nameByCode.has(String(st.code)), `${st.id}: الرمز غير موجود في ورقة الإرشاد`);
  must(nameByCode.get(String(st.code))?.he === st.name.trim(), `${st.id}: الاسم يختلف عن ورقة الإرشاد`);
  const key = st.sec + '-' + st.angle;
  must(!seenAngle.has(key), `زاوية ${key} معطاة لطالبين`);
  seenAngle.add(key);
}
for (const [s, list] of Object.entries(RAW.angles)) for (const a of list) {
  const g = a.guide;
  must(g?.b1?.steps?.length === 6 && g?.b2?.steps?.length === 4 && g?.b3?.steps?.length === 5 && g?.b8?.steps?.length === 4, `${s}-${a.n}: دليل ناقص`);
}
for (const s of Object.values(IMGS)) for (const im of Object.values(s)) must(existsSync(join(ASSETS, 'img', im.file)), `صورة مفقودة ${im.file}`);
if (problems.length) { console.error('توقّف البناء:\n- ' + problems.join('\n- ')); process.exit(1); }

/* ---------- التشفير ---------- */
function derive(code) {
  const bits = pbkdf2Sync(String(code), SALT, ITER, 48, 'sha256');
  return { key: bits.subarray(0, 32), id: bits.subarray(32).toString('hex') };
}
// IV مشتقّ من المحتوى: بناء البيانات نفسها يعطي الملفّ نفسه، فلا تتغيّر 136 ملفًّا في كلّ نشر.
function seal(obj, key) {
  const pt = Buffer.from(JSON.stringify(obj));
  const iv = createHmac('sha256', createHash('sha256').update(key).update('iv').digest()).update(pt).digest().subarray(0, 12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(pt), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]);
}

/* ---------- المحتوى ---------- */
const arName = code => { const a = (nameByCode.get(String(code))?.ar || '').replace(/\s+/g, ' ').trim(); return /^_+$/.test(a) ? '' : a; };
const cleanSrc = x => ({ t: x.t, u: withScheme(x.u), ...(x.add ? { add: 1 } : {}) });
const section = s => { const { name, topic, items, day, time, dates, iso, note } = RAW.sections[s]; return { name, topic, items, day, time, dates, iso, note, bank: RAW.sections[s].bank.map(cleanSrc) }; };
function angleFor(s, a) {
  // الزوايا الأربع بلا مصدر خاصّ: ورقة الإرشاد تعطيها أوّل ثلاثة من بنك الشعبة، والموقع يطابق الورقة.
  const fromBank = !a.sources.length;
  const sources = (fromBank ? RAW.sections[s].bank.slice(0, 3) : a.sources).map(cleanSrc);
  return { ...a, sources, ...(fromBank ? { fromBank: 1 } : {}) };
}
const student = st => ({ id: st.id, sec: st.sec, n: st.n, name: st.name.trim(), ar: arName(st.code), angle: st.angle, prov: !!st.prov });

/* ---------- الكتابة ---------- */
rmSync(KDIR, { recursive: true, force: true });
mkdirSync(KDIR, { recursive: true });
for (const f of readdirSync(ASSETS)) if (/^(common.*\.json|app\.js|style\.css|data\.json|models\.json|imgs\.json|pres\.json)$/.test(f)) rmSync(join(ASSETS, f));

for (const st of RAW.students) {
  const { key, id } = derive(st.code);
  const a = RAW.angles[st.sec].find(x => x.n === st.angle);
  const bundle = { kind: 's', st: student(st), sec: section(st.sec), ang: angleFor(st.sec, a), total: RAW.angles[st.sec].length, model: MODELS[st.sec][st.angle], img: IMGS[st.sec]?.[st.angle] || null };
  writeFileSync(join(KDIR, id + '.bin'), seal(bundle, key));
}
const t = derive(RAW.teacherCode);
const lightAngles = {};
for (const s of Object.keys(RAW.angles)) lightAngles[s] = RAW.angles[s].map(({ n, angle, item }) => ({ n, angle, item }));
const sections = {};
for (const s of Object.keys(RAW.sections)) sections[s] = section(s);
writeFileSync(join(KDIR, t.id + '.bin'), seal({ kind: 't', students: RAW.students.map(st => ({ ...student(st), code: String(st.code) })), flags: RAW.flags, sections, angles: lightAngles }, t.key));
writeFileSync(join(KDIR, t.id + '-m.bin'), seal({ models: MODELS, imgs: IMGS }, t.key));
writeFileSync(join(KDIR, t.id + '-p.bin'), seal(PRES, t.key));

const common = { meta: { rubricDate: RUBRIC_DATE, school: RAW.meta.school, teacher: RAW.meta.teacher }, rubric: RAW.rubric, prompts: RAW.prompts, promptGroups: RAW.promptGroups, stages: RAW.stages, sevenErrors: RAW.sevenErrors };
const commonText = JSON.stringify(common);
// الاسم ثابت والإصدار في الرابط: صفحة قديمة في ذاكرة المتصفّح تجد الملفّ دائمًا بدل 404.
const commonUrl = `assets/common.json?v=${createHash('sha256').update(commonText).digest('hex').slice(0, 10)}`;
writeFileSync(join(ASSETS, 'common.json'), commonText);

const js = readFileSync(join(root, 'src/app.js'), 'utf8').replace('__COMMON_URL__', commonUrl);
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
const html = readFileSync(join(root, 'src/index.html'), 'utf8').replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
writeFileSync(join(DOCS, 'index.html'), html);
writeFileSync(join(DOCS, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
writeFileSync(join(DOCS, '.nojekyll'), '');
writeFileSync(join(DOCS, 'CNAME'), 'jarida.gabimansour.com\n');

console.log(`بُني الموقع: ${RAW.students.length} ملفّ طالب مشفَّر + ملفّات المعلّم الثلاثة · الصفحة ${(html.length / 1024).toFixed(0)}KB `);
