/* BUIC shared workspace authentication + student memory client.
   Authentication happens once at workspace entry. Only the signed staff token is kept in sessionStorage. */
(() => {
  'use strict';

  const BASE='https://buic-central-hub.vercel.app';
  const TOKEN_KEY='buic-student-memory-staff-token-v1';
  let token='';
  let sessionVerified=false;
  let staffIdentity=null;
  let authPromise=null,authResolve=null;
  try{token=sessionStorage.getItem(TOKEN_KEY)||'';}catch{}

// Versioned, local-only outbox for exact Student DB payloads.
// A staff session never uploads unfinished drafts automatically.
const PENDING_DB_NAME='buic-student-db-pending-v1';
function pendingDb(){return new Promise((resolve,reject)=>{
 const req=indexedDB.open(PENDING_DB_NAME,1);
 req.onupgradeneeded=()=>req.result.createObjectStore('pending',{keyPath:'id'});
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error||new Error('Pending-save database failed'));
});}
async function pendingTx(mode,callback){
 const db=await pendingDb();
 try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction('pending',mode),request=callback(tx.objectStore('pending'));
   let value;
   if(request)request.onsuccess=()=>{value=request.result};
   tx.oncomplete=()=>resolve(value);
   tx.onerror=()=>reject(tx.error||new Error('Pending-save transaction failed'));
   tx.onabort=()=>reject(tx.error||new Error('Pending-save transaction aborted'));
 });}finally{db.close();}
}
async function pendingRecords(){
 const actor=staffIdentity?.id;
 if(!actor)return [];
 return (await pendingTx('readonly',s=>s.getAll())||[]).filter(x=>x.actor===actor);
}
function pendingStatus(text,isError=false){
 let node=document.getElementById('buicPendingSaveStatus');
 if(!node){
   node=document.createElement('div');node.id='buicPendingSaveStatus';
   node.setAttribute('role','status');
   node.style.cssText='position:fixed;z-index:2147483645;bottom:10px;left:10px;max-width:min(460px,92vw);padding:10px 14px;border:1px solid #f5d87b;border-radius:10px;background:#fffbeb;color:#92400e;font:12px sans-serif';
   document.body.appendChild(node);
 }
 node.textContent=text;
 if(isError){
  const button=document.createElement('button');button.textContent='Retry pending Student DB saves';button.type='button';
  button.style.marginLeft='8px';button.addEventListener('click',()=>void retryPending());node.append(button);
 }
}
async function enqueuePending(payload,error){
 const actor=staffIdentity?.id;
 if(!actor)throw new Error('Cannot retain pending save without validated staff identity');
 const exact=structuredClone(payload);
 const json=JSON.stringify(exact);
 const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json))))
   .map(b=>b.toString(16).padStart(2,'0')).join('');
 const entry={id:actor+':'+checksum,actor,checksum,payload:exact,
   createdAt:new Date().toISOString(),lastError:String(error?.message||error)};
 await pendingTx('readwrite',store=>store.put(entry));
 pendingStatus('Letter saved locally. Student DB save pending ('+entry.lastError+').',true);
 return entry;
}
async function retryPending(){
 if(!sessionVerified){pendingStatus('Sign in or retry Hub connection before retrying shared saves.',true);return;}
 const records=await pendingRecords();let done=0,failed=0;
 for(const r of records){
  try{await api('/api/staff/students/remember',{method:'POST',body:r.payload});
      await pendingTx('readwrite',store=>store.delete(r.id));done++;}
  catch(error){failed++;if(error.status===409){pendingStatus('Document conflict requires manual correction review. Pending record retained.',true);break;}}
 }
 pendingStatus(done+' shared save(s) completed · '+failed+' pending. '+
   (failed?'Nothing was overwritten.':'Student DB is up to date.'),failed>0);
}

  const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean=v=>String(v??'').trim();

  function setToken(value){
    token=value||'';
    if(!token){sessionVerified=false;staffIdentity=null;}
    try{if(token)sessionStorage.setItem(TOKEN_KEY,token);else sessionStorage.removeItem(TOKEN_KEY);}catch{}
    renderState();
  }
  function clearToken(){setToken('');}

  async function api(path,{method='GET',body,auth=true}={}){
    const headers={'Accept':'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(auth&&token)headers['Authorization']='Bearer '+token;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    let response;
    try{response=await fetch(BASE+path,{
      method,mode:'cors',credentials:'omit',cache:'no-store',headers,
      signal:controller.signal,
      body:body===undefined?undefined:JSON.stringify(body)
    });}
    catch(error){throw Object.assign(new Error(error?.name==='AbortError'
      ?'Hub connection timed out. Retry when connected.'
      :'Cannot reach the Hub. Your sign-in token and drafts are preserved.'),
      {status:0,kind:'connection',cause:error});}
    finally{clearTimeout(timeout);}
    const raw=await response.text();let data={};
    try{data=raw?JSON.parse(raw):{};}catch{data={detail:raw||('HTTP '+response.status)};}
    if(response.status===401&&auth){sessionVerified=false;clearToken();}
    if(!response.ok){
      const detail=data.detail;
      const message=typeof detail==='string'?detail:(detail?.message||('Hub returned HTTP '+response.status));
      throw Object.assign(new Error(message),{status:response.status,data});
    }
    return data;
  }

  function ensureUi(){
    if(document.querySelector('#buicWorkspaceAuth'))return;

    const style=document.createElement('style');
    style.textContent=`
      .buic-workspace-auth{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:20px;background:linear-gradient(145deg,#eef4fb 0%,#f8fbff 48%,#edf3f9 100%);color:#14213d;font-family:inherit}
      .buic-workspace-auth.hidden{display:none}
      .buic-auth-card{width:min(430px,calc(100vw - 32px));background:#fff;border:1px solid #d8e1ec;border-radius:18px;box-shadow:0 26px 80px rgba(15,34,62,.18);overflow:hidden}
      .buic-auth-brand{display:flex;gap:12px;align-items:center;padding:22px 24px 16px}
      .buic-auth-mark{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:#183d6d;color:#fff;font-size:14px;font-weight:900}
      .buic-auth-brand strong{display:block;font-size:17px}.buic-auth-brand span{display:block;margin-top:3px;color:#65758b;font-size:10px}
      .buic-auth-form{display:grid;gap:12px;padding:8px 24px 24px}
      .buic-auth-form label{display:grid;gap:6px;color:#46566e;font-size:10px;font-weight:850}
      .buic-auth-form input{height:44px;box-sizing:border-box;border:1px solid #cbd6e4;border-radius:9px;background:#f8fbff;color:#14213d;padding:0 11px;font:inherit;font-size:13px;outline:0}
      .buic-auth-form input:focus{border-color:#3569a9;box-shadow:0 0 0 3px rgba(53,105,169,.11);background:#fff}
      .buic-auth-form button{height:44px;border:0;border-radius:9px;background:#183d6d;color:#fff;font:inherit;font-size:12px;font-weight:850;cursor:pointer}
      .buic-auth-form button:disabled{opacity:.55;cursor:wait}
      .buic-auth-note{padding:10px 12px;border:1px solid #e0e7f0;border-radius:9px;background:#f7f9fc;color:#64748b;font-size:10px;line-height:1.45}
      .buic-auth-error{min-height:14px;color:#b42318;font-size:10px}

      .buic-memory-launch{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 12px;border:1px solid rgba(100,116,139,.28);border-radius:10px;background:var(--surface,#fff);color:var(--text,#13233b);font:inherit;font-size:11px;font-weight:800;cursor:pointer}
      @media(max-width:1550px){.buic-memory-launch{width:38px;min-width:38px;padding:0;justify-content:center}.buic-memory-launch span{display:none}}
      .buic-memory-launch i{width:8px;height:8px;border-radius:50%;background:#94a3b8}.buic-memory-launch.ready i{background:#16855b}.buic-memory-launch.warn i{background:#b7791f}
      .buic-memory-modal{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;background:rgba(15,23,42,.38);backdrop-filter:blur(2px)}
      .buic-memory-modal.hidden{display:none}
      .buic-memory-card{width:min(520px,calc(100vw - 28px));max-height:min(720px,calc(100vh - 28px));overflow:auto;background:#fff;color:#14213d;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.28);border:1px solid #dbe3ef}
      .buic-memory-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid #e5eaf2}.buic-memory-head strong{display:block;font-size:17px}.buic-memory-head span{display:block;margin-top:3px;font-size:10px;color:#64748b}
      .buic-memory-close{border:0;background:#f1f5f9;border-radius:8px;width:32px;height:32px;cursor:pointer}
      .buic-memory-body{padding:18px 20px;display:grid;gap:14px}
      .buic-memory-search{display:grid;gap:10px}.buic-memory-row{display:grid;grid-template-columns:1fr 120px;gap:8px}.buic-memory-body label{display:grid;gap:5px;font-size:10px;font-weight:800;color:#475569}
      .buic-memory-body input{height:40px;border:1px solid #cfd8e6;border-radius:9px;padding:0 10px;font:inherit;color:#0f172a;background:#f8fafc;box-sizing:border-box}
      .buic-memory-body button.primary{height:40px;border:0;border-radius:9px;background:#16365f;color:white;font:inherit;font-weight:800;padding:0 14px;cursor:pointer}
      .buic-memory-body button.secondary{height:36px;border:1px solid #cfd8e6;border-radius:9px;background:#fff;color:#16365f;font:inherit;font-weight:800;padding:0 12px;cursor:pointer}
      .buic-memory-error{font-size:10px;color:#b42318;min-height:14px}
      .buic-memory-result{display:grid;gap:7px;border:1px solid #dbe3ef;border-radius:12px;padding:12px;background:#fbfdff}.buic-memory-result strong{font-size:13px}.buic-memory-result span{font-size:10px;color:#64748b}.buic-memory-result-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:4px}
      @media(max-width:580px){.buic-memory-row{grid-template-columns:1fr}}
      html.buic-auth-pending body>*:not(#buicWorkspaceAuth){visibility:hidden!important}
      html.buic-auth-pending #buicWorkspaceAuth{visibility:visible!important}
    `;
    document.head.appendChild(style);

    const gate=document.createElement('div');
    gate.id='buicWorkspaceAuth';
    gate.className='buic-workspace-auth';
    gate.innerHTML=`
      <section class="buic-auth-card" role="dialog" aria-modal="true" aria-labelledby="buicAuthTitle">
        <div class="buic-auth-brand">
          <div class="buic-auth-mark">IC</div>
          <div><strong id="buicAuthTitle">BU International Center Workspace</strong><span>Staff sign in</span></div>
        </div>
        <form class="buic-auth-form" id="buicWorkspaceLogin">
          <div class="buic-auth-note">Sign in once to use New Letter, Current Letter, and the shared Student Database.</div>
          <label>Account<input id="buicWorkspaceUsername" autocomplete="username" value="visaspecial" required></label>
          <label>Password<input id="buicWorkspacePassword" type="password" autocomplete="current-password" required></label>
          <div class="buic-auth-error" id="buicWorkspaceLoginError"></div>
          <button id="buicWorkspaceLoginButton" type="submit">Sign in</button>
          <button id="buicWorkspaceRetry" type="button">Retry Hub connection</button>
        </form>
      </section>
    `;
    document.body.appendChild(gate);

    const modal=document.createElement('div');
    modal.id='buicStudentMemoryModal';
    modal.className='buic-memory-modal hidden';
    modal.innerHTML=`
      <section class="buic-memory-card" role="dialog" aria-modal="true" aria-labelledby="buicMemoryTitle">
        <div class="buic-memory-head">
          <div><strong id="buicMemoryTitle">Student Database</strong><span>Shared between New Letter and Current Letter</span></div>
          <button class="buic-memory-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="buic-memory-body">
          <section class="buic-memory-search" id="buicMemorySearch">
            <div class="buic-memory-row">
              <label>Student ID<input id="buicMemoryStudentId" autocomplete="off" placeholder="1690000000"></label>
              <button class="primary" id="buicMemoryFind" type="button">Find student</button>
            </div>
            <div class="buic-memory-error" id="buicMemorySearchError"></div>
            <div id="buicMemoryResult"></div>
            <div style="display:flex;justify-content:flex-end"><button class="secondary" id="buicMemorySignOut" type="button">Sign out workspace</button></div>
          </section>
        </div>
      </section>
    `;
    document.body.appendChild(modal);

    gate.querySelector('#buicWorkspaceLogin').addEventListener('submit',loginWorkspace);
    gate.querySelector('#buicWorkspaceRetry').addEventListener('click',()=>void retryConnection());
    modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('.buic-memory-close'))closeUi();});
    modal.querySelector('#buicMemoryFind').addEventListener('click',findFromUi);
    modal.querySelector('#buicMemoryStudentId').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findFromUi();}});
    modal.querySelector('#buicMemorySignOut').addEventListener('click',signOutWorkspace);
    installLaunchButton();
    renderState();
  }

  function installLaunchButton(){
    if(document.querySelector('#buicStudentMemoryLaunch'))return;
    const host=document.querySelector('.top-actions')||document.querySelector('.topbar-actions')||document.body;
    const button=document.createElement('button');
    button.id='buicStudentMemoryLaunch';
    button.type='button';
    button.className='buic-memory-launch';
    button.innerHTML='<i></i><span>Student DB</span>';
    button.addEventListener('click',()=>{void openUi();});
    host.appendChild(button);
  }

  function renderState(){
    const button=document.querySelector('#buicStudentMemoryLaunch');
    if(!button)return;
    button.classList.toggle('ready',!!token);
    button.classList.toggle('warn',!token);
    button.title=token?'Open shared Student Database':'Workspace sign in required';
  }

  function showGate(message=''){
    ensureUi();
    document.documentElement.classList.add('buic-auth-pending');
    const gate=document.querySelector('#buicWorkspaceAuth');
    gate.classList.remove('hidden');
    const error=document.querySelector('#buicWorkspaceLoginError');
    if(error)error.textContent=message;
    setTimeout(()=>document.querySelector('#buicWorkspacePassword')?.focus(),20);
  }

  function unlockWorkspace(){
    const gate=document.querySelector('#buicWorkspaceAuth');
    if(gate)gate.classList.add('hidden');
    document.documentElement.classList.remove('buic-auth-pending');
    renderState();
    window.dispatchEvent(new CustomEvent('buic-workspace-verified'));
  }

  async function loginWorkspace(event){
    event?.preventDefault();
    const username=clean(document.querySelector('#buicWorkspaceUsername')?.value);
    const password=String(document.querySelector('#buicWorkspacePassword')?.value||'');
    const error=document.querySelector('#buicWorkspaceLoginError');
    const button=document.querySelector('#buicWorkspaceLoginButton');
    if(error)error.textContent='';
    if(button)button.disabled=true;
    try{
      const result=await api('/api/staff/login',{method:'POST',body:{username,password},auth:false});
      setToken(result.token);
      sessionVerified=true;
      staffIdentity={id:String(result.staff?.id||username),username};
      const passwordInput=document.querySelector('#buicWorkspacePassword');
      if(passwordInput)passwordInput.value='';
      unlockWorkspace();
      if(authResolve){const resolve=authResolve;authResolve=null;authPromise=null;resolve(token);}
    }catch(err){
      showGate(err?.message||'Could not sign in.');
    }finally{
      if(button)button.disabled=false;
    }
  }

  function requestAuth(){
    if(token&&sessionVerified)return Promise.resolve(token);
    showGate();
    if(!authPromise)authPromise=new Promise(resolve=>{authResolve=resolve;});
    return authPromise;
  }

  async function validateSession(){
    if(!token)return 'rejected';
    try{
      const response=await api('/api/staff/session');
      sessionVerified=true;
      staffIdentity=response.staff||null;
      return 'valid';
    }catch(error){
      sessionVerified=false;
      return error.status===401?'rejected':'unavailable';
    }
  }
  async function bootstrapAuth(){
    ensureUi();
    const state=await validateSession();
    if(state==='valid'){unlockWorkspace();return;}
    if(state==='rejected'){clearToken();showGate('Sign in to continue.');}
    else showGate('The Hub is temporarily unreachable. Your token and local drafts are retained. Retry connection.');
  }
  async function retryConnection(){
    showGate('Checking Hub connection…');
    const state=await validateSession();
    if(state==='valid'){
      unlockWorkspace();
      if(authResolve){const resolve=authResolve;authResolve=null;authPromise=null;resolve(token);}
    }
    else if(state==='rejected'){clearToken();showGate('Your session expired. Sign in again.');}
    else showGate('Still unable to reach the Hub. Nothing has been deleted.');
  }

  async function openUi(){
    ensureUi();
    if(!sessionVerified)await requestAuth();
    document.querySelector('#buicStudentMemoryModal').classList.remove('hidden');
    document.querySelector('#buicMemorySearchError').textContent='';
    setTimeout(()=>document.querySelector('#buicMemoryStudentId')?.focus(),20);
  }

  function closeUi(){document.querySelector('#buicStudentMemoryModal')?.classList.add('hidden');}

  function signOutWorkspace(){
    if(token)void api('/api/staff/logout',{method:'POST'}).catch(e=>console.warn('Remote logout unavailable',e));
    closeUi();
    clearToken();
    showGate();
  }

  async function getStudent(studentId,{interactive=false}={}){
    const id=clean(studentId);
    if(!id)throw new Error('Enter a student ID.');
    if(!token){
      if(!interactive)throw Object.assign(new Error('Workspace sign in required'),{status:401});
      await requestAuth();
    }
    try{return await api('/api/staff/students/'+encodeURIComponent(id));}
    catch(err){
      if(err.status===401&&interactive){showGate('Your workspace session expired. Please sign in again.');await requestAuth();return api('/api/staff/students/'+encodeURIComponent(id));}
      throw err;
    }
  }

  async function remember(payload,{interactive=true}={}){
    payload=structuredClone(payload); // exact submitted document, not live form state
    if(!payload?.student?.student_id||!payload?.student?.full_name)throw new Error('Student ID and name are required before saving to Student DB.');
    if(!token){
      if(!interactive)throw Object.assign(new Error('Workspace sign in required'),{status:401});
      await requestAuth();
    }
    try{return await api('/api/staff/students/remember',{method:'POST',body:payload});}
    catch(err){
      if(err.status===401&&interactive){
        showGate('Your workspace session expired. Please sign in again.');await requestAuth();
        try{return await api('/api/staff/students/remember',{method:'POST',body:payload});}
        catch(retryError){
          if(retryError.status===0||retryError.status===401||retryError.status===429||retryError.status>=500)
            await enqueuePending(payload,retryError);
          throw retryError;
        }
      }
      if(err.status===0||err.status===401||err.status===429||err.status>=500)
        await enqueuePending(payload,err);
      throw err;
    }
  }

  async function rememberMany(payloads,{interactive=true}={}){
    const out=[];for(const payload of payloads)out.push(await remember(payload,{interactive}));return out;
  }

  async function findFromUi(){
    const modal=document.querySelector('#buicStudentMemoryModal');
    const id=modal.querySelector('#buicMemoryStudentId').value.trim();
    const error=modal.querySelector('#buicMemorySearchError');
    const host=modal.querySelector('#buicMemoryResult');
    error.textContent='';host.innerHTML='';
    try{
      const record=await getStudent(id,{interactive:true}),s=record.student||{},p=record.passport||{},a=record.academic||{};
      host.innerHTML='<article class="buic-memory-result"><strong>'+esc(s.full_name||s.student_id)+'</strong><span>'+esc(s.student_id||'')+(p.passport_number?' · Passport '+esc(p.passport_number):'')+'</span><span>'+esc([a.faculty_en,a.major_en].filter(Boolean).join(' · '))+'</span><div class="buic-memory-result-actions"><button class="secondary" type="button" id="buicMemoryUse">Use this student</button></div></article>';
      host.querySelector('#buicMemoryUse').addEventListener('click',()=>{window.dispatchEvent(new CustomEvent('buic-student-memory-selected',{detail:record}));closeUi();});
    }catch(err){
      error.textContent=err.status===404?'Student not found.':(err.message||'Could not load student.');
    }
  }

  window.BUICStudentMemory=Object.freeze({
    baseUrl:BASE,open:openUi,logout:signOutWorkspace,getStudent,remember,rememberMany,validateSession,
    checkDocument:payload=>api('/api/staff/documents/check',{method:'POST',body:structuredClone(payload)}),
    proposeRevision:(payload,fingerprint,reason,idempotencyKey)=>api('/api/staff/documents/revisions',{method:'POST',body:{
      document_number:payload.document.document_number,expected_fingerprint:fingerprint,
      proposed_document:structuredClone(payload.document),proposed_snapshot:structuredClone(payload.snapshot),
      reason,idempotency_key:idempotencyKey}}),
    requireAuth:requestAuth,isAuthenticated:()=>Boolean(token&&sessionVerified)
  });
  window.BUICWorkspaceAuth=Object.freeze({
    login:requestAuth,logout:signOutWorkspace,isAuthenticated:()=>Boolean(token&&sessionVerified),
    getIdentity:()=>staffIdentity&&sessionVerified?{...staffIdentity}:null,
    retryConnection
  });

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void bootstrapAuth();},{once:true});
  else void bootstrapAuth();
})();
