// Run the complete production client in isolated browser-like contexts. Only
// browser storage, UI and transport are adapters; no Hub writes leave this test.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'..','student-memory.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const payload=(number='1')=>({action:'create_letter',source_app:'new_letter',student:{student_id:'QA-'+number,full_name:'Synthetic QA'},document:{document_number:'QA-'+number,document_type:'bachelor',letter_date:'2026-11-04'},snapshot:{studentName:'Synthetic QA',documentNo:'QA-'+number}});
const response=(status=200,detail)=>new Response(JSON.stringify(status===200?{ok:true}:{detail:detail||'Test failure'}),{status});

function harness({rows=new Map(),locks}={}){
 const nodes=new Map(),timers=new Map(),calls=[],gates=[];let timerId=0,clock=0;
 function node(tag){
  const n={tag,children:[],style:{},listeners:{},disabled:false,
   setAttribute(){},append(child){this.children.push(child);if(child.id)nodes.set(child.id,child);},
   appendChild(child){this.append(child);return child;},
   addEventListener(event,fn){this.listeners[event]=fn;},remove(){nodes.delete(this.id);}};
  let text='';Object.defineProperty(n,'textContent',{get:()=>text,set:value=>{text=String(value);n.children=[];}});
  return n;
 }
 const document={readyState:'loading',body:node('body'),addEventListener(){},
  createElement:node,getElementById:id=>nodes.get(id)||null,
  querySelector:selector=>selector==='#buicPendingSaveStatus button'?nodes.get('buicPendingSaveStatus')?.children.find(n=>n.tag==='button')||null:null};
 const indexedDB={open(){
  const request={result:{close(){},transaction(){
   const tx={};tx.objectStore=()=>Object.fromEntries(['getAll','get','put','delete'].map(method=>[method,value=>{
    const r={};setImmediate(()=>{
     try{
      if(method==='getAll')r.result=structuredClone([...rows.values()]);
      if(method==='get')r.result=structuredClone(rows.get(value));
      if(method==='put'){rows.set(value.id,structuredClone(value));r.result=value.id;}
      if(method==='delete')rows.delete(value);
      r.onsuccess?.();tx.oncomplete?.();
     }catch(error){tx.error=error;tx.onerror?.();}
    });return r;
   }]));return tx;
  }}};setImmediate(()=>request.onsuccess?.());return request;
 }};
 const storage=new Map();
 const context={window:{},document,indexedDB,navigator:{locks},crypto:webcrypto,TextEncoder,AbortController,structuredClone,console,
  sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:clock+delay,delay});return id;},
  clearTimeout:id=>timers.delete(id),fetch:async(url,init)=>{calls.push({url,init});return transport(url,init);}};
 let transport=async()=>response();
 const hook=`window.__outbox={retryPending,enqueuePending,pendingRecords,saveExact,api,refreshPendingStatus,
   staff(id){token='token-'+id;sessionVerified=true;staffIdentity={id,username:id};},
   authenticated:()=>Boolean(token&&sessionVerified),
   interceptGate(fn){showGate=fn;}};`;
 vm.runInNewContext(source.replace("  if(document.readyState==='loading')",hook+"\n  if(document.readyState==='loading')"),context,{filename:'production-student-memory.js'});
 const api=context.window.__outbox;
 api.staff('staff-A');api.interceptGate(message=>gates.push(message));
 return {api,memory:context.window.BUICStudentMemory,rows,calls,gates,document,timers,
  status:()=>nodes.get('buicPendingSaveStatus')?.textContent||'',
  button:()=>document.querySelector('#buicPendingSaveStatus button'),
  transport(fn){transport=fn;},
  advance(ms){clock+=ms;for(const [id,t] of timers)if(t.at<=clock){timers.delete(id);t.fn();}}};
}

test('a response taking more than eight seconds is accepted and its body retains the deadline',async()=>{
 const h=harness(),headers=deferred(),body=deferred();let signal;
 h.transport(async(url,init)=>{signal=init.signal;return headers.promise;});
 const save=h.memory.remember(payload(),{interactive:false});
 while(!h.calls.length)await tick();
 assert.equal([...h.timers.values()][0].delay,45000);
 h.advance(9000);assert.equal(signal.aborted,false);
 headers.resolve({ok:true,status:200,text:()=>body.promise});await tick();
 assert.equal(h.timers.size,1,'deadline must cover the response body');
 body.resolve('{"ok":true}');await save;
 assert.equal(h.timers.size,0);assert.equal(h.rows.size,0);
});

test('a lost response preserves an exact payload; later success clears only that exact pending entry',async()=>{
 const h=harness(),original=payload(),submitted=structuredClone(original);
 h.transport(async()=>{throw new TypeError('Simulated response lost after Hub commit');});
 await assert.rejects(h.memory.remember(original,{interactive:false}),/Cannot reach/);
 original.snapshot.studentName='Changed after submission';
 assert.equal(h.rows.size,1);assert.deepEqual([...h.rows.values()][0].payload,submitted);
 const different=structuredClone(submitted);different.snapshot.studentName='A different revision';
 await h.api.enqueuePending(different,Error('offline'));
 h.transport(async()=>response());
 await h.memory.remember(submitted,{interactive:false});
 assert.equal(h.rows.size,1,'a different snapshot must remain for review');
 assert.equal([...h.rows.values()][0].payload.snapshot.studentName,'A different revision');
});

