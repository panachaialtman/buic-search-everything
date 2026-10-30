'use strict';
// Runs the assembled production module and its real import/asset/history
// entrypoints. Browser I/O, IndexedDB and ordinary preview painting are fake.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(process.env.BUIC_PARENT_SOURCE || path.join(__dirname,'../new-letter-pdf-v1.js'),'utf8');
const boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>build().catch(console.error),{once:true});else build().catch(console.error);";
assert.equal(source.split(boot).length,2,'Use the complete assembled production module');
const expose=`window.__operations={state,addFiles,importFile,importZip,importAsset,removeAsset,
 undoEdit,redoEdit,restoreSnapshot,snapshot,resetHistory,reviewImportDraft,reviewRestoreDraft,
 reviewRunWorkspaceOperation,reviewScheduleDraft,reviewSaveDraft,applyRememberedStudentRecord,
 status:()=>({active:reviewWorkspaceOperations.size,replacing:Boolean(reviewWorkspaceReplacement),
   installing:reviewDraftCandidateInstalling,dirty:reviewDraftDirty,paused:reviewDraftPauseDepth}),
 configure(io){reviewDraftTransaction=io.transaction;dbPut=io.putAsset;dbDelete=io.deleteAsset;
   ensurePdfLibs=io.pdfLibraries;ensureZip=async()=>{};renderAll=io.render;
   renderActive=async()=>{};renderFilmstrip=async()=>{};renderGrid=async()=>{};
   updateControls=()=>{};scanDuplicates=async()=>{};toast=io.toast;setStatus=()=>{};
 }};`;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function element(id){const classes=new Set();return{id,value:'',checked:false,disabled:false,inert:false,dataset:{},style:{},
 classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x),
  toggle(x,on){const enabled=on===undefined?!classes.has(x):on;enabled?classes.add(x):classes.delete(x)}},
 setAttribute(){},removeAttribute(){},addEventListener(){},contains:()=>true,querySelector:()=>null,
 getContext:()=>({fillRect(){},clearRect(){},drawImage(){},save(){},restore(){},translate(){},rotate(){}})}}
function fixture(){
 const nodes=new Map(),rows=new Map(),assets=new Map(),writes=[],messages=[],timers=new Map();let timerId=0;
 const f={rows,assets,writes,messages,nodes,errors:[],commitGate:null,assetGate:null,nextLibraryGate:null,failCommit:false};
 const get=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id)};
 const document={readyState:'loading',activeElement:null,addEventListener(){},querySelectorAll:()=>[],
  querySelector:s=>get(s),getElementById:id=>get('#'+id),createElement:tag=>element(tag)};
 const pdf={numPages:1,getPage:async n=>{if(n!==1)throw Error('Invalid PDF page');return{
  getViewport:()=>({width:20,height:30}),render:()=>({promise:Promise.resolve()})}},destroy(){}};
 const window={BUICWorkspaceAuth:{getIdentity:()=>({id:'SYNTHETIC_STAFF'}),isAuthenticated:()=>false},
  addEventListener(){},pdfjsLib:{AnnotationMode:{DISABLE:0},getDocument:()=>({promise:Promise.resolve(pdf)})},
  JSZip:{loadAsync:async file=>{
   if(file.kind==='FILES')return{files:{'A.pdf':{dir:false,name:'A.pdf',async:async()=>{
    if(file.gate)await file.gate.promise;return new Blob([new Uint8Array([1,2,3])],{type:'application/pdf'})}}}};
   const row=file.row;
   return{file:name=>name==='manifest.json'?{async:async()=>JSON.stringify({...row,
    sources:row.sources.map((s,i)=>({...s,bytes:undefined,file:'sources/'+i+'.bin'}))})}:
    {async:async()=>row.sources[Number(name.match(/\d+/)[0])].bytes}};
  }}};
 const context={window,document,console:{error:(...args)=>f.errors.push(args),warn(){},log(){}},Blob,File,Uint8Array,ArrayBuffer,Map,Set,Date,Error,
  structuredClone,TextEncoder,TextDecoder,crypto:webcrypto,queueMicrotask,
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},
  URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},
  Image:class{set src(value){this.naturalWidth=20;this.naturalHeight=30;queueMicrotask(()=>this.onload?.())}},
  setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),
  requestAnimationFrame:fn=>fn(),getComputedStyle:()=>({display:'block'}),fetch:()=>{throw Error('Network prohibited')}};
 vm.createContext(context);vm.runInContext(source.replace(boot,expose),context,{filename:'production-new-letter.js'});
 const api=window.__operations;f.api=api;
 api.configure({toast:text=>messages.push(text),
  transaction:async(mode,operation)=>{
   let row;operation({put:value=>{row=structuredClone(value);return{}}});
   if(row?.id==='SYNTHETIC_STAFF|student:A'&&f.outgoingGate){
    const gate=f.outgoingGate;f.outgoingGate=null;await gate.promise;
   }
   if(row?.id==='SYNTHETIC_STAFF|student:B'&&f.commitGate)await f.commitGate.promise;
   if(row?.id==='SYNTHETIC_STAFF|student:B'&&f.failCommit)throw Error('SYNTHETIC COMMIT FAILURE');
   if(row){rows.set(row.id,row);writes.push(row.id)}
  },
  putAsset:async asset=>{if(f.assetGate)await f.assetGate.promise;assets.set(asset.id,asset)},
  deleteAsset:async id=>{if(f.assetGate)await f.assetGate.promise;assets.delete(id)},
  pdfLibraries:async()=>{const gate=f.nextLibraryGate;f.nextLibraryGate=null;if(gate)await gate.promise},
  render:async()=>{},
 });
 api.state.linkedData={studentId:'A',studentName:'SYNTHETIC A'};api.resetHistory();
 f.flush=async()=>{const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks){callback();await tick()}};
 return f;
}
function draftB(){return{owner:'SYNTHETIC_STAFF',version:1,caseKey:'student:B',id:'SYNTHETIC_STAFF|student:B',
 sources:[{key:'sourceB',kind:'image',mime:'image/png',bytes:new Uint8Array([9,8,7])}],
 pages:[{id:'pageB',kind:'image',sourceKey:'sourceB',sourcePage:1,crop:{top:0,right:0,bottom:0,left:0},rotation:0,transform:{scale:1,xMM:0,yMM:0}}],
 linkedData:{studentId:'B',studentName:'SYNTHETIC B'},selected:['pageB'],activeId:'pageB',settings:{safeArea:false,duplicateDetection:true}}}
