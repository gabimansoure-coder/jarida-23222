'use strict';
/* الجريدة الشخصية 23222 — التطبيق.
   كلّ طالب له ملفّ مشفَّر واحد assets/k/<معرّف>.bin، المعرّف والمفتاح مشتقّان من رمزه،
   فلا يلزم تحميل شيء قبل الدخول، ولا يصل أحد إلى سجلّ غيره دون رمزه. */

const COMMON_URL='__COMMON_URL__';
const AUTH={salt:'23222',iter:150000};
const CODE_LENGTHS=[4,6];
const K_LAST='jr23222:last',K_REMEMBER='jr23222:remember',K_SESSION='jr23222:session';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const view=$('#view');
const LOGIN_HTML=$('#login').outerHTML;

const safe={
  get(st,k){try{return st.getItem(k)}catch(e){return null}},
  set(st,k,v){try{st.setItem(k,v)}catch(e){}},
  del(st,k){try{st.removeItem(k)}catch(e){}},
};
const local=()=>{try{return window.localStorage}catch(e){return null}};
const session=()=>{try{return window.sessionStorage}catch(e){return null}};
const lget=k=>{const s=local();return s?safe.get(s,k):null};
const lset=(k,v)=>{const s=local();if(s)safe.set(s,k,v)};
const ldel=k=>{const s=local();if(s)safe.del(s,k)};
const sget=k=>{const s=session();return s?safe.get(s,k):null};
const sset=(k,v)=>{const s=session();if(s)safe.set(s,k,v)};
const sdel=k=>{const s=session();if(s)safe.del(s,k)};

/* ---------- الرمز ---------- */
// لوحات المفاتيح العربية تكتب ٧٧٩٨ لا 7798، والنسخ قد يضيف فراغات أو علامات اتجاه خفيّة.
function normalizeCode(v){
  return String(v).replace(/[٠-٩]/g,d=>d.charCodeAt(0)-0x660).replace(/[۰-۹]/g,d=>d.charCodeAt(0)-0x6F0).replace(/\D/g,'');
}
async function deriveKey(code){
  const te=new TextEncoder();
  const km=await crypto.subtle.importKey('raw',te.encode(code),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:te.encode(AUTH.salt),iterations:AUTH.iter},km,384));
  const key=await crypto.subtle.importKey('raw',bits.slice(0,32),'AES-GCM',false,['decrypt']);
  return {key,id:[...bits.slice(32)].map(b=>b.toString(16).padStart(2,'0')).join('')};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// إعادة المحاولة عند انقطاع الشبكة فقط؛ 404 جواب نهائيّ يعني «لا ملفّ بهذا الرمز».
async function fetchRetry(url,timeoutMs=25000){
  let last;
  for(const wait of [0,700,1800]){
    if(wait)await sleep(wait);
    const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),timeoutMs);
    try{
      const r=await fetch(url,{signal:ctl.signal});
      if(r.status===404)return null;
      if(r.ok)return r;
      last=new Error('HTTP '+r.status);
    }catch(e){last=e}
    finally{clearTimeout(t)}
  }
  throw last;
}
async function openSealed(url,key){
  const r=await fetchRetry(url);
  if(!r)return null;
  const buf=new Uint8Array(await r.arrayBuffer());
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:buf.slice(0,12)},key,buf.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
let commonPromise=null;
function getCommon(){
  if(!commonPromise)commonPromise=fetchRetry(COMMON_URL).then(r=>{if(!r)throw new Error('common 404');return r.json()}).catch(e=>{commonPromise=null;throw e});
  return commonPromise;
}

/* ---------- الحالة ---------- */
let C=null;      // المحتوى العامّ: المئشار والأوامر والمراحل
let U=null;      // الطالب أو المعلّم بعد فكّ ملفّه
let KEY=null,KID=null;
let saved=null;  // تقدّم الطالب المحفوظ على جهازه
let TM=null,TP=null; // نماذج المعلّم ووظائف العرض (تُحمَّل عند الطلب)

/* ---------- التقدّم المحفوظ ---------- */
function progressKey(){return 'jr23222:v2:'+U.st.sec+'-'+U.st.n}
function loadProgress(code){
  const k=progressKey();
  let raw=lget(k);
  const oldK='jr23222:'+code;   // مفتاح النسخة القديمة: لا تضيع علامات الطالب
  const old=lget(oldK);
  if(!raw&&old)raw=old;
  if(old)ldel(oldK);
  let o={};try{o=JSON.parse(raw)||{}}catch(e){}
  saved={p:o.p||{},c:o.c||{},r:o.r||{},g:o.g||{}};
  if(raw)lset(k,JSON.stringify(saved));
}
const persist=()=>lset(progressKey(),JSON.stringify(saved));

/* ---------- أدوات العرض ---------- */
const NAME_HTML=st=>`<bdi lang="he">${esc(st.name)}</bdi>${st.ar?` — <bdi>${esc(st.ar)}</bdi>`:''}`;
function todayISO(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function daysUntil(iso){return Math.round((new Date(iso+'T00:00:00')-new Date(todayISO()+'T00:00:00'))/86400000)}
function fmtDays(d){if(d<0)return'انتهى';if(d===0)return'اليوم';if(d===1)return'غدًا';if(d===2)return'بعد يومين';if(d<=10)return'بعد '+d+' أيام';return'بعد '+d+' يومًا'}
const ptsLabel=n=>n+' '+(n>10?'نقطة':n>2?'نقاط':'نقطتان');
const host=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch(e){return u}};

function fillPrompt(p,ctx){
  return p.x.split('{{topic}}').join(ctx.topic).split('{{angle}}').join(ctx.angle).split('{{item}}').join(ctx.item?' البند في الميكود: '+ctx.item+'.':'');
}
function promptHTML(id,ctx){
  let h=esc(fillPrompt(C.prompts[id],ctx)).replace(/\[([^\]]*)\]/g,'<mark>[$1]</mark>');
  [ctx.angle,ctx.topic].forEach(t=>{if(t)h=h.split(esc(t)).join('<span class="fill">'+esc(t)+'</span>')});
  return h;
}
function promptCtx(){const s=U.sec,a=U.ang;return{topic:s.topic,angle:a.angle,item:a.item}}

