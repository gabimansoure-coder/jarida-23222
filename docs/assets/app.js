'use strict';
/* الجريدة الشخصية 23222 — التطبيق كاملًا.
   البيانات تُحمَّل من assets/data.json؛ سجلّات الطلاب والمعلّم فيها مشفَّرة
   AES-256-GCM بمفتاح PBKDF2 من رمز الدخول والملح "23222"، فلا يُفكّ إلّا سجلّ صاحب الرمز. */

/* ---------- helpers ---------- */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const store={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const todayISO=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const daysUntil=iso=>{const a=new Date(todayISO()+'T00:00:00'),b=new Date(iso+'T00:00:00');return Math.round((b-a)/86400000)};
function fmtDays(d){if(d<0)return'انتهى';if(d===0)return'اليوم';if(d===1)return'غدًا';if(d===2)return'بعد يومين';if(d<=10)return'بعد '+d+' أيام';return'بعد '+d+' يومًا'}
function copyText(txt,btn){const done=()=>{btn.classList.add('ok');const o=btn.textContent;btn.textContent='نُسخ ✓';setTimeout(()=>{btn.classList.remove('ok');btn.textContent=o},1600)};
  const fallback=()=>{const ta=document.createElement('textarea');ta.value=txt;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done()}catch(e){btn.textContent='انسخ يدويًّا'}document.body.removeChild(ta)};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done,fallback)}else fallback()}

/* ---------- فكّ التشفير ---------- */
const te=new TextEncoder();
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function derive(code){
  const km=await crypto.subtle.importKey('raw',te.encode(String(code)),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:te.encode(D.auth.salt),iterations:D.auth.iter},km,384));
  const key=await crypto.subtle.importKey('raw',bits.slice(0,32),'AES-GCM',false,['decrypt']);
  const lid=[...bits.slice(32)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return {key,lid};
}
async function unseal(entry,key){
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(entry.iv)},key,b64(entry.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function tryCode(v){
  const {key,lid}=await derive(v);
  try{
    if(D.auth.teacher.l===lid)return{teacher:await unseal(D.auth.teacher,key)};
    const e=D.auth.students.find(s=>s.l===lid);
    if(e)return{student:await unseal(e,key)};
  }catch(err){}
  return null;
}

/* ---------- حالة عامّة ---------- */
let D=null;            // البيانات المحمَّلة
let CUR=null;          // الطالب الحاليّ بعد فكّ سجلّه
let MODELS=null;       // الجرائد النموذجية (تُحمَّل عند أوّل طلب)
const loginEl=$('#login'),studentEl=$('#student'),guideEl=$('#guide'),teacherEl=$('#teacher'),modelEl=$('#model');
const angleOf=(sec,n)=>(D.angles[sec]||[]).find(a=>a.n===n);
function showOnly(el){[loginEl,studentEl,guideEl,teacherEl,modelEl].forEach(x=>x.hidden=(x!==el));window.scrollTo({top:0})}
function logout(){store.del('jr23222:last');CUR=null;[studentEl,guideEl,teacherEl,modelEl].forEach(el=>el.innerHTML='');$('#codeIn').value='';$('#codeIn').placeholder='••••';showOnly(loginEl);$('#codeIn').focus()}

/* ---------- ملء الأوامر ---------- */
function fillPrompt(p,ctx){
  return p.x.replace('{{topic}}',ctx.topic).replace('{{angle}}',ctx.angle).replace('{{item}}',ctx.item?' البند في الميكود: '+ctx.item+'.':'');
}
function renderPromptHTML(txt,ctx){
  let h=esc(txt);
  h=h.replace(/\[([^\]]+)\]/g,'<mark>[$1]</mark>');
  if(ctx.angle&&ctx.angle.length>8){h=h.split(esc(ctx.angle)).join('<span class="fill">'+esc(ctx.angle)+'</span>')}
  if(ctx.topic){h=h.split(esc(ctx.topic)).join('<span class="fill">'+esc(ctx.topic)+'</span>')}
  return h;
}