async function drainScenario(label,start,{reject=false}={}){
 const f=fixture(),job=start(f);await tick();
 assert.equal(f.api.status().active,1,label+' must hold one outer lease');
 let finished=false;
 f.commitGate=deferred();
 const replacing=f.api.reviewImportDraft({kind:'DRAFT',row:draftB()}).then(()=>{finished=true});
 await tick();
 assert.equal(f.api.status().installing,false,label+' must finish before candidate installation');
 assert.equal(f.api.state.linkedData.studentId,'A');
 // New independent operations are rejected visibly while the replacement is queued.
 const before=f.api.state.pages.length;
 await f.api.addFiles([{name:'SHOULD_NOT_START.pdf',type:'application/pdf',arrayBuffer:async()=>new ArrayBuffer(2)}]);
 assert.equal(f.api.state.pages.length,before);assert(f.messages.some(text=>text.includes('being restored')));
 job.release();await job.done;await tick();await tick();
 assert.equal(f.api.status().active,0);
 assert.equal(f.api.status().installing,true);
 assert.equal(f.api.state.linkedData.studentId,'B');
 assert.equal(f.api.state.pages.length,1);
 assert(f.rows.has('SYNTHETIC_STAFF|student:A'),label+' must preserve the completed outgoing work');
 const original=f.rows.get('SYNTHETIC_STAFF|student:A');
 assert.equal(original.linkedData.studentId,'A');
 if(job.checkOutgoing)job.checkOutgoing(original,f);
 if(reject){
  f.failCommit=true;f.commitGate.resolve();
  await assert.rejects(replacing,/SYNTHETIC COMMIT FAILURE/);
  assert.equal(f.api.state.linkedData.studentId,'A');
  assert.equal(f.api.state.pages.length,original.pages.length);
  assert(!f.rows.has('SYNTHETIC_STAFF|student:B'));
 }else{
  f.commitGate.resolve();await replacing;
  assert.equal(f.api.state.pages.length,1);
  assert.equal(f.rows.get('SYNTHETIC_STAFF|student:B').pages.length,1);
  assert.equal(finished,true);
 }
 assert.equal(f.api.status().replacing,false);assert.equal(f.api.status().paused,0);
 assert.equal(f.api.status().installing,false);
 console.log('PASS',label,reject?'rollback':'successful replacement');
 return f;
}
function pdfStart(f){const gate=deferred();return{
 done:f.api.addFiles([{name:'STUDENT_A.pdf',type:'application/pdf',arrayBuffer:()=>gate.promise}]),
 release:()=>gate.resolve(new Uint8Array([37,80,68,70]).buffer),
 checkOutgoing:row=>assert(row.pages.some(page=>page.fileName==='STUDENT_A.pdf'))}}
function zipStart(f){const gate=deferred();return{
 done:f.api.addFiles([{kind:'FILES',name:'STUDENT_A.zip',type:'application/zip',gate}]),release:()=>gate.resolve(),
 checkOutgoing:row=>assert(row.pages.some(page=>page.fileName==='A.pdf'))}}
function assetStart(f,remove=false){const gate=deferred();f.assetGate=gate;
 if(remove)f.api.state.assets.front={id:'front',name:'OLD.png',type:'image/png',blob:new Blob(['old'])};
 return{done:remove?f.api.removeAsset('front'):f.api.importAsset('front',new File(['image'],'A.png',{type:'image/png'})),
  release:()=>{f.assetGate=null;gate.resolve()},
  checkOutgoing:(_row,fixture)=>assert.equal(fixture.api.state.assets.front===null,remove)}}
