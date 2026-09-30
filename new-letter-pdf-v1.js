(() => {
  'use strict';

  const DB_NAME='buic-new-letter-pdf-assets-v1';
  const DB_VERSION=1;
  const STORE='assets';
  const PREF_KEY='buic-new-letter-pdf-prefs-v2';
  const NO_IEN_OVERRIDE_KEY='bu-ic-bachelor-no-ien-template-override-v1';
  const A4={width:595.28,height:841.89};
  const state={pages:[],selectedId:'',sources:new Map(),pdfJsDocs:new Map(),pdfLibDocs:new Map(),busy:false,dragId:'',pendingAsset:'',assets:{front:null,back:null,signature:null}};
  const $=(s,r=document)=>r.querySelector(s);
  const clean=v=>String(v??'').trim();
  const uid=()=> 'pdfp-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const esc=(v='')=>String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function toast(m){const e=$('#toast');if(e){e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600);}}
  function setStatus(t,k=''){const e=$('#nlpdfStatus');if(e){e.textContent=t;e.className='nlpdf-status'+(k?' '+k:'');}}
  function safePath(v){return clean(v).replace(/[<>:"/\\|?*\x00-\x1F]/g,'').replace(/[. ]+$/g,'').trim();}
  function safeFile(v){return safePath(v).slice(0,140)||'Student';}

  function loadScript(src,test){
    if(test())return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const abs=new URL(src,location.href).href;
      const old=[...document.scripts].find(s=>s.src===abs);
      if(old){old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return;}
      const s=document.createElement('script');s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>reject(new Error('Could not load PDF library.'));document.head.appendChild(s);
    });
  }
  async function ensureLibraries(){
    setStatus('Loading PDF tools…','busy');
    await Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',()=>Boolean(window.PDFLib)),
      loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',()=>Boolean(window.pdfjsLib))
    ]);
    if(window.pdfjsLib)window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    setStatus(state.pages.length?'Ready.':'Files stay in this browser. Nothing is uploaded.');
  }

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
  }
  async function dbGet(id){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
  async function dbPut(record){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(record);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
  async function dbDelete(id){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}

  function prefs(){
    try{return Object.assign({includeFront:true,includeBack:true,applySignature:false,signatureScope:'last',signaturePosition:'bottom-right',signatureSize:'medium',package:false},JSON.parse(localStorage.getItem(PREF_KEY)||'{}'));}catch{return {includeFront:true,includeBack:true,applySignature:false,signatureScope:'last',signaturePosition:'bottom-right',signatureSize:'medium',package:false};}
  }
  function savePrefs(){
    const p={
      includeFront:Boolean($('#nlpdfUseFront')?.checked),
      includeBack:Boolean($('#nlpdfUseBack')?.checked),
      applySignature:Boolean($('#nlpdfUseSignature')?.checked),
      signatureScope:$('#nlpdfSignatureScope')?.value||'last',
      signaturePosition:$('#nlpdfSignaturePosition')?.value||'bottom-right',
      signatureSize:$('#nlpdfSignatureSize')?.value||'medium',
      package:Boolean($('#nlpdfPackage')?.checked)
    };
    try{localStorage.setItem(PREF_KEY,JSON.stringify(p));}catch{}
  }

  function cardMarkup(){
    return '<article class="workspace-feature-card new-letter-pdf-card" id="newLetterPdfCard"><div class="feature-icon">▣</div><h2>PDF Tools</h2><p>Build the final student document package: arrange PDF/image pages, keep default front/back documents, add a saved signature, and optionally create the student folder + Word letter + PDF together.</p><div class="feature-actions"><button class="primary-btn" id="openNewLetterPdfTools" type="button">Open PDF Tools</button></div><span class="nlpdf-local-note">Local processing · defaults remembered in this browser</span></article>';
  }
  function workspaceMarkup(){
    const p=prefs();
    return '<section class="new-letter-pdf-workspace hidden" id="newLetterPdfWorkspace" aria-label="PDF Tools">'+
      '<div class="nlpdf-head"><div class="nlpdf-head-copy"><span class="nlpdf-kicker">PDF TOOLS · NEW LETTER</span><h2>Build the final document package</h2><p>Import the finalized letter PDF and supporting documents, arrange pages, add saved defaults, then export only the PDF or create the complete student folder package.</p></div><div class="nlpdf-head-actions"><button class="secondary-btn compact" id="nlpdfAddFiles" type="button">+ Add files</button><button class="ghost-btn compact" id="nlpdfClose" type="button">Close</button></div></div>'+
      '<div class="nlpdf-body"><aside class="nlpdf-sidebar">'+
        '<button class="nlpdf-drop" id="nlpdfDrop" type="button"><div><strong>Drop PDF or images here</strong><span>PDF · JPG · PNG · WebP<br>or click to choose files</span></div></button>'+
        '<input class="nlpdf-file-input" id="nlpdfFileInput" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" multiple>'+
        '<input class="nlpdf-asset-input" id="nlpdfAssetInput" type="file">'+
        '<div class="nlpdf-sidebar-section"><span class="nlpdf-sidebar-label">Student package</span>'+
          '<div class="nlpdf-student-grid"><label class="nlpdf-field"><span>Number</span><input id="nlpdfStudentNumber" autocomplete="off" placeholder="3408"></label><label class="nlpdf-field"><span>Name</span><input id="nlpdfStudentName" autocomplete="off" placeholder="Miss ABC"></label></div>'+
          '<label class="nlpdf-field"><span>Letter type</span><select id="nlpdfLetterType"><option value="bachelor_no_ien">Bachelor Degree No IEN</option><option value="bachelor">Bachelor Degree</option><option value="current_no_ien">Current No IEN</option><option value="exchange">Exchange Bachelor</option><option value="master">Master Degree</option><option value="doctor">Doctor Degree</option></select></label>'+
          '<label class="nlpdf-field"><span>PDF filename</span><input class="nlpdf-filename" id="nlpdfFilename" autocomplete="off"></label>'+
          '<div class="nlpdf-package-preview"><div class="nlpdf-preview-row"><span>Folder</span><strong id="nlpdfFolderPreview"></strong></div><div class="nlpdf-preview-row"><span>Letter</span><strong id="nlpdfLetterPreview"></strong></div><div class="nlpdf-preview-row"><span>PDF</span><strong id="nlpdfPdfPreview"></strong></div></div>'+
        '</div>'+
        '<div class="nlpdf-assets"><div class="nlpdf-assets-head"><strong>Default assets</strong><span>Saved in this browser</span></div>'+
          assetRow('front','Front document',p.includeFront)+assetRow('back','Back document',p.includeBack)+assetRow('signature','Signature',p.applySignature,true)+
          '<div class="nlpdf-signature-options"><label class="nlpdf-field"><span>Signature on</span><select id="nlpdfSignatureScope"><option value="last">Last document page</option><option value="all">All document pages</option></select></label><label class="nlpdf-field"><span>Position</span><select id="nlpdfSignaturePosition"><option value="bottom-right">Bottom right</option><option value="bottom-center">Bottom center</option><option value="bottom-left">Bottom left</option></select></label><label class="nlpdf-field"><span>Size</span><select id="nlpdfSignatureSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label></div>'+
        '</div>'+
        '<label class="nlpdf-export-option"><input id="nlpdfPackage" type="checkbox" '+(p.package?'checked':'')+'><div><strong>Create folder + Letter + PDF together</strong><span>Creates Folder [Letter_Name.docx + Documents_Name.pdf]. The student number is used only in the folder name.</span></div></label>'+
        '<div class="nlpdf-stats"><div class="nlpdf-stat"><strong id="nlpdfPageCount">0</strong><span>Document pages</span></div><div class="nlpdf-stat"><strong id="nlpdfFileCount">0</strong><span>Source files</span></div></div>'+
        '<div class="nlpdf-help"><strong>Final order</strong><br>Default Front (if enabled)<br>→ arranged document pages<br>→ Default Back (if enabled)</div>'+
      '</aside>'+
      '<div class="nlpdf-main"><div class="nlpdf-toolbar"><button class="nlpdf-tool" id="nlpdfRotateLeft" type="button" disabled title="Rotate left">↶</button><button class="nlpdf-tool" id="nlpdfRotateRight" type="button" disabled title="Rotate right">↷</button><button class="nlpdf-tool" id="nlpdfMoveUp" type="button" disabled title="Move earlier">↑</button><button class="nlpdf-tool" id="nlpdfMoveDown" type="button" disabled title="Move later">↓</button><button class="nlpdf-tool" id="nlpdfDuplicate" type="button" disabled title="Duplicate">⧉</button><button class="nlpdf-tool" id="nlpdfDelete" type="button" disabled title="Delete">⌫</button><span class="nlpdf-toolbar-spacer"></span><span class="nlpdf-selection-label" id="nlpdfSelectionLabel">No page selected</span><button class="nlpdf-tool" id="nlpdfClear" type="button" disabled>Clear all</button></div>'+
      '<div class="nlpdf-canvas-wrap"><div class="nlpdf-empty" id="nlpdfEmpty"><div><div class="nlpdf-empty-icon">▤</div><strong>No document pages yet</strong><p>Add the letter PDF and supporting documents. Default front/back pages are added automatically during export and do not need to be imported each time.</p></div></div><div class="nlpdf-pages hidden" id="nlpdfPages"></div></div>'+
      '<div class="nlpdf-footer"><div class="nlpdf-status" id="nlpdfStatus">Files stay in this browser. Nothing is uploaded.</div><button class="primary-btn nlpdf-create" id="nlpdfCreate" type="button" disabled>Create PDF</button></div></div></div></section>';
  }
  function assetRow(id,label,checked,isSignature=false){
    const inputId=id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature';
    return '<div class="nlpdf-asset-row" data-asset-row="'+id+'"><input class="nlpdf-asset-toggle" id="'+inputId+'" type="checkbox" '+(checked?'checked':'')+' disabled><div class="nlpdf-asset-copy"><strong>'+label+'</strong><span id="nlpdfAssetName_'+id+'">Not set</span></div><div class="nlpdf-asset-actions"><button class="nlpdf-mini" data-asset-import="'+id+'" type="button">'+(isSignature?'Import':'Set')+'</button><button class="nlpdf-mini remove hidden" data-asset-remove="'+id+'" type="button">×</button></div></div>';
  }

  async function loadAssets(){
    for(const id of ['front','back','signature']){
      try{state.assets[id]=await dbGet(id);}catch(err){console.warn('Could not load default asset',id,err);}
    }
    renderAssets();
  }
  function renderAssets(){
    for(const id of ['front','back','signature']){
      const a=state.assets[id],name=$('#nlpdfAssetName_'+id),remove=$('[data-asset-remove="'+id+'"]');
      const toggle=$('#'+(id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature'));
      if(name)name.textContent=a?a.name:'Not set';
      if(remove)remove.classList.toggle('hidden',!a);
      if(toggle){toggle.disabled=!a;if(!a)toggle.checked=false;}
    }
    const hasSig=Boolean(state.assets.signature);
    ['nlpdfSignatureScope','nlpdfSignaturePosition','nlpdfSignatureSize'].forEach(id=>{const e=$('#'+id);if(e)e.disabled=!hasSig;});
  }

  async function convertImageBlob(file){
    if(file.type==='image/jpeg'||file.type==='image/png')return file;
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url;});
      const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);
      return await new Promise(res=>c.toBlob(res,'image/png'));
    }finally{URL.revokeObjectURL(url);}
  }
  async function importAsset(id,file){
    if(!file)return;
    const isSig=id==='signature';
    if(isSig && !/^image\//.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('Signature must be a PNG, JPG or WebP image.');
    if(!isSig && file.type!=='application/pdf' && !/^image\//.test(file.type) && !/\.(pdf|png|jpe?g|webp)$/i.test(file.name))throw new Error('Front/back asset must be a PDF or image.');
    let blob=file,name=file.name,type=file.type||'application/octet-stream';
    if(/^image\//.test(type)&&type!=='image/png'&&type!=='image/jpeg'){blob=await convertImageBlob(file);type='image/png';name=file.name.replace(/\.[^.]+$/,'.png');}
    const rec={id,name,type,blob,updatedAt:new Date().toISOString()};
    await dbPut(rec);state.assets[id]=rec;renderAssets();
    const toggle=$('#'+(id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature'));if(toggle){toggle.disabled=false;toggle.checked=true;}
    savePrefs();toast((id==='signature'?'Signature':'Default '+id+' asset')+' saved.');
  }
  async function removeAsset(id){
    await dbDelete(id);state.assets[id]=null;renderAssets();savePrefs();toast('Default '+id+' asset removed.');
  }

  function syncPrefsToUi(){
    const p=prefs();
    if($('#nlpdfUseFront')&&!$('#nlpdfUseFront').disabled)$('#nlpdfUseFront').checked=p.includeFront;
    if($('#nlpdfUseBack')&&!$('#nlpdfUseBack').disabled)$('#nlpdfUseBack').checked=p.includeBack;
    if($('#nlpdfUseSignature')&&!$('#nlpdfUseSignature').disabled)$('#nlpdfUseSignature').checked=p.applySignature;
    if($('#nlpdfSignatureScope'))$('#nlpdfSignatureScope').value=p.signatureScope;
    if($('#nlpdfSignaturePosition'))$('#nlpdfSignaturePosition').value=p.signaturePosition;
    if($('#nlpdfSignatureSize'))$('#nlpdfSignatureSize').value=p.signatureSize;
    if($('#nlpdfPackage'))$('#nlpdfPackage').checked=p.package;
  }

  function currentCaseNumber(){return clean($('#caseStudentNumber')?.value)||clean($('#studentNumber')?.value);}
  function currentCaseName(){return clean($('#caseStudentName')?.value)||clean($('#studentName')?.value);}
  function syncStudent(force=false){
    const n=$('#nlpdfStudentNumber'),name=$('#nlpdfStudentName');
    if(n&&(force||!clean(n.value)))n.value=currentCaseNumber();
    if(name&&(force||!clean(name.value)))name.value=currentCaseName();
    syncNames();
  }
  function syncNames(){
    const number=safePath($('#nlpdfStudentNumber')?.value)||'3408';
    const name=safePath($('#nlpdfStudentName')?.value)||'Miss ABC';
    const pdf=$('#nlpdfFilename');
    if(pdf && (!clean(pdf.value)||pdf.dataset.auto==='1')){pdf.value='Documents_'+name+'.pdf';pdf.dataset.auto='1';}
    if($('#nlpdfFolderPreview'))$('#nlpdfFolderPreview').textContent=number+' '+name;
    if($('#nlpdfLetterPreview'))$('#nlpdfLetterPreview').textContent='Letter_'+name+'.docx';
    if($('#nlpdfPdfPreview'))$('#nlpdfPdfPreview').textContent=clean(pdf?.value)||('Documents_'+name+'.pdf');
  }

  function selectedPage(){return state.pages.find(p=>p.id===state.selectedId)||null;}
  function updateControls(){
    const p=selectedPage(),i=p?state.pages.findIndex(x=>x.id===p.id):-1;
    ['nlpdfRotateLeft','nlpdfRotateRight','nlpdfDuplicate','nlpdfDelete'].forEach(id=>{const e=$('#'+id);if(e)e.disabled=!p||state.busy;});
    if($('#nlpdfMoveUp'))$('#nlpdfMoveUp').disabled=!p||i<=0||state.busy;
    if($('#nlpdfMoveDown'))$('#nlpdfMoveDown').disabled=!p||i<0||i>=state.pages.length-1||state.busy;
    if($('#nlpdfClear'))$('#nlpdfClear').disabled=!state.pages.length||state.busy;
    if($('#nlpdfCreate'))$('#nlpdfCreate').disabled=!state.pages.length||state.busy;
    if($('#nlpdfSelectionLabel'))$('#nlpdfSelectionLabel').textContent=p?'Page '+(i+1)+' · '+p.fileName+(p.kind==='pdf'?' · source p.'+p.sourcePage:''):'No page selected';
    if($('#nlpdfPageCount'))$('#nlpdfPageCount').textContent=state.pages.length;
    if($('#nlpdfFileCount'))$('#nlpdfFileCount').textContent=state.sources.size;
  }

  async function thumbForPdf(page){
    const doc=state.pdfJsDocs.get(page.sourceKey);if(!doc)return null;
    const pp=await doc.getPage(page.sourcePage),base=pp.getViewport({scale:1}),scale=Math.min(1,190/base.width),vp=pp.getViewport({scale});
    const c=document.createElement('canvas'),ctx=c.getContext('2d',{alpha:false});c.width=Math.max(1,Math.floor(vp.width));c.height=Math.max(1,Math.floor(vp.height));
    await pp.render({canvasContext:ctx,viewport:vp}).promise;return c;
  }
  async function renderPages(){
    const c=$('#nlpdfPages'),empty=$('#nlpdfEmpty');if(!c||!empty)return;
    empty.classList.toggle('hidden',state.pages.length>0);c.classList.toggle('hidden',state.pages.length===0);
    c.innerHTML=state.pages.map((p,i)=>'<article class="nlpdf-page-card '+(p.id===state.selectedId?'selected':'')+'" data-page-id="'+esc(p.id)+'" draggable="true"><div class="nlpdf-thumb" style="--page-rotation:'+(p.rotation||0)+'deg"><span class="nlpdf-page-index">'+(i+1)+'</span>'+(p.rotation?'<span class="nlpdf-page-rotation">'+p.rotation+'°</span>':'')+'<div class="nlpdf-thumb-loading">Loading preview…</div></div><div class="nlpdf-page-meta"><strong>'+esc(p.fileName)+'</strong><span>'+(p.kind==='pdf'?'PDF · page '+p.sourcePage:'Image · A4 fit')+'</span></div></article>').join('');
    updateControls();
    for(const p of state.pages){
      const card=c.querySelector('[data-page-id="'+CSS.escape(p.id)+'"]'),holder=card?.querySelector('.nlpdf-thumb');if(!holder)continue;
      try{let v;if(p.kind==='pdf')v=await thumbForPdf(p);else{v=document.createElement('img');v.src=p.previewUrl;v.alt='';}if(!card.isConnected)continue;holder.querySelector('.nlpdf-thumb-loading')?.remove();holder.appendChild(v);}catch{const l=holder.querySelector('.nlpdf-thumb-loading');if(l)l.textContent='Preview unavailable';}
    }
  }
  async function normalizeImage(file){
    if(file.type==='image/jpeg'||/\.jpe?g$/i.test(file.name))return{mime:'image/jpeg',bytes:new Uint8Array(await file.arrayBuffer()),previewUrl:URL.createObjectURL(file)};
    if(file.type==='image/png'||/\.png$/i.test(file.name))return{mime:'image/png',bytes:new Uint8Array(await file.arrayBuffer()),previewUrl:URL.createObjectURL(file)};
    const blob=await convertImageBlob(file);return{mime:'image/png',bytes:new Uint8Array(await blob.arrayBuffer()),previewUrl:URL.createObjectURL(blob)};
  }
  async function importFile(file){
    const key=uid();
    if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
      const bytes=new Uint8Array(await file.arrayBuffer()),doc=await window.pdfjsLib.getDocument({data:bytes.slice()}).promise;
      state.sources.set(key,{key,fileName:file.name,kind:'pdf',bytes});state.pdfJsDocs.set(key,doc);
      for(let n=1;n<=doc.numPages;n++)state.pages.push({id:uid(),sourceKey:key,fileName:file.name,kind:'pdf',sourcePage:n,rotation:0});
      return doc.numPages;
    }
    if(/^image\//.test(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name)){
      const im=await normalizeImage(file);state.sources.set(key,{key,fileName:file.name,kind:'image',bytes:im.bytes,mime:im.mime,previewUrl:im.previewUrl});state.pages.push({id:uid(),sourceKey:key,fileName:file.name,kind:'image',rotation:0,previewUrl:im.previewUrl});return 1;
    }
    throw new Error(file.name+' is not a supported PDF or image.');
  }
  async function addFiles(files){
    const list=[...files];if(!list.length)return;state.busy=true;updateControls();setStatus('Importing '+list.length+' file'+(list.length===1?'':'s')+'…','busy');
    try{await ensureLibraries();let added=0;for(const f of list){try{added+=await importFile(f);}catch(err){console.error(err);toast(err.message||('Could not import '+f.name));}}if(!state.selectedId&&state.pages[0])state.selectedId=state.pages[0].id;await renderPages();setStatus('Added '+added+' page'+(added===1?'':'s')+'. Drag thumbnails to reorder.');}
    finally{state.busy=false;updateControls();}
  }
  function rotateSelected(d){const p=selectedPage();if(p){p.rotation=((p.rotation||0)+d+360)%360;renderPages();}}
  function moveSelected(d){const i=state.pages.findIndex(p=>p.id===state.selectedId),j=i+d;if(i<0||j<0||j>=state.pages.length)return;[state.pages[i],state.pages[j]]=[state.pages[j],state.pages[i]];renderPages();}
  function duplicateSelected(){const i=state.pages.findIndex(p=>p.id===state.selectedId);if(i<0)return;const cp={...state.pages[i],id:uid()};state.pages.splice(i+1,0,cp);state.selectedId=cp.id;renderPages();}
  function deleteSelected(){const i=state.pages.findIndex(p=>p.id===state.selectedId);if(i<0)return;state.pages.splice(i,1);state.selectedId=state.pages[Math.min(i,state.pages.length-1)]?.id||'';renderPages();}
  function clearAll(){if(state.pages.length&&!confirm('Clear all imported document pages?'))return;for(const s of state.sources.values())if(s.previewUrl)URL.revokeObjectURL(s.previewUrl);state.pages=[];state.selectedId='';state.sources.clear();state.pdfJsDocs.clear();state.pdfLibDocs.clear();renderPages();setStatus('Document pages cleared. Default assets are kept.');}
  function reorderByDrop(a,b){if(!a||!b||a===b)return;const from=state.pages.findIndex(p=>p.id===a),to=state.pages.findIndex(p=>p.id===b);if(from<0||to<0)return;const item=state.pages.splice(from,1)[0];state.pages.splice(to,0,item);renderPages();}

  async function sourcePdfDoc(k){if(state.pdfLibDocs.has(k))return state.pdfLibDocs.get(k);const s=state.sources.get(k),d=await window.PDFLib.PDFDocument.load(s.bytes.slice());state.pdfLibDocs.set(k,d);return d;}
  async function embedImage(out,bytes,mime){return mime==='image/jpeg'?await out.embedJpg(bytes):await out.embedPng(bytes);}
  async function addImagePage(out,bytes,mime,rotation=0){
    const img=await embedImage(out,bytes,mime),pg=out.addPage([A4.width,A4.height]),m=28,maxW=A4.width-m*2,maxH=A4.height-m*2,d=img.scale(1),scale=Math.min(maxW/d.width,maxH/d.height),w=d.width*scale,h=d.height*scale;
    pg.drawImage(img,{x:(A4.width-w)/2,y:(A4.height-h)/2,width:w,height:h});if(rotation)pg.setRotation(window.PDFLib.degrees(rotation));return pg;
  }
  async function appendDefaultAsset(out,asset){
    if(!asset)return 0;const bytes=new Uint8Array(await asset.blob.arrayBuffer());
    if(asset.type==='application/pdf'||/\.pdf$/i.test(asset.name)){const src=await window.PDFLib.PDFDocument.load(bytes),indices=src.getPageIndices(),pages=await out.copyPages(src,indices);pages.forEach(p=>out.addPage(p));return pages.length;}
    await addImagePage(out,bytes,asset.type||'image/png',0);return 1;
  }
  async function signatureEmbed(out){
    const a=state.assets.signature;if(!a)return null;const bytes=new Uint8Array(await a.blob.arrayBuffer());return embedImage(out,bytes,a.type||'image/png');
  }
  function drawSignature(page,img){
    if(!img)return;const pos=$('#nlpdfSignaturePosition')?.value||'bottom-right',size=$('#nlpdfSignatureSize')?.value||'medium',ratio=size==='small'?.16:size==='large'?.30:.23;
    const w=page.getWidth()*ratio,d=img.scale(1),h=w*(d.height/d.width),m=34;
    let x=m;if(pos==='bottom-right')x=page.getWidth()-w-m;else if(pos==='bottom-center')x=(page.getWidth()-w)/2;
    page.drawImage(img,{x,y:m,width:w,height:h,opacity:.98});
  }

  function customNoIenTemplate(){
    try{const e=JSON.parse(localStorage.getItem(NO_IEN_OVERRIDE_KEY)||'null');if(e&&typeof e.base64==='string'&&e.base64.length>100)return e;}catch{}return null;
  }
  function letterTemplateBytes(key){
    const t=(key==='bachelor_no_ien'?customNoIenTemplate():null)||window.LETTER_TEMPLATES?.[key];
    if(!t||!t.base64)throw new Error('Selected Word template is missing.');
    const bin=atob(t.base64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;
  }

  async function buildPdfBytes(){
    await ensureLibraries();const out=await window.PDFLib.PDFDocument.create();
    if($('#nlpdfUseFront')?.checked&&state.assets.front){setStatus('Adding default front document…','busy');await appendDefaultAsset(out,state.assets.front);}
    const applySig=$('#nlpdfUseSignature')?.checked&&state.assets.signature,sig=applySig?await signatureEmbed(out):null,scope=$('#nlpdfSignatureScope')?.value||'last';
    for(let i=0;i<state.pages.length;i++){
      const item=state.pages[i];setStatus('Creating document page '+(i+1)+' of '+state.pages.length+'…','busy');
      let pg;
      if(item.kind==='pdf'){const src=await sourcePdfDoc(item.sourceKey),copied=(await out.copyPages(src,[item.sourcePage-1]))[0],existing=copied.getRotation()?.angle||0;if(item.rotation)copied.setRotation(window.PDFLib.degrees((existing+item.rotation)%360));out.addPage(copied);pg=copied;}
      else{const s=state.sources.get(item.sourceKey);pg=await addImagePage(out,s.bytes,s.mime,item.rotation||0);}
      if(sig&&(scope==='all'||i===state.pages.length-1))drawSignature(pg,sig);
    }
    if($('#nlpdfUseBack')?.checked&&state.assets.back){setStatus('Adding default back document…','busy');await appendDefaultAsset(out,state.assets.back);}
    out.setCreator('BU International Center Workspace');out.setProducer('New Letter PDF Tools');return new Uint8Array(await out.save());
  }
  async function fileExists(dir,name){try{await dir.getFileHandle(name,{create:false});return true;}catch(err){if(err?.name==='NotFoundError')return false;throw err;}}
  async function writeToDir(dir,name,data){
    const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(data);await w.close();
  }
  async function createPackage(pdfBytes){
    if(!window.showDirectoryPicker)throw new Error('Folder package creation requires Chrome or Edge with folder access.');
    const number=safePath($('#nlpdfStudentNumber')?.value),name=safePath($('#nlpdfStudentName')?.value);
    if(!number)throw new Error('Enter the student number before creating a folder package.');if(!name)throw new Error('Enter the student name before creating a folder package.');
    const parent=await window.showDirectoryPicker({mode:'readwrite'}),folderName=number+' '+name,letterName='Letter_'+name+'.docx';
    let pdfName=safeFile($('#nlpdfFilename')?.value||('Documents_'+name+'.pdf'));if(!/\.pdf$/i.test(pdfName))pdfName+='.pdf';
    const folder=await parent.getDirectoryHandle(folderName,{create:true});
    const existing=[];if(await fileExists(folder,letterName))existing.push(letterName);if(await fileExists(folder,pdfName))existing.push(pdfName);
    if(existing.length&&!confirm(existing.join(' and ')+' already exist in '+folderName+'. Replace them?'))return false;
    const letterBytes=letterTemplateBytes($('#nlpdfLetterType')?.value||'bachelor_no_ien');
    await writeToDir(folder,letterName,new Blob([letterBytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
    await writeToDir(folder,pdfName,new Blob([pdfBytes],{type:'application/pdf'}));
    setStatus('Created '+folderName+' with '+letterName+' and '+pdfName+'.');toast('Student folder package created.');return true;
  }
  function downloadPdf(bytes){
    const name=safePath($('#nlpdfStudentName')?.value)||'Student';let pdfName=safeFile($('#nlpdfFilename')?.value||('Documents_'+name+'.pdf'));if(!/\.pdf$/i.test(pdfName))pdfName+='.pdf';
    const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=pdfName;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);setStatus('Created '+pdfName+'.');toast('PDF created.');
  }
  async function createOutput(){
    if(!state.pages.length||state.busy)return;state.busy=true;updateControls();savePrefs();
    try{const bytes=await buildPdfBytes();if($('#nlpdfPackage')?.checked)await createPackage(bytes);else downloadPdf(bytes);}
    catch(err){if(err?.name==='AbortError'){setStatus('Folder selection cancelled.');}else{console.error(err);setStatus('Could not create output: '+(err.message||err),'error');toast(err.message||'Could not create output.');}}
    finally{state.busy=false;updateControls();}
  }

  function openTools(){
    const w=$('#newLetterPdfWorkspace');if(!w)return;w.classList.remove('hidden');syncStudent(false);w.scrollIntoView({behavior:'smooth',block:'start'});
    ensureLibraries().catch(err=>setStatus(err.message,'error'));
  }
  function closeTools(){$('#newLetterPdfWorkspace')?.classList.add('hidden');}

  async function build(){
    const docs=$('#workspaceDocuments'),grid=docs?.querySelector('.document-workspace-grid');if(!docs||!grid)return;
    if(!$('#newLetterPdfCard'))grid.insertAdjacentHTML('beforeend',cardMarkup());
    if(!$('#newLetterPdfWorkspace'))grid.insertAdjacentHTML('afterend',workspaceMarkup());

    await loadAssets();syncPrefsToUi();syncStudent(true);syncNames();renderPages();

    $('#openNewLetterPdfTools')?.addEventListener('click',openTools);$('#nlpdfClose')?.addEventListener('click',closeTools);
    $('#nlpdfAddFiles')?.addEventListener('click',()=>$('#nlpdfFileInput')?.click());$('#nlpdfDrop')?.addEventListener('click',()=>$('#nlpdfFileInput')?.click());
    $('#nlpdfFileInput')?.addEventListener('change',e=>{addFiles(e.target.files);e.target.value='';});
    $('#nlpdfStudentNumber')?.addEventListener('input',syncNames);$('#nlpdfStudentName')?.addEventListener('input',()=>{const pdf=$('#nlpdfFilename');if(pdf)pdf.dataset.auto='1';syncNames();});
    $('#nlpdfFilename')?.addEventListener('input',e=>{e.target.dataset.auto='0';syncNames();});
    ['nlpdfUseFront','nlpdfUseBack','nlpdfUseSignature','nlpdfPackage','nlpdfSignatureScope','nlpdfSignaturePosition','nlpdfSignatureSize'].forEach(id=>$('#'+id)?.addEventListener('change',savePrefs));

    document.querySelectorAll('[data-asset-import]').forEach(b=>b.addEventListener('click',()=>{state.pendingAsset=b.dataset.assetImport;const input=$('#nlpdfAssetInput');input.accept=state.pendingAsset==='signature'?'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp':'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp';input.click();}));
    document.querySelectorAll('[data-asset-remove]').forEach(b=>b.addEventListener('click',()=>removeAsset(b.dataset.assetRemove).catch(err=>toast(err.message))));
    $('#nlpdfAssetInput')?.addEventListener('change',async e=>{const f=e.target.files?.[0];try{if(f&&state.pendingAsset)await importAsset(state.pendingAsset,f);}catch(err){console.error(err);toast(err.message||'Could not save asset.');}finally{e.target.value='';state.pendingAsset='';}});

    $('#nlpdfRotateLeft')?.addEventListener('click',()=>rotateSelected(-90));$('#nlpdfRotateRight')?.addEventListener('click',()=>rotateSelected(90));$('#nlpdfMoveUp')?.addEventListener('click',()=>moveSelected(-1));$('#nlpdfMoveDown')?.addEventListener('click',()=>moveSelected(1));$('#nlpdfDuplicate')?.addEventListener('click',duplicateSelected);$('#nlpdfDelete')?.addEventListener('click',deleteSelected);$('#nlpdfClear')?.addEventListener('click',clearAll);$('#nlpdfCreate')?.addEventListener('click',createOutput);

    const drop=$('#nlpdfDrop');['dragenter','dragover'].forEach(t=>drop?.addEventListener(t,e=>{e.preventDefault();drop.classList.add('dragover');}));['dragleave','drop'].forEach(t=>drop?.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('dragover');}));drop?.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
    const pages=$('#nlpdfPages');pages?.addEventListener('click',e=>{const card=e.target.closest('[data-page-id]');if(card){state.selectedId=card.dataset.pageId;renderPages();}});pages?.addEventListener('dragstart',e=>{const card=e.target.closest('[data-page-id]');if(card){state.dragId=card.dataset.pageId;card.classList.add('dragging');e.dataTransfer.effectAllowed='move';}});pages?.addEventListener('dragend',e=>{e.target.closest('[data-page-id]')?.classList.remove('dragging');pages.querySelectorAll('.drag-target').forEach(x=>x.classList.remove('drag-target'));state.dragId='';});pages?.addEventListener('dragover',e=>{const card=e.target.closest('[data-page-id]');if(card){e.preventDefault();pages.querySelectorAll('.drag-target').forEach(x=>x.classList.remove('drag-target'));card.classList.add('drag-target');}});pages?.addEventListener('drop',e=>{const card=e.target.closest('[data-page-id]');if(card){e.preventDefault();reorderByDrop(state.dragId,card.dataset.pageId);state.dragId='';}});

    ['caseStudentNumber','caseStudentName','studentNumber','studentName'].forEach(id=>$('#'+id)?.addEventListener('input',()=>syncStudent(false)));
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>build().catch(console.error),{once:true});else build().catch(console.error);
})();