/* ---------- صفحة الطالب ---------- */
function openStudent(st){
  CUR=st;
  const sec=D.sections[st.sec];const ang=st.angle?angleOf(st.sec,st.angle):null;
  const ctx={topic:sec.topic,angle:ang?ang.angle:'[زاويتي — لم تُسجَّل بعد؛ أسأل المعلّم]',item:ang?ang.item:''};
  const key='jr23222:'+st.code;const saved=store.get(key)||{p:{},c:{},r:{}};saved.r=saved.r||{};
  const next=sec.iso.map((iso,i)=>({i,d:daysUntil(iso)})).find(o=>o.d>=0);
  const stageRows=D.stages.map((s,i)=>`<tr class="${next&&next.i===i?'next':''}"><td><b>${s.name}</b></td><td>${esc(s.what)}</td><td class="due">${sec.dates[i]}<br><span class="small muted">${fmtDays(daysUntil(sec.iso[i]))}</span></td><td class="points">${s.pts}</td></tr>`).join('');
  const srcs=ang&&ang.sources.length?ang.sources:[];
  const bank=sec.bank;
  const li=(x,pre)=>`<li><div class="t">${esc(x.t)}${x.add?' <span class="tag blue">أضافه المعلّم 11/10</span>':''}</div><a href="${pre}${esc(x.u)}" target="_blank" rel="noopener">${esc(x.u)}</a></li>`;
  const srcHTML=(srcs.length?`<p class="small muted" style="margin:0 0 8px">لزاويتك تحديدًا:</p><ul class="src">${srcs.map(x=>li(x,/^https?:/.test(x.u)?'':'https://')).join('')}</ul>`
      :`<div class="warn">بنك المصادر لا يغطّي هذه الزاوية بمصدر خاصّ. ابدأ من بنك الشعبة أدناه، وابحث في أرشيف أو متحف أو جامعة أو مجلّة محكَّمة أو وثيقة أوّلية، واعرض كلّ مصدر على المعلّم قبل أن تبني عليه.</div>`)+
    `<details style="margin-top:14px" ${srcs.length<2?'open':''}><summary style="cursor:pointer;font-weight:600">بنك الشعبة — ${bank.length} مصدرًا فتح المعلّم كلّ رابط منها (آخر تحقّق 11/10/2026)</summary><ul class="src" style="margin-top:10px">${bank.map(x=>li(x,'')).join('')}</ul></details>`+
    (sec.note?`<p class="small muted" style="margin:10px 0 0">${esc(sec.note)}</p>`:'');
  const groupsHTML=D.promptGroups.map((g,gi)=>`<button role="tab" aria-selected="${gi===0}" data-g="${g.k}">${esc(g.label)}</button>`).join('');
  studentEl.innerHTML=`
  <div class="who"><div><div class="name">${esc(st.name)}</div><div class="sub">${sec.name} · ${sec.day} ${sec.time} · رقم ${st.n} في السجلّ</div></div><button class="btn ghost small" id="logoutBtn" type="button">خروج</button></div>
  ${ang?`<button class="bigbtn" id="toGuide" type="button">حلّ وظيفتي بحسب المئشار — خطوة خطوة<small>البنود الثمانية، وتحت كلّ بند خطوات زاويتك أنت، وبجانب كلّ خطوة الأمر الجاهز المناسب لها.</small></button>
  <button class="bigbtn mbtn" id="toModel" type="button">الجريدة النموذجية لزاويتي<small>مثال كامل بحسب المئشار على زاويتك أنت: العناوين، التقريران، كلمة المحرّر، المركّب البصريّ — تتعلّم من شكله ولا تنسخ منه.</small></button>`:''}
  <div class="stack">
    <div class="grid2">
      <section class="card"><div class="kicker">موضوع شعبتك</div><h2>${esc(sec.topic)}</h2><ul style="margin:0;padding-right:18px">${sec.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul><p class="small muted" style="margin:10px 0 0">بنود الميكود 2027 التي تُقيَّم بالجريدة وحدها؛ الامتحان الخارجيّ ليس عليها.</p></section>
      <section class="card"><div class="kicker">المواعيد — ${sec.name}</div><h2>${next?'القادم: '+D.stages[next.i].name.split(' — ')[0]+' — '+fmtDays(next.d):'انتهت مواعيد التسليم'}</h2><div class="tablewrap"><table class="stagetable"><thead><tr><th>المرحلة</th><th>ما تسلّمه</th><th>الموعد</th><th>النقاط</th></tr></thead><tbody>${stageRows}</tbody></table></div><p class="small muted" style="margin:10px 0 0">النقاط بحسب المئشار الرسميّ المحدَّث في 1.9.2026 (المرحلة 2 = 30، المرحلة 3 = 70 ومنها 20 للمردودية الصوتية: تُفتح بعد التسليم النهائيّ، 72 ساعة لتبدأها، بصوتك أنت وإلّا صفر).</p></section>
    </div>
    <section class="card"><div class="kicker">زاويتك</div>
      ${ang?`<div class="angle">${esc(ang.angle)}</div>
      <dl class="kv"><dt>رقم الوظيفة</dt><dd>${ang.n} من ${D.angles[st.sec].length} ${st.prov?'<span class="tag amber">مقترحة من المعلّم — تُثبَّت بتوقيعك على الورقة</span>':''} ${ang.new?'<span class="tag blue">زاوية مضافة</span>':''}</dd>
      <dt>البند من الميكود</dt><dd>${esc(ang.item)}</dd>
      <dt>مفاهيم مقترحة</dt><dd>${esc(ang.concepts||'—')}</dd>
      <dt>نوع مقترح للفرعية</dt><dd>${esc(ang.subtype||'—')}</dd>
      <dt>اقتراح للعنصر البصريّ</dt><dd>${esc(ang.visual||'—')} — واذكر مصدره كاملًا: اسم العمل، منتجه، أين نُشر.</dd></dl>
      <p class="small muted" style="margin:10px 0 0">الاقتراحات اقتراحات؛ القرار قرارك. ممنوع أن يكتب طالبان في الشعبة نفسها عن الزاوية نفسها.</p>`
      :`<div class="angle none">زاويتك لم تُسجَّل بعد. في الحصّة القادمة تختار زاوية من زوايا شعبتك وتوقّع عليها، ويسجّلها المعلّم هنا.</div><p class="small muted">حتى ذلك الحين تستطيع أن تبدأ بالمرحلة 1 على موضوع الشعبة كلّه، وأن تجمع مصادر من بنك المعلّم أدناه.</p>`}
    </section>
    <section class="card"><div class="kicker">المصادر</div><h2>مصادر للبدء</h2>${srcHTML}<div class="warn" style="margin-top:12px">افتح كلّ رابط بنفسك؛ ما لا يُفتح لا يُستعمل. تحتاج مصدرين مختلفين للتقرير المركزيّ ومصدرًا ثالثًا مختلفًا للتقرير الثانويّ، غير كتاب التعليم، وأن تصنّف موثوقيّة كلّ مصدر وصلته (المئشار: 4 + 2 نقاط). ممنوع: ويكيبيديا، المدوّنات، المواقع المجهولة، وأيّ نصّ أنتجه ذكاء اصطناعيّ. العربية والعبرية والإنجليزية والفرنسية كلّها مقبولة.</div></section>
    <section class="card"><div class="kicker">الذكاء الاصطناعي</div><h2>أوامرك الجاهزة — ${Object.keys(D.prompts).length} أمرًا</h2>
      <p class="small muted" style="margin:0 0 6px">اضغط «نسخ» ثم الصق الأمر في الذكاء الاصطناعي الذي تستعمله. ما بين <mark style="background:var(--amber-soft);color:var(--amber);padding:0 4px;border-radius:4px">[قوسين]</mark> تملؤه أنت؛ وما هو <span class="fill" style="background:var(--blue-soft);color:var(--blue);padding:0 4px;border-radius:4px">مظلَّل بالأزرق</span> مُلئ لك من ورقتك.</p>
      <div class="stages" role="tablist">${groupsHTML}</div>
      <p class="stagenote" id="stageNote"></p>
      <div id="promptList"></div>
    </section>
    <section class="card"><div class="kicker">المئشار الرسميّ — تحديث 1.9.2026</div><h2>ثمانية بنود، 100 نقطة: قيّم نفسك قبل أن يقيّمك غيرك</h2>
      <p class="small muted" style="margin:0 0 10px">علّم ما أنجزته فعلًا؛ المجموع يُحسب على جهازك فقط ولا يراه أحد. «العنقود» في المئشار هو موضوع شعبتك، و«التقرير الإخباريّ المركزيّ» هو مقالتك المركزية، و«التقرير الثانويّ» هو مقالتك الفرعية.</p>
      <div class="stages" role="tablist"><button role="tab" aria-selected="true" data-r="2">المرحلة 2 — 30 نقطة</button><button role="tab" aria-selected="false" data-r="3">المرحلة 3 — 70 نقطة</button></div>
      <div class="progress"><i id="rubBar"></i></div><p class="small" id="rubScore" style="margin:0 0 12px"></p>
      <div id="rubList"></div>
    </section>
    <section class="card"><div class="kicker">قبل أن تسلّم</div><h2>سبعة أخطاء تُسقط نقاطًا</h2><div class="progress"><i id="sixBar"></i></div><ul class="check" id="sixList">${D.sevenErrors.map((s,i)=>`<li class="${saved.c[i]?'on':''}"><label><input type="checkbox" data-i="${i}" ${saved.c[i]?'checked':''}><span>${esc(s)}</span></label></li>`).join('')}</ul></section>
    <section class="card"><div class="kicker">القواعد</div><h2>الذكاء الاصطناعي في الجريدة</h2><div class="rules">
      <div class="ok"><h3>مسموح</h3><ul><li>طلب اقتراح مصادر ثم التحقّق منها بنفسك</li><li>العصف الذهنيّ لصياغة الديلما</li><li>شرح مفهوم ثم التحقّق منه</li><li>الامتحان الذاتيّ قبل المردودية</li><li>تحسين صياغة جملة كتبتها أنت</li></ul></div>
      <div class="no"><h3>ممنوع</h3><ul><li>نسخ نصّ منه</li><li>ذكره مصدرًا</li><li>الاعتماد على معلومة بلا تحقّق</li><li>كتابة «كلمة المحرّر»</li><li>ويكيبيديا والمدوّنات والمواقع المجهولة</li></ul></div></div>
      <p class="small muted" style="margin:10px 0 0">عبارة «استعمل بشكل نقديّ ومسؤول أدوات الذكاء الاصطناعيّ» تتكرّر في ستّة بنود من المئشار، والمردودية الصوتية (20 نقطة) تكشف من لم يكتب بنفسه.</p></section>
  </div>`;
  $('#logoutBtn').addEventListener('click',logout);
  if(ang){$('#toGuide').addEventListener('click',()=>openGuide(st));$('#toModel').addEventListener('click',()=>openModel(st.sec,st.angle,'student'))}
  // prompts
  const list=$('#promptList'),note=$('#stageNote');
  function renderGroup(k){
    const g=D.promptGroups.find(x=>x.k===k);note.textContent=g.note;
    list.innerHTML=g.ids.map(id=>{const p=D.prompts[id];const txt=fillPrompt(p,ctx);const done=!!saved.p[id];
      return `<article class="prompt ${done?'done':''}" data-id="${id}"><div class="head"><h3><b>${id}</b>${esc(p.t)}</h3><button class="copy" type="button">نسخ الأمر</button></div><div class="body">${renderPromptHTML(txt,ctx)}</div><div class="foot"><label><input type="checkbox" ${done?'checked':''}> استعملته</label><span class="small muted">${id==1?'يُلصق أوّل كلّ محادثة':''}</span></div></article>`}).join('');
    list.querySelectorAll('.prompt').forEach(el=>{const id=el.dataset.id;const txt=fillPrompt(D.prompts[id],ctx);
      el.querySelector('.copy').addEventListener('click',e=>copyText(txt,e.currentTarget));
      el.querySelector('input').addEventListener('change',e=>{saved.p[id]=e.target.checked;el.classList.toggle('done',e.target.checked);store.set(key,saved)});});
  }
  studentEl.querySelectorAll('.stages button[data-g]').forEach(b=>b.addEventListener('click',()=>{studentEl.querySelectorAll('.stages button[data-g]').forEach(x=>x.setAttribute('aria-selected',x===b));renderGroup(b.dataset.g)}));
  renderGroup('start');
  // الأخطاء السبعة
  const bar=$('#sixBar');const upd=()=>{const n=Object.values(saved.c).filter(Boolean).length;bar.style.width=(n/D.sevenErrors.length*100)+'%'};upd();
  $('#sixList').addEventListener('change',e=>{const i=e.target.dataset.i;saved.c[i]=e.target.checked;e.target.closest('li').classList.toggle('on',e.target.checked);store.set(key,saved);upd()});
  // المئشار
  const rubList=$('#rubList'),rubBar=$('#rubBar'),rubScore=$('#rubScore');
  function renderRubric(stage){
    const items=D.rubric.filter(r=>r.stage===stage);const total=items.reduce((a,r)=>a+r.pts,0);
    rubList.innerHTML=items.map(r=>`<article class="prompt" style="margin-top:12px"><div class="head"><h3><b>${r.n}</b>${esc(r.title)}</h3><span class="tag">${r.pts} ${r.pts>10?'نقطة':'نقاط'}</span></div>${r.skills?`<p class="small muted" style="margin:0">في تقييمك يُنتبَه إلى: ${esc(r.skills)}</p>`:''}${r.warn?`<div class="warn">${esc(r.warn)}</div>`:''}<ul class="check">${r.items.map((it,i)=>{const k=r.n+'.'+i;return `<li class="${saved.r[k]?'on':''}"><label><input type="checkbox" data-k="${k}" data-p="${it[0]}" ${saved.r[k]?'checked':''}><span><b style="color:var(--red)">${it[0]}</b> · ${esc(it[1])}</span></label></li>`}).join('')}</ul></article>`).join('');
    const upd=()=>{let got=0;items.forEach(r=>r.items.forEach((it,i)=>{if(saved.r[r.n+'.'+i])got+=it[0]}));rubBar.style.width=(got/total*100)+'%';rubScore.textContent=`علّمتَ ما يساوي ${got} من ${total} نقطة في هذه المرحلة.`};upd();
    rubList.querySelectorAll('input').forEach(inp=>inp.addEventListener('change',e=>{saved.r[e.target.dataset.k]=e.target.checked;e.target.closest('li').classList.toggle('on',e.target.checked);store.set(key,saved);upd()}));
  }
  studentEl.querySelectorAll('[data-r]').forEach(b=>b.addEventListener('click',()=>{studentEl.querySelectorAll('[data-r]').forEach(x=>x.setAttribute('aria-selected',x===b));renderRubric(b.dataset.r)}));
  renderRubric('2');
  showOnly(studentEl);
}

