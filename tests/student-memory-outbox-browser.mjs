import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Real IndexedDB and Web Locks, with every Hub request intercepted. No real
// staff credentials or student writes are used by this regression.
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext();
 let mode='success',delay=0,active=0,maxActive=0;
 const writes=[];
 const sample=n=>({action:'create_letter',source_app:'new_letter',student:{student_id:'OUTBOX-QA-'+n,full_name:'Synthetic Outbox QA'},document:{document_number:'OUTBOX-QA-'+n,document_type:'bachelor',letter_date:'2026-11-04'},snapshot:{studentName:'Synthetic Outbox QA',documentNo:'OUTBOX-QA-'+n}});
 await context.route('**/__outbox-qa.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body><script src="/student-memory.js"></script></body></html>'}));
 await context.route('https://buic-central-hub.vercel.app/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/staff/session')return route.fulfill({json:{ok:true,staff:{id:'outbox-browser-staff',username:'outbox-browser-staff'}}});
  assert.equal(url.pathname,'/api/staff/students/remember','unexpected Hub request must never escape the isolated test');
  writes.push(route.request().postDataJSON());active++;maxActive=Math.max(maxActive,active);
  const thisMode=mode;
  try{
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   if(thisMode==='lost')await route.abort('failed');
   else await route.fulfill({status:200,json:{ok:true}});
  }finally{active--;}
 });
 await context.addInitScript(()=>sessionStorage.setItem('buic-student-memory-staff-token-v1','isolated-outbox-token'));
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:8123/__outbox-qa.html');
 await page.waitForFunction(()=>window.BUICWorkspaceAuth?.isAuthenticated());
 assert.equal(await page.evaluate(()=>Boolean(navigator.locks?.request)),true,'exercise actual cross-tab Web Locks');
 const readRows=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('buic-student-db-pending-v1',1);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('pending','readonly'),get=tx.objectStore('pending').getAll();let rows;get.onsuccess=()=>{rows=get.result;};tx.oncomplete=()=>{db.close();resolve(rows);};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);
 }));

 delay=9000;
 await page.evaluate(value=>window.BUICStudentMemory.remember(value,{interactive:false}),sample('slow'));
 assert.equal((await readRows()).length,0);
 console.log('PASS a real Hub response after nine seconds succeeds without creating a pending warning');

 delay=0;mode='lost';
 await page.evaluate(async value=>{try{await window.BUICStudentMemory.remember(value,{interactive:false});throw Error('Expected lost response');}catch(error){if(!error.message.includes('Cannot reach'))throw error;}},sample('lost'));
 assert.equal((await readRows()).length,1);
 mode='success';
 await page.evaluate(value=>window.BUICStudentMemory.remember(value,{interactive:false}),sample('lost'));
 assert.equal((await readRows()).length,0);
 assert.equal(await page.locator('#buicPendingSaveStatus').count(),0);
 console.log('PASS a confirmed exact retry removes a legacy pending entry from real IndexedDB');

 const legacy=Array.from({length:6},(_,i)=>sample('legacy-'+i));
 await page.evaluate(async values=>{
  const actor=window.BUICWorkspaceAuth.getIdentity().id;
  const entries=await Promise.all(values.map(async payload=>{
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
   const checksum=Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
   return {id:actor+':'+checksum,actor,checksum,payload,createdAt:new Date().toISOString(),lastError:'Old eight-second timeout'};
  }));
  await new Promise((resolve,reject)=>{
   const request=indexedDB.open('buic-student-db-pending-v1',1);
   request.onsuccess=()=>{const db=request.result,tx=db.transaction('pending','readwrite');for(const entry of entries)tx.objectStore('pending').put(entry);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);
  });
 },legacy);
 const before=writes.length;
 await page.reload();
 await page.locator('#buicPendingSaveStatus').filter({hasText:'6 Student DB save(s) are waiting'}).waitFor();
 assert.equal(writes.length,before,'restoring a staff session must not upload drafts automatically');
 delay=150;maxActive=0;
 await page.evaluate(()=>{const button=document.querySelector('#buicPendingSaveStatus button');button.dispatchEvent(new MouseEvent('click'));button.dispatchEvent(new MouseEvent('click'));});
 await page.waitForFunction(()=>document.querySelector('#buicPendingSaveStatus button')?.disabled===true);
 try{await page.locator('#buicPendingSaveStatus').filter({hasText:'6 shared save(s) completed · 0 pending'}).waitFor({timeout:15000});}
 catch(error){
  console.error('OUTBOX RECOVERY DIAGNOSTIC',JSON.stringify({status:await page.locator('#buicPendingSaveStatus').textContent(),remaining:(await readRows()).map(row=>({id:row.id,lastError:row.lastError})),attempted:writes.slice(before).map(row=>row.document.document_number)}));
  throw error;
 }
 assert.equal(writes.length-before,6);assert.equal(maxActive,1);assert.equal((await readRows()).length,0);
 console.log('PASS six existing pending letters recover once with repeated retry clicks');

 const second=await context.newPage();
 await second.goto('http://127.0.0.1:8123/__outbox-qa.html');
 await second.waitForFunction(()=>window.BUICWorkspaceAuth?.isAuthenticated());
 maxActive=0;delay=250;
 await Promise.all([page.evaluate(value=>window.BUICStudentMemory.remember(value,{interactive:false}),sample('tab-1')),second.evaluate(value=>window.BUICStudentMemory.remember(value,{interactive:false}),sample('tab-2'))]);
 assert.equal(maxActive,1);assert.equal((await readRows()).length,0);
 console.log('PASS separate letter windows serialize saves with real Web Locks');
 await context.close();
}finally{await browser.close();}
