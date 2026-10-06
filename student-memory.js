/* Shared secure student memory client for BUIC New Letter + Current Letter.
   Stores only a short-lived staff token in sessionStorage. Student records are never cached persistently here. */
(() => {
  'use strict';
  const BASE='https://buic-central-hub.vercel.app';
  const TOKEN_KEY='buic-student-memory-staff-token-v1';
  let token='';
  let authPromise=null,authResolve=null,authReject=null,authRequested=false;
  try{token=sessionStorage.getItem(TOKEN_KEY)||'';}catch{}

  const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean=v=>String(v??'').trim();

  function setToken(value){
    token=value||'';
    try{if(token)sessionStorage.setItem(TOKEN_KEY,token);else sessionStorage.removeItem(TOKEN_KEY);}catch{}
    renderState();
  }
  function clearToken(){setToken('');}
  async function api(path,{method='GET',body,auth=true}={}){
    const headers={'Accept':'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(auth&&token)headers['Authorization']='Bearer '+token;
    const r=await fetch(BASE+path,{method,mode:'cors',credentials:'omit',cache:'no-store',headers,body:body===undefined?undefined:JSON.stringify(body)});
    if(r.status===401&&auth)clearToken();
    const text=await r.text();let data={};try{data=text?JSON.parse(text):{};}catch{data={detail:text||('HTTP '+r.status)};}
    if(!r.ok)throw Object.assign(new Error(data.detail||('Hub returned HTTP '+r.status)),{status:r.status,data});
    return data;
  }

  function ensureUi(){
    if(document.querySelector('#buicStudentMemoryModal'))return;
    const style=document.createElement('style');
    style.textContent=`
      .buic-memory-launch{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 12px;border:1px solid rgba(100,116,139,.28);border-radius:10px;background:var(--surface,#fff);color:var(--text,#13233b);font:inherit;font-size:11px;font-weight:800;cursor:pointer}\n      @media(max-width:1550px){.buic-memory-launch{width:38px;min-width:38px;padding:0;justify-content:center}.buic-memory-launch span{display:none}}
      .buic-memory-launch i{width:8px;height:8px;border-radius:50%;background:#94a3b8}.buic-memory-launch.ready i{background:#16855b}.buic-memory-launch.warn i{background:#b7791f}
      .buic-memory-modal{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;background:rgba(15,23,42,.38);backdrop-filter:blur(2px)}
      .buic-memory-modal.hidden{display:none}.buic-memory-card{width:min(520px,calc(100vw - 28px));max-height:min(720px,calc(100vh - 28px));overflow:auto;background:#fff;color:#14213d;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.28);border:1px solid #dbe3ef}
      .buic-memory-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid #e5eaf2}.buic-memory-head strong{display:block;font-size:17px}.buic-memory-head span{display:block;margin-top:3px;font-size:10px;color:#64748b}
      .buic-memory-close{border:0;background:#f1f5f9;border-radius:8px;width:32px;height:32px;cursor:pointer}.buic-memory-body{padding:18px 20px;display:grid;gap:14px}
      .buic-memory-login,.buic-memory-search{display:grid;gap:10px}.buic-memory-row{display:grid;grid-template-columns:1fr 120px;gap:8px}.buic-memory-body label{display:grid;gap:5px;font-size:10px;font-weight:800;color:#475569}
      .buic-memory-body input{height:40px;border:1px solid #cfd8e6;border-radius:9px;padding:0 10px;font:inherit;color:#0f172a;background:#f8fafc;box-sizing:border-box}.buic-memory-body button.primary{height:40px;border:0;border-radius:9px;background:#16365f;color:white;font:inherit;font-weight:800;padding:0 14px;cursor:pointer}
      .buic-memory-body button.secondary{height:36px;border:1px solid #cfd8e6;border-radius:9px;background:#fff;color:#16365f;font:inherit;font-weight:800;padding:0 12px;cursor:pointer}
      .buic-memory-note{font-size:10px;line-height:1.45;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}.buic-memory-error{font-size:10px;color:#b42318;min-height:14px}
      .buic-memory-result{display:grid;gap:7px;border:1px solid #dbe3ef;border-radius:12px;padding:12px;background:#fbfdff}.buic-memory-result strong{font-size:13px}.buic-memory-result span{font-size:10px;color:#64748b}.buic-memory-result-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:4px}
      @media(max-width:580px){.buic-memory-row{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
    const modal=document.createElement('div');
    modal.id='buicStudentMemoryModal';modal.className='buic-memory-modal hidden';modal.innerHTML=`
      <section class="buic-memory-card" role="dialog" aria-modal="true" aria-labelledby="buicMemoryTitle">
        <div class="buic-memory-head"><div><strong id="buicMemoryTitle">Student Database</strong><span>Shared between New Letter and Current Letter</span></div><button class="buic-memory-close" type="button" aria-label="Close">×</button></div>
        <div class="buic-memory-body">
          <form class="buic-memory-login" id="buicMemoryLogin">
            <div class="buic-memory-note">Sign in with the Central Hub staff credentials. The website stores only a short-lived session token in this browser tab.</div>
            <label>Password<input id="buicMemoryPassword" type="password" autocomplete="current-password" required></label>
            <label>Authenticator code<input id="buicMemoryOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="6-digit code"></label>
            <div class="buic-memory-error" id="buicMemoryLoginError"></div>
            <button class="primary" type="submit">Sign in</button>
          </form>
          <section class="buic-memory-search hidden" id="buicMemorySearch">
            <div class="buic-memory-row"><label>Student ID<input id="buicMemoryStudentId" autocomplete="off" placeholder="1690000000"></label><button class="primary" id="buicMemoryFind" type="button">Find student</button></div>
            <div class="buic-memory-error" id="buicMemorySearchError"></div>
            <div id="buicMemoryResult"></div>
            <div style="display:flex;justify-content:flex-end"><button class="secondary" id="buicMemorySignOut" type="button">Sign out</button></div>
          </section>
        </div>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('.buic-memory-close'))closeUi();});
    modal.querySelector('#buicMemoryLogin').addEventListener('submit',async e=>{
      e.preventDefault();const error=modal.querySelector('#buicMemoryLoginError');error.textContent='';
      const password=modal.querySelector('#buicMemoryPassword').value,otp=modal.querySelector('#buicMemoryOtp').value.trim();
      try{
        const result=await api('/api/staff/login',{method:'POST',body:{password,otp},auth:false});
        setToken(result.token);modal.querySelector('#buicMemoryPassword').value='';modal.querySelector('#buicMemoryOtp').value='';
        if(authResolve){const resolve=authResolve;authResolve=authReject=null;authPromise=null;authRequested=false;resolve(token);closeUi();}
        else{showSearch();}
      }catch(err){error.textContent=err.message||'Could not sign in.';}
    });
    modal.querySelector('#buicMemoryFind').addEventListener('click',findFromUi);
    modal.querySelector('#buicMemoryStudentId').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findFromUi();}});
    modal.querySelector('#buicMemorySignOut').addEventListener('click',()=>{clearToken();showLogin();});
    installLaunchButton();
    renderState();
  }
  function installLaunchButton(){
    if(document.querySelector('#buicStudentMemoryLaunch'))return;
    const host=document.querySelector('.top-actions')||document.querySelector('.topbar-actions')||document.body;
    const b=document.createElement('button');b.id='buicStudentMemoryLaunch';b.type='button';b.className='buic-memory-launch';b.innerHTML='<i></i><span>Student DB</span>';b.addEventListener('click',openUi);host.appendChild(b);
  }
  function renderState(){
    const b=document.querySelector('#buicStudentMemoryLaunch');if(!b)return;
    b.classList.toggle('ready',!!token);b.classList.toggle('warn',!token);b.title=token?'Student database signed in for this tab':'Sign in to shared student database';
  }
  function showLogin(){
    ensureUi();document.querySelector('#buicMemoryLogin').classList.remove('hidden');document.querySelector('#buicMemorySearch').classList.add('hidden');setTimeout(()=>document.querySelector('#buicMemoryPassword')?.focus(),20);
  }
  function showSearch(){
    ensureUi();document.querySelector('#buicMemoryLogin').classList.add('hidden');document.querySelector('#buicMemorySearch').classList.remove('hidden');setTimeout(()=>document.querySelector('#buicMemoryStudentId')?.focus(),20);
  }
  function openUi(){ensureUi();document.querySelector('#buicStudentMemoryModal').classList.remove('hidden');token?showSearch():showLogin();}
  function closeUi(){
    const m=document.querySelector('#buicStudentMemoryModal');m?.classList.add('hidden');
    if(authReject){const reject=authReject;authResolve=authReject=null;authPromise=null;authRequested=false;reject(new Error('Student database sign-in cancelled'));}
  }
  function requestAuth(){
    if(token)return Promise.resolve(token);
    ensureUi();document.querySelector('#buicStudentMemoryModal').classList.remove('hidden');showLogin();authRequested=true;
    if(!authPromise)authPromise=new Promise((resolve,reject)=>{authResolve=resolve;authReject=reject;});
    return authPromise;
  }
  async function getStudent(studentId,{interactive=false}={}){
    const id=clean(studentId);if(!id)throw new Error('Enter a student ID.');
    if(!token){if(!interactive)throw Object.assign(new Error('Student database sign-in required'),{status:401});await requestAuth();}
    try{return await api('/api/staff/students/'+encodeURIComponent(id));}
    catch(err){if(err.status===401&&interactive){await requestAuth();return api('/api/staff/students/'+encodeURIComponent(id));}throw err;}
  }
  async function remember(payload,{interactive=true}={}){
    if(!payload?.student?.student_id||!payload?.student?.full_name)throw new Error('Student ID and name are required before saving to Student DB.');
    if(!token){if(!interactive)throw Object.assign(new Error('Student database sign-in required'),{status:401});await requestAuth();}
    try{return await api('/api/staff/students/remember',{method:'POST',body:payload});}
    catch(err){if(err.status===401&&interactive){await requestAuth();return api('/api/staff/students/remember',{method:'POST',body:payload});}throw err;}
  }
  async function rememberMany(payloads,{interactive=true}={}){
    const out=[];for(const payload of payloads)out.push(await remember(payload,{interactive}));return out;
  }
  async function findFromUi(){
    const modal=document.querySelector('#buicStudentMemoryModal'),id=modal.querySelector('#buicMemoryStudentId').value.trim(),error=modal.querySelector('#buicMemorySearchError'),host=modal.querySelector('#buicMemoryResult');error.textContent='';host.innerHTML='';
    try{
      const record=await getStudent(id,{interactive:false}),s=record.student||{},p=record.passport||{},a=record.academic||{};
      host.innerHTML='<article class="buic-memory-result"><strong>'+esc(s.full_name||s.student_id)+'</strong><span>'+esc(s.student_id||'')+(p.passport_number?' · Passport '+esc(p.passport_number):'')+'</span><span>'+esc([a.faculty_en,a.major_en].filter(Boolean).join(' · '))+'</span><div class="buic-memory-result-actions"><button class="secondary" type="button" id="buicMemoryUse">Use this student</button></div></article>';
      host.querySelector('#buicMemoryUse').addEventListener('click',()=>{window.dispatchEvent(new CustomEvent('buic-student-memory-selected',{detail:record}));closeUi();});
    }catch(err){error.textContent=err.status===404?'Student not found.':(err.message||'Could not load student.');}
  }
  async function validateSession(){
    if(!token)return false;try{await api('/api/staff/session');return true;}catch{return false;}
  }

  window.BUICStudentMemory=Object.freeze({
    baseUrl:BASE,open:openUi,logout:clearToken,getStudent,remember,rememberMany,validateSession,
    isAuthenticated:()=>Boolean(token)
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{ensureUi();validateSession().then(ok=>{if(!ok)clearToken();});},{once:true});
  else{ensureUi();validateSession().then(ok=>{if(!ok)clearToken();});}
})();