/* ---------- صفحة «حلّ وظيفتي بحسب المئشار» ---------- */
// لكلّ خطوة في دليل الزاوية: أرقام الأوامر الملائمة من بنك الأوامر.
const GUIDE_PROMPTS={
  b1:[[10],[14],[11,15],[9],[7,8],[22]],
  b2:[[12],[13],[9],[7,8]],
  b3:[[18],[20],[24],[19],[21]],
  b8:[[26],[28],[28],[27]],
};
function openGuide(st){
  const sec=D.sections[st.sec];const ang=angleOf(st.sec,st.angle);const g=ang.guide;
  const ctx={topic:sec.topic,angle:ang.angle,item:ang.item};
  const rub=n=>D.rubric.find(r=>r.n===n);
  const stepHTML=(txt,ids,uid)=>{
    const btns=ids.map(id=>`<button class="copy" type="button" data-p="${id}" data-box="${uid}-${id}">انسخ الأمر المناسب — ${id}: ${esc(D.prompts[id].t)}</button>`).join('');
    const boxes=ids.map(id=>`<div class="pbox" id="pb-${uid}-${id}">${renderPromptHTML(fillPrompt(D.prompts[id],ctx),ctx)}</div>`).join('');
    return `<div class="gstep"><div class="txt">${esc(txt)}</div><div class="acts">${btns}</div>${boxes}</div>`;
  };
  const itemHTML=(n,steps,map,pre)=>{
    const r=rub(n);
    return `<div class="gitem"><h3><span class="num">${n}</span><span>${esc(r.title)}</span><span class="tag ${r.stage==='2'?'blue':'red'}">المرحلة ${r.stage} · ${r.pts} ${r.pts>10?'نقطة':'نقاط'}</span></h3>
    ${steps.map((s,i)=>stepHTML(s,map[i],pre+'-'+i)).join('')}</div>`;
  };
  let inner='';
  inner+=itemHTML(1,g.b1.steps,GUIDE_PROMPTS.b1,'b1');
  inner+=itemHTML(2,g.b2.steps,GUIDE_PROMPTS.b2,'b2');
  for(let n=3;n<=7;n++){inner+=itemHTML(n,[g.b3.steps[n-3]],[GUIDE_PROMPTS.b3[n-3]],'b3'+n)}
  inner+=itemHTML(8,g.b8.steps,GUIDE_PROMPTS.b8,'b8');
  guideEl.innerHTML=`
  <div class="who"><div><div class="name">${esc(st.name)}</div><div class="sub">حلّ وظيفتي بحسب المئشار · ${sec.name} · وظيفة ${ang.n}</div></div>
  <div style="display:flex;gap:8px"><button class="btn ghost small" id="backBtn" type="button">رجوع إلى صفحتي</button><button class="btn ghost small" id="gLogout" type="button">خروج</button></div></div>
  <div class="stack">
    <section class="card">
      <div class="kicker">زاويتك</div>
      <div class="angle">${esc(ang.angle)}</div>
      <p class="small muted" style="margin:0">هذه الصفحة توجّهك وتسألك ولا تكتب عنك شيئًا: لا مقالة ولا عنوانًا ولا «كلمة المحرّر». النصّ بلغتك أنت — هذا بند يُقاس في كلّ جزء من المئشار.</p>
      <div class="gfirst"><h3>قبل كلّ شيء — الأمر 1: تعريف الدور</h3>
        <p class="small" style="margin:0 0 8px">الصقه في بداية كلّ محادثة جديدة مع الذكاء الاصطناعيّ، قبل أيّ أمر آخر. هو مملوء بزاويتك وعنقودك.</p>
        <div class="pbox open" style="background:var(--paper);border-radius:8px;padding:10px 12px">${renderPromptHTML(fillPrompt(D.prompts[1],ctx),ctx)}</div>
        <div class="acts" style="margin-top:8px"><button class="copy" type="button" id="copyP1">نسخ الأمر 1</button></div>
      </div>
      <div style="margin-top:14px">${inner}</div>
    </section>
  </div>`;
  $('#backBtn').addEventListener('click',()=>showOnly(studentEl));
  $('#gLogout').addEventListener('click',logout);
  $('#copyP1').addEventListener('click',e=>copyText(fillPrompt(D.prompts[1],ctx),e.currentTarget));
  guideEl.querySelectorAll('.gstep .copy').forEach(b=>b.addEventListener('click',e=>{
    const box=$('#pb-'+b.dataset.box,guideEl);
    guideEl.querySelectorAll('.gstep .pbox.open').forEach(x=>{if(x!==box)x.classList.remove('open')});
    box.classList.add('open');
    copyText(fillPrompt(D.prompts[b.dataset.p],ctx),e.currentTarget);
  }));
  showOnly(guideEl);
}