test('six legacy pending saves recover once despite repeated retry clicks',async()=>{
 const h=harness(),gate=deferred();
 for(let i=0;i<6;i++)await h.api.enqueuePending(payload(String(i)),Error('old timeout'));
 h.transport(async()=>{await gate.promise;return response();});
 const first=h.api.retryPending(),second=h.api.retryPending();
 assert.equal(first,second);
 while(!h.calls.length)await tick();
 assert.equal(h.button().disabled,true);assert.equal(h.calls.length,1);
 gate.resolve();await first;
 assert.equal(h.calls.length,6);assert.equal(h.rows.size,0);
 assert.match(h.status(),/6 shared save\(s\) completed · 0 pending/);
});

test('an outage stops after one request and reports all six retained records and the actual error',async()=>{
 const h=harness();
 for(let i=0;i<6;i++)await h.api.enqueuePending(payload(String(i)),Error('old timeout'));
 h.transport(async()=>response(503,'Database temporarily unavailable'));
 await h.api.retryPending();
 assert.equal(h.calls.length,1);assert.equal(h.rows.size,6);
 assert.match(h.status(),/0 shared save\(s\) completed · 6 pending/);
 assert.match(h.status(),/Database temporarily unavailable/);
 assert.equal(h.button().disabled,false);
 assert.ok([...h.rows.values()].some(row=>row.lastError==='Database temporarily unavailable'));
});

test('a conflict is retained while unrelated pending letters can finish',async()=>{
 const h=harness();
 for(let i=0;i<6;i++)await h.api.enqueuePending(payload(String(i)),Error('old timeout'));
 h.transport(async(url,init)=>JSON.parse(init.body).document.document_number==='QA-0'?response(409,'Different finalized snapshot'):response());
 await h.api.retryPending();
 assert.equal(h.calls.length,6);assert.equal(h.rows.size,1);
 assert.equal([...h.rows.values()][0].payload.document.document_number,'QA-0');
 assert.match(h.status(),/5 shared save\(s\) completed · 1 pending/);
 assert.match(h.status(),/different finalized letter/);
});

test('explicit saves are serialized and never post under a changed staff identity',async()=>{
 const h=harness(),gate=deferred();let active=0,max=0;
 h.transport(async()=>{active++;max=Math.max(max,active);await gate.promise;active--;return response();});
 const first=h.api.saveExact(payload('1'),'staff-A');
 while(!h.calls.length)await tick();
 const second=h.api.saveExact(payload('2'),'staff-A');
 await tick();assert.equal(h.calls.length,1);
 h.api.staff('staff-B');gate.resolve();await first;
 await assert.rejects(second,/staff account that created/);
 assert.equal(max,1);assert.equal(h.calls.length,1);
});

test('expired authentication retains the original actor and retry opens sign in without deleting anything',async()=>{
 const h=harness();h.transport(async()=>response(401,'Session expired'));
 await assert.rejects(h.memory.remember(payload(),{interactive:false}),/Session expired/);
 assert.equal(h.api.authenticated(),false);assert.equal(h.rows.size,1);
 assert.equal([...h.rows.values()][0].actor,'staff-A');
 await h.api.retryPending();assert.match(h.gates.at(-1),/Sign in/);assert.equal(h.calls.length,1);
 h.api.staff('staff-B');h.transport(async()=>response());
 await h.api.retryPending();assert.equal(h.rows.size,1);assert.equal(h.calls.length,1);
 h.api.staff('staff-A');await h.api.retryPending();assert.equal(h.rows.size,0);
});

test('late rejection of an old token does not clear a new authenticated session',async()=>{
 const h=harness(),gate=deferred();h.transport(async()=>gate.promise);
 const request=h.api.api('/api/staff/session');h.api.staff('staff-B');gate.resolve(response(401,'Old session expired'));
 await assert.rejects(request);assert.equal(h.api.authenticated(),true);
});

test('corrupt pending payloads are retained for recovery and are never submitted',async()=>{
 const h=harness();await h.api.enqueuePending(payload(),Error('offline'));
 [...h.rows.values()][0].payload.snapshot.studentName='Unexpected mutation';
 await h.api.retryPending();assert.equal(h.calls.length,0);assert.equal(h.rows.size,1);
 assert.match(h.status(),/checksum does not match/);
});

test('restoring a session displays retained work without automatically uploading drafts',async()=>{
 const h=harness();await h.api.enqueuePending(payload(),Error('offline'));
 await h.api.refreshPendingStatus();assert.match(h.status(),/1 Student DB save/);
 assert.equal(h.calls.length,0);assert.equal(h.rows.size,1);
});

test('server validation errors identify the field that requires correction',async()=>{
 const h=harness();h.transport(async()=>response(422,[{loc:['body','document','letter_date'],msg:'Invalid date'}]));
 await assert.rejects(h.memory.remember(payload(),{interactive:false}),/document.letter_date: Invalid date/);
 assert.equal(h.rows.size,0);
});