function copyText(txt,btn){
  const old=btn.textContent;
  const done=ok=>{btn.textContent=ok?'نُسخ ✓':'حدّد/ي النصّ وانسخ/ي يدويًّا';btn.classList.toggle('ok',ok);setTimeout(()=>{btn.textContent=old;btn.classList.remove('ok')},1800)};
  const fallback=()=>{
    const ta=document.createElement('textarea');ta.value=txt;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;right:0;opacity:0';
    document.body.appendChild(ta);ta.focus();ta.setSelectionRange(0,txt.length);
    let ok=false;try{ok=document.execCommand('copy')}catch(e){}
    ta.remove();done(ok);
  };
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(()=>done(true),fallback);else fallback();
}

function setChrome(navItems){
  const who=$('#who'),nav=$('#nav');
  who.hidden=false;nav.hidden=false;document.body.classList.add('inapp');
  const isT=U.kind==='t';
  who.innerHTML=`<div><div class="name">${isT?'لوحة المعلّم':NAME_HTML(U.st)}</div><div class="sub">${isT?U.students.length+' طالبًا في أربع شعب':`<bdi>${esc(U.sec.name)}</bdi> · يوم ${esc(U.sec.day)} الساعة ${esc(U.sec.time)} · رقم ${U.st.n} في السجلّ`}</div></div><button class="btn" type="button" data-act="logout">خروج</button>`;
  nav.classList.toggle('tnav',isT);nav.style.setProperty('--n',navItems.length);
  nav.innerHTML=navItems.map(n=>`<a href="#/${n.r}" data-r="${n.r}">${n.b?`<b>${n.b}</b>`:''}${esc(n.l)}</a>`).join('');
}
function markNav(r){$$('#nav a').forEach(a=>{const on=a.dataset.r===r;if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')})}

/* ---------- الدخول والخروج ---------- */
function showLoginMsg(t,info){const m=$('#loginMsg');if(m){m.textContent=t;m.classList.toggle('info',!!info)}}
function bindLogin(){
  const form=$('#loginForm');
  form.onsubmit=e=>{e.preventDefault();submitLogin();return false};
}
async function submitLogin(){
  const input=$('#codeIn'),btn=$('#loginBtn');
  const code=normalizeCode(input.value);
  if(!code){showLoginMsg('أدخل/ي الرمز أوّلًا.');input.focus();return}
  if(!CODE_LENGTHS.includes(code.length)){showLoginMsg('الرمز أربعة أرقام، وكتبت '+code.length+'. قارن/ي بورقة الإرشاد.');input.focus();return}
  btn.disabled=true;btn.textContent='جارٍ الفتح…';showLoginMsg('');
  try{
    const res=await enter(code);
    if(res==='wrong'){showLoginMsg('الرمز غير صحيح. قارن/ي الأرقام بورقة الإرشاد، وإن استمرّ الخلل فاطلب/ي الرمز من المعلّم.');input.select();return}
    if($('#remember')&&$('#remember').checked&&U.kind==='s')lset(K_REMEMBER,code);
    sset(K_SESSION,code);
    route();
  }catch(e){
    showLoginMsg(!window.crypto||!crypto.subtle
      ?'هذا المتصفّح لا يستطيع فتح الصفحة. افتح/ي الرابط في Chrome أو Safari عبر https://jarida.gabimansour.com'
      :'لا اتصال بالموقع الآن. تأكّد/ي من الإنترنت ثمّ اضغط/ي «دخول» مرّة أخرى — الرمز ما زال في مكانه.');
  }finally{
    if(btn.isConnected){btn.disabled=false;btn.textContent='دخول'}
  }
}
// يعيد 'wrong' إن لم يوجد ملفّ بهذا الرمز، ويرمي خطأً عند انقطاع الشبكة.
async function enter(code){
  const {key,id}=await deriveKey(code);
  const [bundle,common]=await Promise.all([openSealed('assets/k/'+id+'.bin',key),getCommon()]);
  if(!bundle)return'wrong';
  C=common;U=bundle;KEY=key;KID=id;
  if(U.kind==='s'){
    loadProgress(code);
    setChrome([{r:'',b:'1',l:'صفحتي'},{r:'guide',b:'2',l:'حلّ الوظيفة'},{r:'model',b:'3',l:'النموذج'},{r:'prompts',b:'4',l:'الأوامر'},{r:'check',b:'5',l:'التقييم'},{r:'voice',b:'6',l:'المردودية'}]);
  }else{
    setChrome([{r:'t/1',l:'יב-1'},{r:'t/2',l:'יב-2'},{r:'t/3',l:'יב-3'},{r:'t/4',l:'יב-4'},{r:'t/pres',l:'العروض'},{r:'t/notes',l:'ملاحظات'}]);
  }
  return'ok';
}
function logout(){
  ldel(K_REMEMBER);sdel(K_SESSION);
  C=U=KEY=KID=saved=TM=TP=null;
  $('#who').hidden=true;$('#nav').hidden=true;$('#who').innerHTML='';$('#nav').innerHTML='';
  document.body.classList.remove('inapp');
  if(location.hash)history.replaceState(null,'',location.pathname);
  view.innerHTML=LOGIN_HTML;bindLogin();$('#codeIn').focus();window.scrollTo(0,0);
}

/* ---------- الصفحة الرئيسية للطالب ---------- */
function pageHome(){
  const {st,sec,ang,total}=U;
  const dl=C.stages.map((s,i)=>({s,i,iso:sec.iso[i],date:sec.dates[i],d:daysUntil(sec.iso[i])}));
  const next=dl.find(o=>o.d>=0);
  const stepCards=[
    ['guide','2','حلّ وظيفتي بحسب المئشار','البنود الثمانية خطوةً خطوة، وبجانب كلّ خطوة أمر الذكاء الاصطناعيّ الجاهز المملوء بزاويتك.'],
    ['model','3','الجريدة النموذجية لزاويتي','مثال كامل بحسب المئشار — للتعلّم من شكله فقط، والنسخ منه ممنوع ومكشوف.'],
    ['prompts','4','الأوامر الـ'+Object.keys(C.prompts).length,'تُستعمل بالترتيب، وتحقّق/ي من كلّ معلومة من المصادر قبل إدخالها جريدتك.'],
    ['check','5','قيّم/ي نفسك','قائمة المئشار (30+70) وقائمة «سبعة أخطاء تُسقط نقاطًا» قبل كلّ تسليم.'],
    ['voice','6','تدريب المردودية الصوتية','بعد التسليم النهائيّ: التسجيل بصوتك أنت وإلّا صفر في البند (20 نقطة).'],
  ].map(([r,n,t,d])=>`<a class="step" href="#/${r}"><span class="num">${n}</span><div><b>${t}</b><span>${d}</span></div></a>`).join('');
  const srcLi=x=>`<li><div class="t">${esc(x.t)}${x.add?' <span class="tag blue">أضافه المعلّم</span>':''}</div><a href="${esc(x.u)}" target="_blank" rel="noopener noreferrer">فتح المصدر ↗ <span class="muted">(${esc(host(x.u))})</span></a></li>`;
  return `
  ${next?`<div class="next"><b>القادم: ${esc(next.s.name.split(' — ')[0])} — ${next.date} — ${fmtDays(next.d)}</b></div>`:`<div class="next"><b>انتهت مواعيد التسليم</b></div>`}
  <section class="card"><div class="kicker">زاويتك</div>
    <div class="angle">${esc(ang.angle)}</div>
    <dl class="kv">
      <dt>رقم الوظيفة</dt><dd>${ang.n} من ${total}${st.prov?' <span class="tag amber">مقترحة من المعلّم — تُثبَّت بتوقيعك في ورقة الإرشاد أو تُبدَّل في الحصّة</span>':''}</dd>
      <dt>البند من الميكود</dt><dd>${esc(ang.item)}</dd>
      <dt>مفاهيم مقترحة</dt><dd>${esc(ang.concepts||'—')}</dd>
      <dt>نوع مقترح للتقرير الثانويّ</dt><dd>${esc(ang.subtype||'—')}</dd>
      <dt>اقتراح للمركّب البصريّ</dt><dd>${esc(ang.visual||'—')}</dd>
    </dl>
  </section>
  <h2 class="sr">خطوات عملك في الموقع</h2>
  <div class="steps">${stepCards}</div>
  <div class="grid2">
    <section class="card"><div class="kicker">مواعيد التسليم — <bdi>${esc(sec.name)}</bdi></div>
      <div class="tablewrap"><table><thead><tr><th>المرحلة</th><th>الموعد</th><th class="nowrap">النقاط</th></tr></thead><tbody>
      ${dl.map(o=>`<tr class="${next&&next.i===o.i?'isnext':o.d<0?'past':''}"><td><b>${esc(o.s.name)}</b><div class="small muted">${esc(o.s.what)}</div></td><td class="when">${o.date}<div class="small muted">${fmtDays(o.d)}</div></td><td class="nowrap">${esc(o.s.pts)}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="card"><div class="kicker">موضوع شعبتك</div><h2>${esc(sec.topic)}</h2>
      <ul class="plain">${sec.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>
      <div class="warn"><b>أربعة لا تُنسى:</b> النصّ كلّه مستقلّ وبلغتك أنت · المصطلحات مذكورة ومؤكَّدة ومدمجة داخل الجمل لا في قائمة · ثلاثة مصادر مختلفة غير كتاب التعليم، مصنَّفة وبمراجع بعد كلّ معلومة منقولة · ممنوع: ويكيبيديا والمدوّنات والنسخ من الذكاء الاصطناعيّ.</div>
    </section>
  </div>
  <section class="card" id="sources"><div class="kicker">المصادر</div><h2>مصادر زاويتك</h2>
    ${!ang.fromBank&&ang.sources.length<3?'<p class="small muted">لزاويتك '+(ang.sources.length===1?'مصدر واحد':'مصدران')+' خاصّ بها؛ أكمل/ي الثلاثة من بنك الشعبة أدناه.</p>':''}
    ${ang.fromBank?'<p class="small muted">لا مصدر خاصّ بهذه الزاوية؛ هذه الثلاثة من بنك الشعبة كما في ورقتك. اعرض/ي كلّ مصدر تضيفه على المعلّم قبل أن تبني عليه.</p>':''}
    <ul class="src">${ang.sources.map(srcLi).join('')}</ul>
    <details style="margin-top:10px" ${ang.sources.length<3?'open':''}><summary>بنك الشعبة كاملًا — ${sec.bank.length} مصدرًا</summary><ul class="src">${sec.bank.map(srcLi).join('')}</ul></details>
    ${sec.note?`<p class="small muted">${esc(sec.note)}</p>`:''}
    <div class="warn">افتح/ي كلّ رابط بنفسك؛ ما لا يُفتح لا يُستعمل. المطلوب مصدران مختلفان للتقرير المركزيّ ومصدر ثالث مختلف للتقرير الثانويّ، غير كتاب التعليم، مع تصنيف موثوقيّة كلّ مصدر وصلته.</div>
  </section>`;
}

/* ---------- حلّ الوظيفة بحسب المئشار ---------- */
// لكلّ خطوة في دليل الزاوية: أرقام الأوامر الملائمة لها.
const GUIDE_PROMPTS={b1:[[10],[14],[11,15],[9],[7,8],[22]],b2:[[12],[13],[9],[7,8]],b3:[[18],[20],[24],[19],[21]],b8:[[26],[28],[28],[27]]};
function pcard(id,opts={}){
  const ctx=promptCtx();const done=opts.track&&saved.p[id];
  return `<article class="pcard ${done?'done':''}" data-pid="${id}">
    <div class="phead"><h3><span class="pnum">${id}</span>${esc(C.prompts[id].t)}</h3><button class="copy" type="button" data-copy="${id}">نسخ</button></div>
    <details ${opts.open?'open':''}><summary class="small">عرض نصّ الأمر</summary><div class="ptext">${promptHTML(id,ctx)}</div></details>
    ${opts.track?`<div class="pfoot"><label class="tick"><input type="checkbox" data-p="${id}" ${done?'checked':''}> استعملته</label>${id==1?'<span class="muted">يُلصق أوّل كلّ محادثة</span>':''}</div>`:''}
  </article>`;
}
function pageGuide(){
  const g=U.ang.guide;const rub=n=>C.rubric.find(r=>r.n===n);
  const step=(txt,ids,uid)=>`<div class="gstep"><label class="tick"><input type="checkbox" data-g="${uid}" ${saved.g[uid]?'checked':''}> <span class="txt">${esc(txt)}</span></label><div class="gacts">${ids.map(id=>pcard(id)).join('')}</div></div>`;
  const band=(n,steps,map,pre)=>{const r=rub(n);return `<section class="band"><h2><span class="bnum">${n}</span><span>${esc(r.title)} <span class="tag ${r.stage==='2'?'blue':'red'}">المرحلة ${r.stage} · ${ptsLabel(r.pts)}</span></span></h2>${steps.map((s,i)=>step(s,map[i],pre+i)).join('')}</section>`};
  let h=band(1,g.b1.steps,GUIDE_PROMPTS.b1,'b1-')+band(2,g.b2.steps,GUIDE_PROMPTS.b2,'b2-');
  for(let n=3;n<=7;n++)h+=band(n,[g.b3.steps[n-3]],[GUIDE_PROMPTS.b3[n-3]],'b'+n+'-');
  h+=band(8,g.b8.steps,GUIDE_PROMPTS.b8,'b8-');
  return `<div class="pagehead"><h1>حلّ وظيفتي بحسب المئشار</h1><p>هذه الصفحة توجّهك وتسألك ولا تكتب عنك: لا مقالة ولا عنوانًا ولا «كلمة المحرّر». النصّ بلغتك أنت — وهذا يُقاس في كلّ بند.</p></div>
  <section class="card"><div class="kicker">زاويتك</div><div class="angle">${esc(U.ang.angle)}</div>
    <div class="first"><b>قبل كلّ شيء — الأمر 1:</b> الصقه في بداية كلّ محادثة جديدة مع الذكاء الاصطناعيّ، قبل أيّ أمر آخر.${pcard(1,{open:true})}</div>
  </section>${h}`;
}

/* ---------- الأوامر ---------- */
let promptGroup='start';
function promptGroupHTML(){
  const g=C.promptGroups.find(x=>x.k===promptGroup);
  return `<p class="small muted">${esc(g.note)}</p>${g.ids.map(id=>pcard(id,{track:true})).join('')}`;
}
function pagePrompts(){
  const total=Object.keys(C.prompts).length;const used=Object.values(saved.p).filter(Boolean).length;
  return `<div class="pagehead"><h1>أوامرك الجاهزة — ${total} أمرًا</h1><p>اضغط/ي «نسخ» ثمّ الصق/ي الأمر في الذكاء الاصطناعيّ. ما بين [قوسين] تعبئته عليك؛ وما هو مظلَّل بالأزرق مُلئ لك من ورقتك.</p></div>
  <section class="card">
    <div class="small muted" id="usedLbl">استعملت ${used} من ${total}</div>
    <div class="tabs" role="tablist">${C.promptGroups.map(g=>`<button type="button" role="tab" data-group="${g.k}" aria-selected="${g.k===promptGroup}">${esc(g.label)}</button>`).join('')}</div>
    <div id="promptList">${promptGroupHTML()}</div>
  </section>
  <section class="card"><div class="kicker">القواعد</div><h2>الذكاء الاصطناعيّ في الجريدة</h2><div class="rules">
    <div class="ok"><h3>مسموح</h3><ul class="plain"><li>طلب اقتراح مصادر ثمّ التحقّق منها بنفسك</li><li>العصف الذهنيّ لصياغة الديلما</li><li>شرح مفهوم ثمّ التحقّق منه</li><li>الامتحان الذاتيّ قبل المردودية</li><li>تحسين صياغة جملة كتبتها أنت</li></ul></div>
    <div class="no"><h3>ممنوع</h3><ul class="plain"><li>نسخ نصّ منه</li><li>ذكره مصدرًا</li><li>الاعتماد على معلومة بلا تحقّق</li><li>كتابة «كلمة المحرّر»</li><li>ويكيبيديا والمدوّنات والمواقع المجهولة</li></ul></div>
  </div></section>`;
}

/* ---------- التقييم الذاتيّ ---------- */
let rubricStage='2';
function rubricHTML(){
  const items=C.rubric.filter(r=>r.stage===rubricStage);
  return items.map(r=>`<article class="pcard"><div class="phead"><h3><span class="pnum">${r.n}</span>${esc(r.title)}</h3><span class="tag">${ptsLabel(r.pts)}</span></div>
    ${r.skills?`<p class="small muted" style="margin:6px 0 0">يُنتبَه في تقييمك إلى: ${esc(r.skills)}</p>`:''}${r.warn?`<div class="warn red">${esc(r.warn)}</div>`:''}
    <ul class="check">${r.items.map((it,i)=>{const k=r.n+'.'+i;const on=!!saved.r[k];return `<li class="${on?'on':''}"><label><input type="checkbox" data-r="${k}" ${on?'checked':''}><span class="pts">${it[0]}</span><span class="tx">${esc(it[1])}</span></label></li>`}).join('')}</ul></article>`).join('');
}
function rubricScore(){
  const items=C.rubric.filter(r=>r.stage===rubricStage);
  const total=items.reduce((a,r)=>a+r.pts,0);let got=0;
  items.forEach(r=>r.items.forEach((it,i)=>{if(saved.r[r.n+'.'+i])got+=it[0]}));
  const bar=$('#rubBar'),lbl=$('#rubScore');
  if(bar)bar.style.width=(got/total*100)+'%';
  if(lbl)lbl.textContent=`علّمتَ ما يساوي ${got} من ${total} نقطة في هذه المرحلة.`;
}
function errorsScore(){
  const n=Object.values(saved.c).filter(Boolean).length;
  const bar=$('#errBar');if(bar)bar.style.width=(n/C.sevenErrors.length*100)+'%';
}
function pageCheck(){
  return `<div class="pagehead"><h1>قيّم/ي نفسك قبل أن يقيّمك غيرك</h1><p>المئشار الرسميّ — تحديث ${esc(C.meta.rubricDate)}: ثمانية بنود، 100 نقطة. المجموع يُحسب على جهازك فقط ولا يراه أحد.</p></div>
  <section class="card">
    <p class="small muted" style="margin-top:0">«العنقود» في المئشار هو موضوع شعبتك، و«التقرير الإخباريّ المركزيّ» هو مقالتك المركزية، و«التقرير الثانويّ» هو مقالتك الفرعية.</p>
    <div class="tabs" role="tablist"><button type="button" role="tab" data-stage="2" aria-selected="${rubricStage==='2'}">المرحلة 2 — 30 نقطة</button><button type="button" role="tab" data-stage="3" aria-selected="${rubricStage==='3'}">المرحلة 3 — 70 نقطة</button></div>
    <div class="progress"><i id="rubBar"></i></div><p class="small" id="rubScore" style="margin:0"></p>
    <div id="rubList">${rubricHTML()}</div>
  </section>
  <section class="card"><div class="kicker">قبل أن تسلّم</div><h2>سبعة أخطاء تُسقط نقاطًا</h2>
    <div class="progress"><i id="errBar"></i></div>
    <ul class="check">${C.sevenErrors.map((s,i)=>`<li class="${saved.c[i]?'on':''}"><label><input type="checkbox" data-c="${i}" ${saved.c[i]?'checked':''}><span class="tx">${esc(s)}</span></label></li>`).join('')}</ul>
  </section>`;
}

/* ---------- تدريب المردودية ---------- */
function pageVoice(){
  const r=C.rubric.find(x=>x.n===8);
  return `<div class="pagehead"><h1>تدريب المردودية الصوتية</h1><p>البند 8 — 20 نقطة. تبدأ بعد التسليم النهائيّ، ولك 72 ساعة لبدئها.</p></div>
  <div class="warn red"><b>بصوتك أنت.</b> ${esc(r.warn)}</div>
  <section class="card"><div class="kicker">قبل التسجيل</div><h2>أجب/أجيبي شفويًّا، من فهمك، دون قراءة</h2>
    <ol class="plain" style="padding-right:22px">
      <li><b>المعرفة والفهم (10):</b> ما زاويتك ولماذا اخترتها؟ ما أقسام جريدتك الثلاثة وماذا يقول كلّ قسم؟ ما المعضلة في «${esc(U.ang.angle)}» وما جوابك عنها؟</li>
      <li><b>المصطلحات (2):</b> اشرح/ي بكلماتك كلّ مصطلح استعملته${U.ang.concepts?` (من المقترحة لك: ${esc(U.ang.concepts)})`:''}: أين ظهر في جريدتك، وكيف خدم زاويتك؟</li>
      <li><b>المصادر (2):</b> لكلّ مصدر استعملته: من أصدره ومتى؟ لماذا رأيته موثوقًا (أوّليّ أم ثانويّ؟ من كتبه ولمن؟)؟ وماذا أخذت منه بالضبط؟</li>
      <li><b>التأمّل في المسار (6):</b> ماذا خطّطت وماذا نفّذت فعلًا؟ أين تعثّرت وكيف واجهت ذلك؟ ماذا كنت ستغيّر لو بدأت من جديد؟ وكيف استعملت الذكاء الاصطناعيّ بشكل نقديّ ومسؤول — ما الذي رفضته من إجاباته ولماذا؟</li>
    </ol>
    <p class="small muted">الأجوبة عن جريدتك أنت لا عن الجريدة النموذجية.</p>
  </section>
  <section class="card"><div class="kicker">تدرّب مع الذكاء الاصطناعيّ</div><h2>الأوامر المناسبة</h2>${[26,27,28].map(id=>pcard(id)).join('')}</section>
  <section class="card"><div class="kicker">كيف يقيَّم البند</div><ul class="check">${r.items.map(it=>`<li><label style="cursor:default"><span class="pts">${it[0]}</span><span class="tx">${esc(it[1])}</span></label></li>`).join('')}</ul></section>`;
}

/* ---------- الجريدة النموذجية ---------- */
function markTerms(text,terms){
  let h=esc(text);
  (terms||[]).filter(Boolean).forEach(t=>{const e=esc(t);h=h.split(e).join('<mark>'+e+'</mark>')});
  return '<p>'+h.replace(/\n\s*\n/g,'</p><p>').replace(/\n/g,'<br>')+'</p>';
}
const apa=s=>esc(s).replace(/\*([^*]+)\*/g,'<i>$1</i>');
function visualHTML(m,im){
  const frame=`<div class="frame"><div><b>المركّب البصريّ</b><br>${esc(m.visual.what)}</div></div>`;
  if(im)return `<figure><img src="assets/img/${esc(im.file)}" alt="${esc(im.what)}" loading="lazy" data-fallback="1">
    <figcaption>${esc(im.what)}<br><b>المصدر:</b> ${esc(im.author)}${im.date?'، '+esc(im.date):''} — ${esc(im.sourceLabel||'ويكيميديا كومنز')} (${esc(im.license)}) — <a href="${esc(im.sourcePage)}" target="_blank" rel="noopener noreferrer">صفحة الصورة ↗</a><br>${esc(m.visual.caption)}</figcaption></figure>`;
  const u=m.visual.url?(/^https?:/.test(m.visual.url)?m.visual.url:'https://'+m.visual.url):'';
  return `<figure>${frame}<figcaption>${esc(m.visual.caption)}<br><b>المصدر:</b> ${esc(m.visual.source)}${u?` — <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">فتح ↗</a>`:''}</figcaption></figure>`;
}
function paperHTML(m,im,topic,footer){
  const refs=rs=>`<p class="refs">المراجع:<br>${rs.map(apa).join('<br>')}</p>`;
  return `<article class="paper">
    <header class="pmast"><div class="d">${esc(m.issueDate)}</div><h2>${esc(m.paperName)}</h2><div class="d">جريدة شخصية · ${esc(topic)}</div></header>
    <span class="tag red noprint" style="margin-top:12px">البند 5 — العناوين</span>
    <h3 class="pmain">${esc(m.mainTitle)}</h3><p class="psub">${esc(m.subTitle)}</p>
    ${visualHTML(m,im)}
    <section class="psec"><span class="tag red noprint">التقرير الإخباريّ المركزيّ — البندان 1 و3</span><div class="ptxt">${markTerms(m.central.text,m.terms.central)}</div>${refs(m.central.refs)}</section>
    <section class="psec"><span class="tag blue noprint">التقرير الثانويّ (${esc(m.secondary.type)}) — البنود 2 و6 و7</span><h3>${esc(m.secondary.title)}</h3>
      ${m.secondary.fictionNote?'<p class="fiction">مقابلة متخيَّلة مع شخصية تاريخية متوفّاة؛ الأجوبة مبنية على مواقفها الموثَّقة، وليست نصًّا حرفيًّا.</p>':''}
      <div class="ptxt">${markTerms(m.secondary.text,[m.terms.secondary])}</div>${refs([m.secondary.ref])}</section>
    <section class="psec"><span class="tag amber noprint">كلمة المحرّر — البند 4</span><h3>${esc(m.editor.title)}</h3><div class="ptxt">${markTerms(m.editor.text,[m.terms.editor])}</div></section>
    ${m.sourcesEval?`<section class="psec"><span class="tag blue noprint">تصنيف المصادر وصلتها — البندان 1 و2</span><h3>المصادر الثلاثة: التصنيف والموثوقيّة والصلة</h3><ul class="eval">${m.sourcesEval.map(e=>`<li><b>${esc(e.src)}</b><br>${esc(e.type)} · موثوقيّة ${esc(e.rel)} — ${esc(e.why)} ${esc(e.fit)}</li>`).join('')}</ul></section>`:''}
    <p class="small muted" style="text-align:center;margin:16px 0 0">${esc(footer)}</p>
  </article>`;
}
const COPY_WARNING='<div class="warn red"><b>ممنوع نسخ هذه المادّة.</b> هي مثال مساعد لفهم المهمّة فقط؛ نصّك يجب أن يكون مستقلًّا وبلغتك أنت، والمردودية الصوتية تكشف من لم يكتب بنفسه. المصطلحات المدمجة مظلَّلة — هكذا تُدمج في الجمل لا في قائمة.</div>';
function pageModel(){
  return `<div class="pagehead noprint"><h1>الجريدة النموذجية لزاويتي</h1><p>مثال كامل بحسب المئشار — وظيفة ${U.ang.n} · <bdi>${esc(U.sec.name)}</bdi></p></div>
  <div class="row noprint"><button class="btn" type="button" data-act="print">طباعة</button><a class="btn" href="#/voice">تدريب المردودية</a></div>
  <div class="noprint">${COPY_WARNING}</div>
  ${paperHTML(U.model,U.img,U.sec.topic,'نموذج مساعد لفهم المهمّة — ممنوع النسخ · زاوية '+U.ang.n+' — '+U.sec.name)}`;
}

/* ---------- لوحة المعلّم ---------- */
const secName=s=>U.sections[s].name;
const tAngle=(s,n)=>U.angles[s].find(a=>a.n===n);
function studentRow(st){
  const a=tAngle(st.sec,st.angle);
  return `<tr data-search="${esc((st.name+' '+(st.ar||'')+' '+st.code).toLowerCase())}"><td>${st.n}</td><td class="tname"><bdi lang="he">${esc(st.name)}</bdi>${st.ar?`<small><bdi>${esc(st.ar)}</bdi></small>`:''}</td><td><span class="code">${esc(st.code)}</span></td>
    <td>${a?`<b>${a.n}</b> ${st.prov?'<span class="tag amber">مقترحة</span>':'<span class="tag green">مثبَّتة</span>'}<div class="small">${esc(a.angle)}</div>`:'—'}</td><td><a class="linkbtn" href="#/t/model/${st.sec}/${st.angle}">النموذج</a></td></tr>`;
}
function pageTeacherSection(s){
  const sec=U.sections[s];const sts=U.students.filter(x=>x.sec===s);
  const used=new Set(sts.map(x=>x.angle));const free=U.angles[s].filter(a=>!used.has(a.n));
  return `<section class="card"><div class="kicker"><bdi>${esc(sec.name)}</bdi> · يوم ${esc(sec.day)} ${esc(sec.time)}</div><h2>${esc(sec.topic)}</h2>
    <p class="small muted" style="margin-top:0">${sts.length} طالبًا · مقترحة بانتظار التثبيت: ${sts.filter(x=>x.prov).length} · المواعيد: ${sec.dates.join(' · ')}</p>
    <input class="search" type="search" id="tSearch" placeholder="بحث باسم أو رمز في هذه الشعبة" aria-label="بحث">
    <div class="tablewrap"><table><thead><tr><th>#</th><th>الطالب</th><th>الرمز</th><th>الزاوية</th><th></th></tr></thead><tbody id="tRows">${sts.map(studentRow).join('')}</tbody></table></div>
    <div class="row"><button class="copy" type="button" data-act="copylist" data-sec="${s}">نسخ الأسماء والرموز</button><button class="copy" type="button" data-act="csv" data-sec="${s}">تصدير CSV</button></div>
  </section>
  ${free.length?`<section class="card"><div class="kicker">زوايا حرّة</div><h2>${free.length} زوايا بلا طالب في <bdi>${esc(sec.name)}</bdi></h2><ul class="plain">${free.map(a=>`<li><b>${a.n}</b> — ${esc(a.angle)} <a class="linkbtn" href="#/t/model/${s}/${a.n}">النموذج</a></li>`).join('')}</ul></section>`:''}`;
}
function pageTeacherNotes(){
  return `<section class="card"><div class="kicker">ملاحظات للحسم</div><h2>نقاط تنتظر قرار المعلّم</h2><ul class="plain">${U.flags.map(f=>`<li>${esc(f)}</li>`).join('')}</ul></section>
  <section class="card"><div class="kicker">كيف يعمل</div><ul class="plain">
    <li>كلّ طالب يدخل برمزه من ورقة الإرشاد، ويقبل الموقع الأرقام العربية والإنجليزية.</li>
    <li>علامات التقييم الذاتيّ تبقى على جهاز الطالب ولا تصل إلى المعلّم.</li>
    <li>تعديل زاوية أو رمز أو مصدر يكون في الملفّ الخامّ داخل مجلّد المشروع ثمّ أمر النشر؛ التفاصيل في README.</li>
  </ul></section>`;
}
async function teacherSealed(suffix){
  const v=await openSealed('assets/k/'+KID+suffix+'.bin',KEY);
  if(!v)throw new Error('missing '+suffix);
  return v;
}
async function loadTeacherModels(){if(!TM)TM=await teacherSealed('-m');return TM}
async function loadTeacherPres(){if(!TP)TP=await teacherSealed('-p');return TP}
async function pageTeacherModel(s,n){
  const {models,imgs}=await loadTeacherModels();
  const m=models[s]&&models[s][n];
  if(!m)return `<div class="fatal">لا نموذج لهذه الزاوية.</div>`;
  const im=imgs[s]&&imgs[s][n];const sec=U.sections[s];
  return `<div class="pagehead noprint"><h1>النموذج — وظيفة ${n} · <bdi>${esc(sec.name)}</bdi></h1><p>${esc(tAngle(+s,+n).angle)}</p></div>
  <div class="row noprint"><button class="btn" type="button" data-act="print">طباعة</button><a class="btn" href="#/t/${s}">رجوع إلى الشعبة</a></div>
  ${paperHTML(m,im,sec.topic,'نموذج مساعد لفهم المهمّة — ممنوع النسخ · زاوية '+n+' — '+sec.name)}`;
}
async function pageTeacherPres(){
  const P=await loadTeacherPres();
  return `<section class="card"><div class="kicker">العروض الشخصية</div><h2>${P.items.length} وظيفة عرض شخصيّ — بحسب مئشار العرض (تحديث ${esc(P.update)})</h2>
    ${[1,2,3,4].map(c=>`<h3 style="margin:14px 0 4px;font-size:16px"><bdi>${esc(secName(c))}</bdi> — ${esc(U.sections[c].topic)}</h3><ul class="plain">${P.items.filter(x=>x.cluster===c).map(p=>`<li><b>${esc(p.id)}</b> — ${esc(p.name)} · <a class="linkbtn" href="#/t/pres/${encodeURIComponent(p.id)}">فتح الوظيفة</a></li>`).join('')}</ul>`).join('')}
  </section>`;
}
async function pageTeacherPresItem(id){
  const P=await loadTeacherPres();const p=P.items.find(x=>String(x.id)===id);
  if(!p)return `<div class="fatal">الوظيفة غير موجودة.</div>`;
  const li=(e)=>`<li><b>${esc(e.src)}</b><br>${esc(e.type)} · موثوقيّة ${esc(e.rel)} — ${esc(e.why)} ${esc(e.fit)}</li>`;
  return `<div class="pagehead noprint"><h1>عرض شخصيّ — وظيفة ${esc(p.id)}</h1><p>العنقود ${p.cluster}: ${esc(U.sections[p.cluster].topic)}</p></div>
  <div class="row noprint"><button class="btn" type="button" data-act="print">طباعة</button><a class="btn" href="#/t/pres">رجوع إلى القائمة</a></div>
  <div class="noprint">${COPY_WARNING}</div>
  <article class="paper"><header class="pmast"><h2>${esc(p.name)}</h2><div class="d">عرض شخصيّ · ${esc(U.sections[p.cluster].topic)}</div></header>
    <section class="psec"><span class="tag red noprint">الموضوع والوصف — البندان 1 و3</span><h3>${esc(p.topic)}</h3><div class="ptxt">${markTerms(p.desc,p.terms.main)}</div></section>
    <section class="psec"><span class="tag blue noprint">الجانب والتفسير الشخصيّ — البندان 2 و6</span><h3>${esc(p.aspect.title)}</h3><div class="ptxt">${markTerms(p.aspect.text,[p.terms.aspect])}</div><p class="refs">المرجع: ${apa(p.aspect.ref)}</p></section>
    <section class="psec"><span class="tag amber noprint">التبصّر الشخصيّ — البند 7</span><h3>القيمة/المصطلح: ${esc(p.insight.value)}</h3><div class="ptxt"><p>${esc(p.insight.how)}</p><p>${esc(p.insight.text)}</p></div></section>
    <section class="psec"><span class="tag red noprint">«ما وراء الكواليس» — البند 4</span><h3>خطّة العرض — ${p.slides.length} شرائح</h3>
      ${p.slides.map((s,i)=>`<div class="gstep"><b>شريحة ${i+1} — ${esc(s.t)}</b><br><b>هدفها:</b> ${esc(s.goal)}<br><b>عمّا سيُتحدَّث:</b> ${esc(s.talk)}<br><b>ما يظهر:</b> ${esc(s.show)}${s.visual?`<br><b>البصريّ:</b> ${esc(s.visual)}`:''}</div>`).join('')}</section>
    <section class="psec"><span class="tag blue noprint">المصادر</span><h3>لائحة المراجع (APA)</h3><ul class="eval">${p.sources.map(s=>`<li>${apa(s)}</li>`).join('')}</ul><h3>تصنيفها وموثوقيّتها وصلتها</h3><ul class="eval">${p.sourcesEval.map(li).join('')}</ul></section>
    <section class="psec"><span class="tag red noprint">تدريب المردودية — البند 8</span><h3>قبل التسجيل</h3><ol class="plain" style="padding-right:22px">${p.refl.map(q=>`<li>${esc(q)}</li>`).join('')}</ol></section>
    <section class="psec noprint"><details><summary>مئشار العرض الشخصيّ الكامل — تحديث ${esc(P.update)}</summary>${P.rubric.map(r=>`<div class="gstep"><b>${r.n}. ${esc(r.title)}</b> <span class="tag">${ptsLabel(r.pts)}</span><ul class="plain">${r.items.map(it=>`<li><b>${it[0]}</b> — ${esc(it[1])}</li>`).join('')}</ul></div>`).join('')}</details></section>
  </article>`;
}
function downloadCSV(s){
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const head=['الرقم في السجلّ','الاسم (سجلّ الحضور)','الاسم بالعربية','رمز الدخول','رقم الزاوية','نصّ الزاوية','الحالة'];
  const lines=U.students.filter(x=>x.sec===s).map(st=>{const a=tAngle(st.sec,st.angle);return [st.n,st.name,st.ar||'',st.code,st.angle||'',a?a.angle:'',st.prov?'مقترحة':'مثبَّتة'].map(q).join(',')});
  const blob=new Blob(['﻿'+head.map(q).join(',')+'\n'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='codes-section-'+s+'.csv';
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}

/* ---------- التوجيه ---------- */
async function route(){
  if(!U)return;
  const parts=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
  let html;
  try{
    if(U.kind==='s'){
      const r=parts[0]||'';
      markNav(r);
      html={'':pageHome,guide:pageGuide,model:pageModel,prompts:pagePrompts,check:pageCheck,voice:pageVoice}[r];
      html=html?html():pageHome();
    }else{
      if(parts[0]!=='t'||!parts[1]){location.replace('#/t/1');return}
      const r=parts[1];
      markNav(/^[1-4]$/.test(r)?'t/'+r:r==='notes'?'t/notes':r==='pres'?'t/pres':'t/'+(parts[2]||'1'));
      if(/^[1-4]$/.test(r))html=pageTeacherSection(+r);
      else if(r==='notes')html=pageTeacherNotes();
      else if(r==='pres'||r==='model'){
        view.innerHTML='<p class="msg info" style="text-align:center">جارٍ التحميل…</p>';
        html=await(r==='model'?pageTeacherModel(parts[2],parts[3]):parts[2]?pageTeacherPresItem(decodeURIComponent(parts[2])):pageTeacherPres());
      }else{location.replace('#/t/1');return}
    }
  }catch(e){
    html=`<div class="fatal"><b>تعذّر فتح هذه الصفحة.</b><br>تأكّد/ي من الإنترنت ثمّ أعد/أعيدي المحاولة.<div class="row" style="justify-content:center"><button class="btn" type="button" data-act="reload">إعادة التحميل</button></div></div>`;
  }
  view.innerHTML=html;
  window.scrollTo(0,0);
  view.focus({preventScroll:true});
  if($('#rubBar'))rubricScore();
  if($('#errBar'))errorsScore();
  $$('img[data-fallback]',view).forEach(img=>img.addEventListener('error',()=>{const f=img.closest('figure');if(f)f.querySelector('img').replaceWith(Object.assign(document.createElement('div'),{className:'frame',textContent:img.alt}))},{once:true}));
}

/* ---------- الأحداث ---------- */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-copy],[data-act],[data-group],[data-stage]');
  if(!t)return;
  if(t.dataset.copy){copyText(fillPrompt(C.prompts[t.dataset.copy],promptCtx()),t);return}
  if(t.dataset.group){promptGroup=t.dataset.group;$$('[data-group]').forEach(b=>b.setAttribute('aria-selected',b===t));$('#promptList').innerHTML=promptGroupHTML();return}
  if(t.dataset.stage){rubricStage=t.dataset.stage;$$('[data-stage]').forEach(b=>b.setAttribute('aria-selected',b===t));$('#rubList').innerHTML=rubricHTML();rubricScore();return}
  const act=t.dataset.act;
  if(act==='logout')logout();
  else if(act==='print')window.print();
  else if(act==='reload')location.reload();
  else if(act==='csv')downloadCSV(+t.dataset.sec);
  else if(act==='copylist'){const s=+t.dataset.sec;copyText(secName(s)+'\n'+U.students.filter(x=>x.sec===s).map(st=>`${st.n}\t${st.name}\t${st.code}\t${'وظيفة '+st.angle}`).join('\n'),t)}
});
document.addEventListener('change',e=>{
  const i=e.target;if(!saved||i.type!=='checkbox')return;
  const li=i.closest('li');
  if(i.dataset.p){saved.p[i.dataset.p]=i.checked;i.closest('.pcard').classList.toggle('done',i.checked);const l=$('#usedLbl');if(l)l.textContent=`استعملت ${Object.values(saved.p).filter(Boolean).length} من ${Object.keys(C.prompts).length}`}
  else if(i.dataset.g)saved.g[i.dataset.g]=i.checked;
  else if(i.dataset.r){saved.r[i.dataset.r]=i.checked;if(li)li.classList.toggle('on',i.checked);rubricScore()}
  else if(i.dataset.c!=null){saved.c[i.dataset.c]=i.checked;if(li)li.classList.toggle('on',i.checked);errorsScore()}
  else return;
  persist();
});
document.addEventListener('input',e=>{
  if(e.target.id!=='tSearch')return;
  const q=e.target.value.trim().toLowerCase();
  $$('#tRows tr').forEach(tr=>{tr.hidden=!!q&&!tr.dataset.search.includes(q)});
});
window.addEventListener('hashchange',route);

/* ---------- الإقلاع ---------- */
(async function boot(){
  if(location.protocol==='http:'&&!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){location.replace('https://'+location.host+location.pathname+location.hash);return}
  ldel(K_LAST); // النسخة القديمة كانت تحفظ الرمز وتفتح صفحة الطالب السابق لكلّ من يفتح الموقع
  bindLogin();
  const stored=sget(K_SESSION)||lget(K_REMEMBER);
  if(stored){
    showLoginMsg('جارٍ فتح صفحتك…',true);
    try{
      const res=await enter(stored);
      if(res==='ok'){showLoginMsg('');route();return}
      ldel(K_REMEMBER);sdel(K_SESSION);showLoginMsg('');
    }catch(e){showLoginMsg('لا اتصال بالموقع الآن. تأكّد/ي من الإنترنت ثمّ أدخل/ي رمزك.')}
  }
  getCommon().catch(()=>{}); // تجهيز مسبق؛ الفشل هنا لا يمنع المحاولة عند الدخول
})();
