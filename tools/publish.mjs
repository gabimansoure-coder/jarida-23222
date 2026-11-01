#!/usr/bin/env node
// النشر: يبني ويختبر، ثمّ ينسخ المستودع إلى مجلّد مؤقّت خارج iCloud، يبدّل الملفّات، ويرفع.
// القائمة أدناه هي كلّ ما يُرفع: data/ وتقرير الفحص لا يُرفعان لأنّ فيهما الأسماء والرموز.
//   node tools/publish.mjs             نشر فعليّ
//   node tools/publish.mjs --dry-run   كلّ شيء ما عدا الرفع، ويعرض ما كان سيتغيّر
//   node tools/publish.mjs -m "رسالة"  رسالة الحفظ
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/gabimansoure-coder/jarida-23222.git';
const PUBLISHED = ['docs', 'src', 'tools', 'tests', 'README.md', 'NOTES.md', 'package.json', '.gitignore'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const mIdx = args.indexOf('-m');
const message = mIdx >= 0 ? args[mIdx + 1] : 'تحديث الموقع';
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: 'inherit', ...opts });
const out = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', ...opts });

run('node', ['tools/build.mjs'], { cwd: root });
run('node', ['tests/e2e.mjs'], { cwd: root });

const tmp = mkdtempSync(join(tmpdir(), 'jarida-publish-'));
try {
  run('git', ['clone', '--depth', '1', '--branch', 'main', REPO, tmp]);
  for (const f of readdirSync(tmp)) if (f !== '.git') rmSync(join(tmp, f), { recursive: true, force: true });
  for (const f of PUBLISHED) cpSync(join(root, f), join(tmp, f), { recursive: true });

  // خطّ الدفاع الأخير: لا يُرفع ملفّ فيه اسم طالب أو رمز المعلّم
  const raw = JSON.parse(readFileSync(join(root, 'data', 'data.json'), 'utf8'));
  const secrets = [...raw.students.map(s => s.name.trim()), String(raw.teacherCode)];
  const walk = d => readdirSync(d).flatMap(f => { if (f === '.git') return []; const x = join(d, f); return statSync(x).isDirectory() ? walk(x) : [x]; });
  const leaks = walk(tmp).filter(f => !/\.(jpg|jpeg|png|bin)$/i.test(f)).filter(f => { const t = readFileSync(f, 'utf8'); return secrets.some(s => t.includes(s)); });
  if (leaks.length) throw new Error('توقّف النشر: بيانات خاصّة في ' + leaks.join(', '));

  run('git', ['add', '-A'], { cwd: tmp });
  console.log(out('git', ['diff', '--cached', '--shortstat'], { cwd: tmp }).trim() || 'لا تغييرات');
  if (!out('git', ['diff', '--cached', '--name-only'], { cwd: tmp }).trim()) { console.log('لا شيء جديد للنشر.'); process.exit(0); }
  run('git', ['commit', '-q', '-m', message], { cwd: tmp });
  if (dry) {
    run('git', ['push', '--dry-run', 'origin', 'main'], { cwd: tmp });
    console.log('تجربة فقط: لم يُرفع شيء.');
  } else {
    run('git', ['push', 'origin', 'main'], { cwd: tmp });
    console.log('نُشر. يتحدّث الموقع خلال دقائق: https://jarida.gabimansour.com');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