/* ---------- الجريدة النموذجية ---------- */
async function loadModels(){
  if(MODELS)return MODELS;
  const r=await fetch('assets/models.json');
  if(!r.ok)throw new Error('HTTP '+r.status);
  MODELS=await r.json();return MODELS;
}
function markTerms(text,terms){
  let h=esc(text);
  (terms||[]).filter(Boolean).forEach(t=>{const e=esc(t);h=h.split(e).join('<mark class="term">'+e+'</mark>')});
  return h.replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');
}
async function openModel(sec,n,back){
  let m;
  try{m=(await loadModels())[sec]&&(await loadModels())[sec][n]}catch(e){alert('تعذّر تحميل النماذج؛ أعد تحميل الصفحة.');return}
  if(!m){alert('لا نموذج لهذه الزاوية بعد.');return}
  const ang=angleOf(sec,n);const sec_=D.sections[sec];
  const refList=refs=>`<p class="mrefs">المراجع: ${refs.map(esc).join(' · ')}</p>`;
  modelEl.innerHTML=`
  <div class="who noprint"><div><div class="name">الجريدة النموذجية — وظيفة ${n} · ${sec_.name}</div><div class="sub">مثال كامل بحسب المئشار على زاويتك — للتعلّم لا للنسخ</div></div>
  <div style="display:flex;gap:8px"><button class="btn ghost small" id="mPrint" type="button">طباعة</button><button class="btn ghost small" id="mBack" type="button">رجوع</button></div></div>
  <div class="warn noprint" style="margin-top:14px"><b>هذه الجريدة كتبها الذكاء الاصطناعيّ بطلب المعلّم لتريك الشكل النهائيّ المطلوب.</b> ممنوع نسخ أيّ جملة منها: المئشار يشترط نصًّا مستقلًّا بلغتك أنت في كلّ جزء، والمردودية الصوتية (20 نقطة) تكشف من لم يكتب بنفسه. المصطلحات المدمجة مظلَّلة لتري كيف تُدمج في الجمل لا في قائمة.</div>
  <article class="modelpaper">
    <header class="mhead">
      <div class="mdate"><span class="tag blue noprint">تاريخ الإصدار — من البند 1</span><br>${esc(m.issueDate)}</div>
      <h2 class="mname">${esc(m.paperName)}</h2>
      <div class="mslogan">جريدة شخصية · ${esc(sec_.topic)}</div>
    </header>
    <div class="mtitles">
      <span class="tag red noprint">البند 5 — العناوين (10 نقاط مع البصريّ)</span>
      <h3 class="mmain">${esc(m.mainTitle)}</h3>
      <p class="msub">${esc(m.subTitle)}</p>
    </div>
    <figure class="mvisual">
      <div class="mframe"><span>المركّب البصريّ</span>${esc(m.visual.what)}</div>
      <figcaption>${esc(m.visual.caption)}<br><b>المصدر:</b> ${esc(m.visual.source)}${m.visual.url?` — <a href="${/^https?:/.test(m.visual.url)?esc(m.visual.url):'https://'+esc(m.visual.url)}" target="_blank" rel="noopener">${esc(m.visual.url)}</a>`:''}</figcaption>
    </figure>
    <section class="msec">
      <span class="tag red noprint">التقرير الإخباريّ المركزيّ — البندان 1 و3</span>
      <div class="mtext"><p>${markTerms(m.central.text,m.terms.central)}</p></div>
      ${refList(m.central.refs)}
    </section>
    <section class="msec alt">
      <span class="tag blue noprint">التقرير الثانويّ (${esc(m.secondary.type)}) — البنود 2 و6 و7</span>
      <h4 class="mh4">${esc(m.secondary.title)}</h4>
      ${m.secondary.fictionNote?'<p class="mfiction">مقابلة متخيَّلة مع شخصية تاريخية متوفّاة؛ الأجوبة مبنية على مواقفها الموثَّقة، وليست نصًّا حرفيًّا.</p>':''}
      <div class="mtext"><p>${markTerms(m.secondary.text,[m.terms.secondary])}</p></div>
      ${refList([m.secondary.ref])}
    </section>
    <section class="msec editor">
      <span class="tag amber noprint">كلمة المحرّر — البند 4</span>
      <h4 class="mh4">${esc(m.editor.title)}</h4>
      <div class="mtext"><p>${markTerms(m.editor.text,[m.terms.editor])}</p></div>
    </section>
    <footer class="mfoot">نموذج تعليميّ أُعدّ بالذكاء الاصطناعيّ بطلب المعلّم · الجريدة الشخصية 23222 · زاوية ${n} — ${sec_.name}</footer>
  </article>`;
  $('#mBack').addEventListener('click',()=>{showOnly(back==='teacher'?teacherEl:studentEl)});
  $('#mPrint').addEventListener('click',()=>window.print());
  showOnly(modelEl);
}

