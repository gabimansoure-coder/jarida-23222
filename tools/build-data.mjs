#!/usr/bin/env node
// يقرأ data.json الخامّ من جذر المشروع (خارج مجلّد النشر docs/)
// ويكتب docs/assets/data.json: كلّ ما لا يخصّ الطلاب يبقى كما هو،
// وسجلّات الطلاب والمعلّم تُشفَّر AES-256-GCM بمفتاح PBKDF2 من الرمز والملح "23222".
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));

const SALT = '23222';
const ITER = 150000;
const enc = new TextEncoder();

// من الرمز: 48 بايت PBKDF2-SHA256 → أوّل 32 مفتاح AES، وآخر 16 (hex) معرّف بحث.
async function derive(code) {
  const km = await crypto.subtle.importKey('raw', enc.encode(String(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations: ITER }, km, 384));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt']);
  const lid = [...bits.slice(32)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { key, lid };
}

async function sealRecord(code, obj) {
  const { key, lid } = await derive(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return { l: lid, iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(ct).toString('base64') };
}

const students = await Promise.all(RAW.students.map(st => sealRecord(st.code, st)));
students.sort((a, b) => a.l < b.l ? -1 : 1); // لا يكشف الترتيب شيئًا عن السجلّ

const teacher = await sealRecord(RAW.teacherCode, { students: RAW.students, flags: RAW.flags });

const out = {
  meta: RAW.meta,
  sections: RAW.sections,
  angles: RAW.angles,
  rubric: RAW.rubric,
  prompts: RAW.prompts,
  promptGroups: RAW.promptGroups,
  stages: RAW.stages,
  sevenErrors: RAW.sevenErrors,
  auth: { salt: SALT, iter: ITER, students, teacher },
};

writeFileSync(join(root, 'docs/assets/data.json'), JSON.stringify(out));
console.log(`كُتب docs/assets/data.json — ${students.length} سجلّ طالب مشفَّرًا + كتلة المعلّم.`);