function historyStart(f){
 const prior=f.api.snapshot();prior.linkedData={studentId:'A',studentName:'A RESTORED'};
 f.api.state.history.undo.push(prior);const gate=deferred();f.nextLibraryGate=gate;
 return{done:f.api.undoEdit(),release:()=>gate.resolve(),
  checkOutgoing:row=>assert.equal(row.linkedData.studentName,'A RESTORED')}}
(async()=>{
 await drainScenario('PDF file read',pdfStart);
 await drainScenario('PDF file read',pdfStart,{reject:true});
 await drainScenario('nested ZIP extraction',zipStart);
 await drainScenario('nested ZIP extraction',zipStart,{reject:true});
 await drainScenario('asset database write',f=>assetStart(f));
 await drainScenario('asset database delete',f=>assetStart(f,true),{reject:true});
 await drainScenario('history restoration',historyStart);
 await drainScenario('history restoration',historyStart,{reject:true});
 const f=fixture();f.commitGate=deferred();
 const restoring=f.api.reviewImportDraft({kind:'DRAFT',row:draftB()});await tick();await tick();
 await assert.rejects(f.api.reviewImportDraft({kind:'DRAFT',row:draftB()}),/Another draft operation/);
 f.api.applyRememberedStudentRecord({student:{student_id:'WRONG',full_name:'WRONG CASE'}});
 assert.equal(f.api.state.linkedData.studentId,'B');
 f.commitGate.resolve();await restoring;
 assert.equal(f.api.status().replacing,false);
 console.log('PASS concurrent replacement rejection and external Student DB selection guard');
 await f.api.addFiles([{name:'AFTER.pdf',type:'application/pdf',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}]);
 assert.equal(f.api.state.pages.length,2);assert.equal(f.api.status().dirty,true);
 await f.flush();assert.equal(f.rows.get('SYNTHETIC_STAFF|student:B').pages.length,2);
 assert.equal(f.api.status().dirty,false);
 console.log('PASS ordinary post-replacement import and autosave');
 // A failed outgoing save must leave the original case active and release the barrier.
 const failed=fixture(),gate=deferred();
 const work=failed.api.addFiles([{name:'A.pdf',type:'application/pdf',arrayBuffer:()=>gate.promise}]);await tick();
 const replace=failed.api.reviewImportDraft({kind:'DRAFT',row:draftB()});await tick();
 failed.api.configure({toast:()=>{},transaction:async()=>{throw Error('storage full')},
  putAsset:async()=>{},deleteAsset:async()=>{},pdfLibraries:async()=>{},render:async()=>{}});
 gate.resolve(new Uint8Array([1,2,3]).buffer);await work;
 await assert.rejects(replace,/current work could not be saved/);
 assert.equal(failed.api.state.linkedData.studentId,'A');assert.equal(failed.api.state.pages.length,1);
 assert.equal(failed.api.status().replacing,false);assert.equal(failed.api.status().dirty,true);
 console.log('PASS outgoing-save failure preserves original case and releases barrier');
 // An older save can still be pending when newly admitted file work finishes.
 // The outgoing checkpoint must take a fresh snapshot after that save drains.
 const overlap=fixture(),oldSave=deferred();overlap.outgoingGate=oldSave;
 overlap.api.reviewScheduleDraft();const older=overlap.api.reviewSaveDraft();await tick();
 const incoming=pdfStart(overlap);await tick();
 const replacement=overlap.api.reviewImportDraft({kind:'DRAFT',row:draftB()});await tick();
 incoming.release();await incoming.done;await tick();
 assert.equal(overlap.api.state.linkedData.studentId,'A');
 oldSave.resolve();await older;await replacement;
 assert(overlap.rows.get('SYNTHETIC_STAFF|student:A').pages.some(page=>page.fileName==='STUDENT_A.pdf'),
  'An older autosave must not stand in for a fresh outgoing checkpoint');
 console.log('PASS older autosave drains before saving completed outgoing file work');
 // Exercise the exact production event registrations. DOM events must not be
 // forwarded into the private lease parameter added to these async functions.
 for(const [id,name] of [['nlpdfChooseDestination','chooseDestination'],
   ['nlpdfConfirmExport','confirmExport'],['nlpdfConfirmLetterType','confirmLetterType'],
   ['nlpdfCreateEditedLetter','createEditedLetter']]){
  const pattern=new RegExp("\\$\\('#"+id+"'\\)\\.addEventListener\\('click',[^;]+;");
  const registration=source.match(pattern)?.[0];assert(registration,'Missing production click registration: '+id);
  let handler,called=false;
  vm.runInNewContext(registration,{$:()=>({addEventListener:(_event,fn)=>{handler=fn}}),
   [name]:(...args)=>{called=true;assert.equal(args.length,0,'Click event must not become '+name+' lease')}});
  handler({type:'click',isTrusted:false});assert(called);
 }
 console.log('PASS actual production click bindings do not forward DOM events as private leases');
 console.log('PASS all V8 assembled-production operation barrier regressions');
})().catch(error=>{console.error(error);process.exitCode=1});