/* ---------- لوحة المعلّم ---------- */
function openTeacher(T){
  const secs=[1,2,3,4];
  teacherEl.innerHTML=`<div class="who"><div><div class="name">لوحة المعلّم</div><div class="sub">رموز الدخول وتوزيع الزوايا · ${T.students.length} طالبًا في أربع شعب</div></div><button class="btn ghost small" id="tLogout" type="button">خروج</button></div>
  <div class="stack"><section class="card"><div class="tabs" role="tablist">${secs.map((s,i)=>`<button role="tab" aria-selected="${i===0}" data-s="${s}">${D.sections[s].name} · ${T.students.filter(x=>x.sec===s).length}</button>`).join('')}</div>
  <div id="tBody"></div></section>
  <section class="card"><div class="kicker">كيف يعمل · ملاحظات للحسم</div><ul style="margin:0;padding-right:18px;font-size:15px"><li>أعطِ كلّ طالب رمزه الشخصيّ (أربعة أرقام). يدخل به فيرى موضوع شعبته وزاويته ومصادرها وأوامر الذكاء الاصطناعي المملوءة له، وصفحة «حلّ وظيفتي بحسب المئشار».</li><li>رمز المعلّم يفتح هذه اللوحة. أسماء الطلاب ورموزهم مشفَّرة داخل ملف البيانات المنشور؛ لا يفكّ سجلّ طالب إلّا من يملك رمزه، ولا هذه اللوحة إلّا من يملك رمز المعلّم.</li><li>الزوايا المعلَّمة بـ«مقترحة» وزّعها المساعد على من لم يكن له زاوية في الملفات، بترتيب السجلّ؛ تُثبَّت بتوقيع الطالب على ورقته أو تُبدَّل.</li>${T.flags.map(f=>`<li>${esc(f)}</li>`).join('')}<li>ما يضعه الطالب من علامات («استعملته»، بنود المئشار، الأخطاء السبعة) يُحفَظ على جهازه هو فقط.</li><li>النقاط في الموقع بحسب المئشار المحدَّث 1.9.2026: المرحلة 2 (البندان 1-2) = 30، المرحلة 3 (البنود 3-8) = 70. محطّة المسوّدة (29/11 و01/12) محطّة داخلية بلا بند خاصّ بها.</li></ul></section></div>`;
  $('#tLogout').addEventListener('click',logout);
  const body=$('#tBody');
  function show(s){const sec=D.sections[s];const sts=T.students.filter(x=>x.sec===s);
    const rows=sts.map(st=>{const a=st.angle?angleOf(st.sec,st.angle):null;return `<tr><td>${st.n}</td><td>${esc(st.name)}${st.ar?`<div class="small muted">${esc(st.ar)}</div>`:''}</td><td><span class="code">${st.code}</span></td><td>${a?`<b>${a.n}</b> ${st.prov?'<span class="tag amber">مقترحة</span>':''}${a.new?'<span class="tag blue">جديدة</span>':''} <button class="linkbtn mlink" type="button" data-sec="${st.sec}" data-n="${a.n}">النموذج</button><div class="small muted">${esc(a.angle)}</div>`:'<span class="tag">بلا زاوية</span>'}</td></tr>`}).join('');
    const used=new Set(sts.map(x=>x.angle).filter(Boolean));const free=(D.angles[s]||[]).filter(a=>!used.has(a.n));
    body.innerHTML=`<p class="small muted" style="margin:0 0 8px">${sec.name} · ${sec.day} ${sec.time} · ${esc(sec.topic)} · مقترحة بانتظار التثبيت: ${sts.filter(x=>x.prov).length} · بلا زاوية: ${sts.filter(x=>!x.angle).length}</p>
    <div class="tablewrap"><table><thead><tr><th>#</th><th>الطالب</th><th>الرمز</th><th>الزاوية</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="copy" id="copyCodes" type="button">نسخ قائمة الأسماء والرموز</button><button class="copy" id="csvBtn" type="button">تصدير CSV</button></div>
    ${free.length?`<h3 style="font-size:16px;margin:18px 0 6px">زوايا حرّة في ${sec.name} (${free.length})</h3><ul style="margin:0;padding-right:18px;font-size:15px">${free.map(a=>`<li><b>${a.n}</b> — ${esc(a.angle)} <button class="linkbtn mlink" type="button" data-sec="${s}" data-n="${a.n}">النموذج</button></li>`).join('')}</ul>`:''}`;
    body.querySelectorAll('.mlink').forEach(b=>b.addEventListener('click',()=>openModel(+b.dataset.sec,+b.dataset.n,'teacher')));
    $('#copyCodes').addEventListener('click',e=>copyText(sec.name+'\n'+sts.map(st=>`${st.n}\t${st.name}\t${st.code}\t${st.angle?('وظيفة '+st.angle):'—'}`).join('\n'),e.currentTarget));
    $('#csvBtn').addEventListener('click',()=>{
      const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
      const head=['الرقم في السجلّ','الاسم (سجلّ الحضور)','الاسم بالعربية','رمز الدخول','رقم الزاوية','نصّ الزاوية','الحالة'];
      const lines=sts.map(st=>{const a=st.angle?angleOf(st.sec,st.angle):null;
        return [st.n,st.name,st.ar||'',st.code,st.angle||'',a?a.angle:'',st.angle?(st.prov?'مقترحة':'مثبَّتة'):'بلا زاوية'].map(q).join(',')});
      const csv='﻿'+head.map(q).join(',')+'\n'+lines.join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
      const aEl=document.createElement('a');aEl.href=URL.createObjectURL(blob);aEl.download='codes-section-'+s+'.csv';
      document.body.appendChild(aEl);aEl.click();setTimeout(()=>{URL.revokeObjectURL(aEl.href);aEl.remove()},500);
    });
  }
  teacherEl.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>{teacherEl.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b));show(+b.dataset.s)}));
  show(1);showOnly(teacherEl);
}

/* ---------- الدخول والإقلاع ---------- */
async function handleLogin(v,err){
  const res=await tryCode(v);
  if(!res){err.textContent='الرمز غير صحيح. تأكّد من الأرقام الأربعة، أو اطلب رمزك من المعلّم.';$('#codeIn').select();return}
  if(res.teacher){openTeacher(res.teacher);return}
  store.set('jr23222:last',v);openStudent(res.student);
}
function initUI(){
  $('#todayLbl').textContent='اليوم '+new Date().toLocaleDateString('ar-EG-u-nu-latn',{weekday:'long',day:'numeric',month:'numeric',year:'numeric'});
  $('#loginForm').addEventListener('submit',async e=>{
    e.preventDefault();const v=$('#codeIn').value.trim();const err=$('#loginErr');err.textContent='';
    if(!v){err.textContent='اكتب الرمز أولًا.';return}
    const btn=$('#loginForm .btn');btn.disabled=true;btn.textContent='جارٍ الفحص…';
    try{await handleLogin(v,err)}catch(ex){
      err.textContent=(window.crypto&&crypto.subtle)
        ?'تعذّر الفحص على هذا المتصفّح؛ جرّب متصفّحًا أحدث.'
        :'افتح الموقع عبر الرابط الآمن https://'+location.host+' — فكّ التشفير لا يعمل على http. إن لم يفتح الرابط الآمن فجرّب بعد دقائق.';
    }
    btn.disabled=false;btn.textContent='دخول';
  });
  $('#toTeacher').addEventListener('click',()=>{$('#codeIn').value='';$('#codeIn').placeholder='رمز المعلّم';$('#codeIn').focus()});
}
(async function boot(){
  document.documentElement.setAttribute('dir','rtl');
  initUI();
  try{
    const r=await fetch('assets/data.json');
    if(!r.ok)throw new Error('HTTP '+r.status);
    D=await r.json();
  }catch(ex){$('#loginErr').textContent='تعذّر تحميل البيانات. أعد تحميل الصفحة، وإن تكرّر الخلل أخبر المعلّم.';return}
  const last=store.get('jr23222:last');
  if(last){try{const res=await tryCode(last);if(res&&res.student){openStudent(res.student);return}}catch(e){}store.del('jr23222:last')}
  $('#codeIn').focus();
})();
