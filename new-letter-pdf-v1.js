(() => {
  'use strict';

  const DB_NAME='buic-new-letter-pdf-assets-v1';
  const DB_VERSION=1;
  const STORE='assets';
  const PREF_KEY='buic-new-letter-pdf-prefs-v3';
  const NO_IEN_OVERRIDE_KEY='bu-ic-bachelor-no-ien-template-override-v1';
  const A4={width:595.28,height:841.89};
  const state={
    pages:[], selected:new Set(), activeKey:'', anchorIndex:-1,
    sources:new Map(), pdfJsDocs:new Map(), pdfLibDocs:new Map(),
    assetPdfJsDocs:new Map(), assetEntries:[],
    assets:{front:null,back:null,signature:null},
    busy:false, dragId:'', pendingAsset:''
  };
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const clean=v=>String(v??'').trim();
  const uid=()=> 'p-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const esc=(v='')=>String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

  function toast(m){const e=$('#toast');if(e){e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600);}}
  function setStatus(t,k=''){const e=$('#nlpdfStatus');if(e){e.textContent=t;e.className='nlpdf-status'+(k?' '+k:'');}}
  function safePath(v){return clean(v).replace(/[<>:"/\\|?*\x00-\x1F]/g,'').replace(/[. ]+$/g,'').trim();}
  function safeFile(v){return safePath(v).slice(0,140)||'Student';}
  function defaultCrop(){return {top:0,right:0,bottom:0,left:0};}
  function defaultSpace(){return {bottomMM:0};}

  function loadScript(src,test){
    if(test())return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const abs=new URL(src,location.href).href,old=[...document.scripts].find(s=>s.src===abs);
      if(old){if(test())return resolve();old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return;}
      const s=document.createElement('script');s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>reject(new Error('Could not load required library.'));document.head.appendChild(s);
    });
  }
  async function ensurePdfLibs(){
    await Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',()=>Boolean(window.PDFLib)),
      loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',()=>Boolean(window.pdfjsLib))
    ]);
    if(window.pdfjsLib)window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }
  async function ensureZip(){await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',()=>Boolean(window.JSZip));}

  function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function dbGet(id){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
  async function dbPut(record){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(record);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
  async function dbDelete(id){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}

  function prefs(){try{return Object.assign({includeFront:true,includeBack:true,applySignature:false,signatureScope:'last',signaturePosition:'bottom-right',signatureSize:'medium',package:false},JSON.parse(localStorage.getItem(PREF_KEY)||'{}'));}catch{return {includeFront:true,includeBack:true,applySignature:false,signatureScope:'last',signaturePosition:'bottom-right',signatureSize:'medium',package:false};}}
  function savePrefs(){
    const p={includeFront:Boolean($('#nlpdfUseFront')?.checked),includeBack:Boolean($('#nlpdfUseBack')?.checked),applySignature:Boolean($('#nlpdfUseSignature')?.checked),signatureScope:$('#nlpdfSignatureScope')?.value||'last',signaturePosition:$('#nlpdfSignaturePosition')?.value||'bottom-right',signatureSize:$('#nlpdfSignatureSize')?.value||'medium',package:Boolean($('#nlpdfPackage')?.checked)};
    try{localStorage.setItem(PREF_KEY,JSON.stringify(p));}catch{}
  }

  function oldCreateFolder(){document.querySelector('#documentsCreateFolder')?.click();}
  function mainHeaderMarkup(){
    return '<div class="nlpdf-primary-head" id="nlpdfPrimaryHead"><div><div class="hero-eyebrow">NEW LETTER</div><h1>Build the student document package.</h1><p>Arrange, inspect, crop and prepare the final PDF first. Create Folder remains available as a secondary workflow when you only need the Word folder setup.</p></div><div class="nlpdf-subnav"><button class="active" type="button">PDF Builder</button><button class="secondary" id="nlpdfOpenCreateFolder" type="button">Create Folder</button></div></div>';
  }
  function assetRow(id,label,checked,isSignature=false){
    const inputId=id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature';
    return '<div class="nlpdf-asset-row" data-asset-row="'+id+'"><input class="nlpdf-asset-toggle" id="'+inputId+'" type="checkbox" '+(checked?'checked':'')+' disabled><div class="nlpdf-asset-copy"><strong>'+label+'</strong><span id="nlpdfAssetName_'+id+'">Not set</span></div><div class="nlpdf-asset-actions"><button class="nlpdf-mini" data-asset-import="'+id+'" type="button">'+(isSignature?'Import':'Set')+'</button><button class="nlpdf-mini remove hidden" data-asset-remove="'+id+'" type="button">×</button></div></div>';
  }
  function workspaceMarkup(){
    const p=prefs();
    return '<section class="new-letter-pdf-workspace" id="newLetterPdfWorkspace" aria-label="PDF Tools"><div class="nlpdf-work-grid">'+
      '<aside class="nlpdf-sidebar">'+
        '<div class="nlpdf-sidebar-title"><strong>Document setup</strong><span>Local only</span></div>'+
        '<section class="nlpdf-section"><div class="nlpdf-section-title"><strong>Student package</strong><span>Number is used only<br>for the folder</span></div>'+
          '<div class="nlpdf-student-grid"><label class="nlpdf-field"><span>Number</span><input id="nlpdfStudentNumber" autocomplete="off" placeholder="3408"></label><label class="nlpdf-field"><span>Name</span><input id="nlpdfStudentName" autocomplete="off" placeholder="Miss ABC"></label></div>'+
          '<label class="nlpdf-field"><span>Letter type</span><select id="nlpdfLetterType"><option value="bachelor_no_ien">Bachelor Degree No IEN</option><option value="bachelor">Bachelor Degree</option><option value="current_no_ien">Current No IEN</option><option value="exchange">Exchange Bachelor</option><option value="master">Master Degree</option><option value="doctor">Doctor Degree</option></select></label>'+
          '<label class="nlpdf-field"><span>PDF filename</span><input class="nlpdf-filename" id="nlpdfFilename" autocomplete="off"></label>'+
          '<div class="nlpdf-package-preview"><div class="nlpdf-preview-row"><span>Folder</span><strong id="nlpdfFolderPreview"></strong></div><div class="nlpdf-preview-row"><span>Letter</span><strong id="nlpdfLetterPreview"></strong></div><div class="nlpdf-preview-row"><span>PDF</span><strong id="nlpdfPdfPreview"></strong></div></div>'+
        '</section>'+
        '<section class="nlpdf-section"><div class="nlpdf-section-title"><strong>Default assets</strong><span>Visible in the page strip<br>when enabled</span></div><div class="nlpdf-assets">'+
          assetRow('front','Front document',p.includeFront)+assetRow('back','Back document',p.includeBack)+assetRow('signature','Signature',p.applySignature,true)+
          '<div class="nlpdf-signature-options"><label class="nlpdf-field"><span>Signature on</span><select id="nlpdfSignatureScope"><option value="last">Last document page</option><option value="all">All document pages</option></select></label><label class="nlpdf-field"><span>Position</span><select id="nlpdfSignaturePosition"><option value="bottom-right">Bottom right</option><option value="bottom-center">Bottom center</option><option value="bottom-left">Bottom left</option></select></label><label class="nlpdf-field"><span>Size</span><select id="nlpdfSignatureSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label></div>'+
        '</div></section>'+
        '<section class="nlpdf-section" id="nlpdfPageEdit"><div class="nlpdf-section-title"><strong>Selected page</strong><span id="nlpdfEditHint">Select a document page</span></div>'+
          '<div class="nlpdf-crop-grid">'+rangeMarkup('Top','nlpdfCropTop')+rangeMarkup('Right','nlpdfCropRight')+rangeMarkup('Bottom','nlpdfCropBottom')+rangeMarkup('Left','nlpdfCropLeft')+'</div>'+
          '<div class="nlpdf-edit-actions"><button id="nlpdfResetCrop" type="button" disabled>Reset crop</button></div>'+
        '</section>'+
        '<section class="nlpdf-section"><div class="nlpdf-section-title"><strong>Make Space</strong><span>Shrink/reposition content<br>for signature space</span></div>'+
          '<div class="nlpdf-space-row"><label class="nlpdf-field"><span>Bottom space</span><input id="nlpdfSpaceRange" type="range" min="0" max="55" step="1" value="25"></label><div class="nlpdf-space-value"><strong id="nlpdfSpaceValue">25 mm</strong></div></div>'+
          '<div class="nlpdf-radio-row"><label><input type="radio" name="nlpdfSpaceScope" value="current" checked>Current</label><label><input type="radio" name="nlpdfSpaceScope" value="selected">Selected</label><label><input type="radio" name="nlpdfSpaceScope" value="all">All</label></div>'+
          '<div class="nlpdf-edit-actions"><button id="nlpdfApplySpace" type="button">Apply Make Space</button><button id="nlpdfResetSpace" type="button">Reset</button></div>'+
        '</section>'+
        '<input class="nlpdf-file-input" id="nlpdfFileInput" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.zip,application/pdf,image/jpeg,image/png,image/webp,application/zip" multiple>'+
        '<input class="nlpdf-asset-input" id="nlpdfAssetInput" type="file">'+
      '</aside>'+
      '<div class="nlpdf-main">'+
        '<div class="nlpdf-toolbar"><button class="nlpdf-tool nlpdf-add-btn" id="nlpdfAddFiles" type="button">+ Add files / ZIP</button><button class="nlpdf-tool" id="nlpdfRotateLeft" type="button" disabled>↶ Rotate</button><button class="nlpdf-tool" id="nlpdfRotateRight" type="button" disabled>↷ Rotate</button><button class="nlpdf-tool" id="nlpdfMoveUp" type="button" disabled>← Earlier</button><button class="nlpdf-tool" id="nlpdfMoveDown" type="button" disabled>Later →</button><button class="nlpdf-tool" id="nlpdfDuplicate" type="button" disabled>⧉ Duplicate</button><button class="nlpdf-tool" id="nlpdfDelete" type="button" disabled>⌫ Delete</button><span class="nlpdf-toolbar-spacer"></span><span class="nlpdf-selection-label" id="nlpdfSelectionLabel">No page selected</span></div>'+
        '<div class="nlpdf-viewer-shell" id="nlpdfDropCanvas"><div class="nlpdf-drag-overlay">Drop files anywhere on the canvas</div><div class="nlpdf-viewer-drop-message" id="nlpdfDropMessage"><div class="icon">▤</div><strong>Drop PDF, images, or ZIP here</strong><p>The whole canvas is your drop zone. You can also click “Add files / ZIP”.</p><small>PDF · JPG · PNG · WebP · ZIP</small></div><div class="nlpdf-viewer-page hidden" id="nlpdfViewerPage"><span class="nlpdf-viewer-label" id="nlpdfViewerLabel"></span><span class="nlpdf-viewer-lock hidden" id="nlpdfViewerLock">DEFAULT ASSET · LOCKED</span><canvas id="nlpdfViewerCanvas"></canvas><img class="nlpdf-signature-preview hidden" id="nlpdfSignaturePreview" alt=""></div></div>'+
        '<div class="nlpdf-filmstrip-wrap"><div class="nlpdf-filmstrip-head"><strong>Pages</strong><span>Click · Ctrl/Cmd multi-select · Shift range · Backspace/Delete removes selected pages</span></div><div class="nlpdf-filmstrip" id="nlpdfFilmstrip"></div></div>'+
        '<footer class="nlpdf-footer"><div class="nlpdf-footer-stat"><strong id="nlpdfPageCount">0</strong><span>Document pages</span></div><div class="nlpdf-footer-stat"><strong id="nlpdfFileCount">0</strong><span>Source files</span></div><label class="nlpdf-package-toggle"><input id="nlpdfPackage" type="checkbox" '+(p.package?'checked':'')+'><div><strong>Create folder + Letter + PDF together</strong><span>Creates Folder [Letter_Name.docx + Documents_Name.pdf]. Student number is used only in the folder name.</span></div></label><div class="nlpdf-footer-actions"><div class="nlpdf-status" id="nlpdfStatus">Ready. Files stay in this browser.</div><button class="primary-btn nlpdf-create" id="nlpdfCreate" type="button" disabled>Create PDF</button></div></footer>'+
      '</div></div></section>';
  }
  function rangeMarkup(label,id){return '<div class="nlpdf-range"><label><span>'+label+'</span><strong id="'+id+'Value">0%</strong></label><input id="'+id+'" type="range" min="0" max="40" step="1" value="0" disabled></div>';}

  async function loadAssets(){for(const id of ['front','back','signature']){try{state.assets[id]=await dbGet(id);}catch(err){console.warn(err);}}renderAssets();await refreshAssetEntries();}
  function renderAssets(){
    for(const id of ['front','back','signature']){
      const a=state.assets[id],name=$('#nlpdfAssetName_'+id),remove=$('[data-asset-remove="'+id+'"]'),toggle=$('#'+(id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature'));
      if(name)name.textContent=a?a.name:'Not set';if(remove)remove.classList.toggle('hidden',!a);if(toggle){toggle.disabled=!a;if(!a)toggle.checked=false;}
    }
    const hasSig=Boolean(state.assets.signature);['nlpdfSignatureScope','nlpdfSignaturePosition','nlpdfSignatureSize'].forEach(id=>{const e=$('#'+id);if(e)e.disabled=!hasSig;});
  }
  async function convertImageBlob(file){
    if(file.type==='image/jpeg'||file.type==='image/png')return file;
    const url=URL.createObjectURL(file);try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url;}),c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return await new Promise(res=>c.toBlob(res,'image/png'));}finally{URL.revokeObjectURL(url);}
  }
  async function importAsset(id,file){
    if(!file)return;const isSig=id==='signature';
    if(isSig&&!/^image\//.test(file.type)&&!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('Signature must be PNG, JPG or WebP.');
    if(!isSig&&file.type!=='application/pdf'&&!/^image\//.test(file.type)&&!/\.(pdf|png|jpe?g|webp)$/i.test(file.name))throw new Error('Front/back asset must be PDF or image.');
    let blob=file,name=file.name,type=file.type||'application/octet-stream';if(/^image\//.test(type)&&type!=='image/png'&&type!=='image/jpeg'){blob=await convertImageBlob(file);type='image/png';name=file.name.replace(/\.[^.]+$/,'.png');}
    const rec={id,name,type,blob,updatedAt:new Date().toISOString()};await dbPut(rec);state.assets[id]=rec;renderAssets();const toggle=$('#'+(id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature'));if(toggle){toggle.disabled=false;toggle.checked=true;}savePrefs();await refreshAssetEntries();toast((id==='signature'?'Signature':'Default '+id)+' saved.');
  }
  async function removeAsset(id){await dbDelete(id);state.assets[id]=null;renderAssets();savePrefs();await refreshAssetEntries();toast('Default '+id+' asset removed.');}

  async function refreshAssetEntries(){
    state.assetEntries=[];state.assetPdfJsDocs.clear();await ensurePdfLibs();
    for(const id of ['front','back']){
      const enabled=id==='front'?$('#nlpdfUseFront')?.checked:$('#nlpdfUseBack')?.checked,a=state.assets[id];if(!enabled||!a)continue;
      if(a.type==='application/pdf'||/\.pdf$/i.test(a.name)){const bytes=new Uint8Array(await a.blob.arrayBuffer()),doc=await window.pdfjsLib.getDocument({data:bytes}).promise;state.assetPdfJsDocs.set(id,doc);for(let n=1;n<=doc.numPages;n++)state.assetEntries.push({key:'asset-'+id+'-'+n,assetId:id,sourcePage:n,fileName:a.name,kind:'asset-pdf',locked:true,position:id});}
      else{state.assetEntries.push({key:'asset-'+id+'-1',assetId:id,sourcePage:1,fileName:a.name,kind:'asset-image',locked:true,position:id});}
    }
    renderFilmstrip();if(state.activeKey&&getDisplayEntry(state.activeKey))renderViewer();else if(displayEntries()[0]){state.activeKey=displayEntries()[0].key;renderFilmstrip();renderViewer();}else renderViewer();
  }

  function displayEntries(){
    const front=state.assetEntries.filter(x=>x.position==='front'),back=state.assetEntries.filter(x=>x.position==='back'),docs=state.pages.map(x=>({...x,key:x.id}));
    return [...front,...docs,...back];
  }
  function getDisplayEntry(key){return displayEntries().find(x=>x.key===key)||null;}
  function selectedDocs(){return state.pages.filter(p=>state.selected.has(p.id));}
  function activeDoc(){const e=getDisplayEntry(state.activeKey);return e&&!e.locked?state.pages.find(p=>p.id===e.key)||null:null;}

  function currentCaseNumber(){return clean($('#caseStudentNumber')?.value)||clean($('#studentNumber')?.value);}
  function currentCaseName(){return clean($('#caseStudentName')?.value)||clean($('#studentName')?.value);}
  function syncStudent(force=false){const n=$('#nlpdfStudentNumber'),name=$('#nlpdfStudentName');if(n&&(force||!clean(n.value)))n.value=currentCaseNumber();if(name&&(force||!clean(name.value)))name.value=currentCaseName();syncNames();}
  function syncNames(){
    const number=safePath($('#nlpdfStudentNumber')?.value)||'3408',name=safePath($('#nlpdfStudentName')?.value)||'Miss ABC',pdf=$('#nlpdfFilename');
    if(pdf&&(!clean(pdf.value)||pdf.dataset.auto==='1')){pdf.value='Documents_'+name+'.pdf';pdf.dataset.auto='1';}
    $('#nlpdfFolderPreview').textContent=number+' '+name;$('#nlpdfLetterPreview').textContent='Letter_'+name+'.docx';$('#nlpdfPdfPreview').textContent=clean(pdf?.value)||('Documents_'+name+'.pdf');
  }
  function syncPrefsToUi(){const p=prefs();if($('#nlpdfUseFront')&&!$('#nlpdfUseFront').disabled)$('#nlpdfUseFront').checked=p.includeFront;if($('#nlpdfUseBack')&&!$('#nlpdfUseBack').disabled)$('#nlpdfUseBack').checked=p.includeBack;if($('#nlpdfUseSignature')&&!$('#nlpdfUseSignature').disabled)$('#nlpdfUseSignature').checked=p.applySignature;if($('#nlpdfSignatureScope'))$('#nlpdfSignatureScope').value=p.signatureScope;if($('#nlpdfSignaturePosition'))$('#nlpdfSignaturePosition').value=p.signaturePosition;if($('#nlpdfSignatureSize'))$('#nlpdfSignatureSize').value=p.signatureSize;if($('#nlpdfPackage'))$('#nlpdfPackage').checked=p.package;}
  function savePrefs(){const p={includeFront:Boolean($('#nlpdfUseFront')?.checked),includeBack:Boolean($('#nlpdfUseBack')?.checked),applySignature:Boolean($('#nlpdfUseSignature')?.checked),signatureScope:$('#nlpdfSignatureScope')?.value||'last',signaturePosition:$('#nlpdfSignaturePosition')?.value||'bottom-right',signatureSize:$('#nlpdfSignatureSize')?.value||'medium',package:Boolean($('#nlpdfPackage')?.checked)};try{localStorage.setItem(PREF_KEY,JSON.stringify(p));}catch{}}

  async function normalizeImage(file){
    if(file.type==='image/jpeg'||/\.jpe?g$/i.test(file.name))return{mime:'image/jpeg',bytes:new Uint8Array(await file.arrayBuffer()),previewUrl:URL.createObjectURL(file)};
    if(file.type==='image/png'||/\.png$/i.test(file.name))return{mime:'image/png',bytes:new Uint8Array(await file.arrayBuffer()),previewUrl:URL.createObjectURL(file)};
    const blob=await convertImageBlob(file);return{mime:'image/png',bytes:new Uint8Array(await blob.arrayBuffer()),previewUrl:URL.createObjectURL(blob)};
  }
  async function importFile(file){
    if(/\.zip$/i.test(file.name)||file.type==='application/zip'||file.type==='application/x-zip-compressed')return importZip(file);
    const key=uid();
    if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){const bytes=new Uint8Array(await file.arrayBuffer()),doc=await window.pdfjsLib.getDocument({data:bytes.slice()}).promise;state.sources.set(key,{key,fileName:file.name,kind:'pdf',bytes});state.pdfJsDocs.set(key,doc);for(let n=1;n<=doc.numPages;n++)state.pages.push({id:uid(),sourceKey:key,fileName:file.name,kind:'pdf',sourcePage:n,rotation:0,crop:defaultCrop(),space:defaultSpace()});return doc.numPages;}
    if(/^image\//.test(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name)){const im=await normalizeImage(file);state.sources.set(key,{key,fileName:file.name,kind:'image',bytes:im.bytes,mime:im.mime,previewUrl:im.previewUrl});state.pages.push({id:uid(),sourceKey:key,fileName:file.name,kind:'image',rotation:0,crop:defaultCrop(),space:defaultSpace(),previewUrl:im.previewUrl});return 1;}
    throw new Error(file.name+' is not supported.');
  }
  async function importZip(file){
    await ensureZip();const zip=await window.JSZip.loadAsync(file),entries=Object.values(zip.files).filter(z=>!z.dir&&/\.(pdf|png|jpe?g|webp)$/i.test(z.name));let count=0;
    for(const z of entries){const ext=(z.name.split('.').pop()||'').toLowerCase(),mime=ext==='pdf'?'application/pdf':ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg',blob=await z.async('blob'),f=new File([blob],z.name.split('/').pop(),{type:mime});count+=await importFile(f);}
    if(!entries.length)toast('ZIP contained no supported PDF/image files.');return count;
  }
  async function addFiles(files){
    const list=[...files];if(!list.length)return;state.busy=true;updateControls();setStatus('Importing '+list.length+' item'+(list.length===1?'':'s')+'…','busy');
    try{await ensurePdfLibs();let added=0;for(const f of list){try{added+=await importFile(f);}catch(err){console.error(err);toast(err.message||('Could not import '+f.name));}}if(!state.activeKey&&state.pages[0])state.activeKey=state.pages[0].id;if(!state.selected.size&&state.pages[0])state.selected.add(state.pages[0].id);await renderFilmstrip();await renderViewer();setStatus('Added '+added+' page'+(added===1?'':'s')+'.');}
    finally{state.busy=false;updateControls();}
  }

  async function renderPdfToCanvas(doc,pageNum,canvas,opts={}){
    const page=await doc.getPage(pageNum),base=page.getViewport({scale:1,rotation:opts.rotation||0}),maxW=opts.maxW||760,maxH=opts.maxH||1040,scale=Math.min(maxW/base.width,maxH/base.height),vp=page.getViewport({scale,rotation:opts.rotation||0}),temp=document.createElement('canvas'),ctx=temp.getContext('2d',{alpha:false});temp.width=Math.max(1,Math.floor(vp.width));temp.height=Math.max(1,Math.floor(vp.height));await page.render({canvasContext:ctx,viewport:vp}).promise;drawCroppedAndSpaced(temp,canvas,opts.crop||defaultCrop(),opts.space||defaultSpace(),opts.maxW||900,opts.maxH||1180);}
  function drawCroppedAndSpaced(source,canvas,crop,space,maxW=900,maxH=1180){
    const l=clamp(crop.left||0,0,40)/100,r=clamp(crop.right||0,0,40)/100,t=clamp(crop.top||0,0,40)/100,b=clamp(crop.bottom||0,0,40)/100;
    const sx=Math.floor(source.width*l),sy=Math.floor(source.height*t),sw=Math.max(1,Math.floor(source.width*(1-l-r))),sh=Math.max(1,Math.floor(source.height*(1-t-b)));
    const spaceRatio=clamp((space.bottomMM||0)/297,0,.25),usableH=maxH*(1-spaceRatio),scale=Math.min(maxW/sw,usableH/sh),dw=Math.max(1,Math.floor(sw*scale)),dh=Math.max(1,Math.floor(sh*scale));
    canvas.width=dw;canvas.height=Math.max(1,Math.floor(dh+maxH*spaceRatio));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,sx,sy,sw,sh,0,0,dw,dh);
  }
  async function renderImageToCanvas(srcUrl,canvas,opts={}){
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=srcUrl;}),temp=document.createElement('canvas'),rot=((opts.rotation||0)%360+360)%360;
    if(rot===90||rot===270){temp.width=img.naturalHeight;temp.height=img.naturalWidth;}else{temp.width=img.naturalWidth;temp.height=img.naturalHeight;}
    const ctx=temp.getContext('2d');ctx.save();if(rot===90){ctx.translate(temp.width,0);ctx.rotate(Math.PI/2);}else if(rot===180){ctx.translate(temp.width,temp.height);ctx.rotate(Math.PI);}else if(rot===270){ctx.translate(0,temp.height);ctx.rotate(-Math.PI/2);}ctx.drawImage(img,0,0);ctx.restore();drawCroppedAndSpaced(temp,canvas,opts.crop||defaultCrop(),opts.space||defaultSpace(),opts.maxW||900,opts.maxH||1180);
  }

  async function renderViewer(){
    const drop=$('#nlpdfDropMessage'),pageWrap=$('#nlpdfViewerPage'),canvas=$('#nlpdfViewerCanvas'),entry=getDisplayEntry(state.activeKey);
    if(!entry){drop.classList.remove('hidden');pageWrap.classList.add('hidden');updateEditPanel();return;}
    drop.classList.add('hidden');pageWrap.classList.remove('hidden');$('#nlpdfViewerLabel').textContent=entry.locked?(entry.position==='front'?'Default Front · page ':'Default Back · page ')+entry.sourcePage:'Document page '+(state.pages.findIndex(p=>p.id===entry.key)+1);
    $('#nlpdfViewerLock').classList.toggle('hidden',!entry.locked);
    try{
      if(entry.locked){
        const a=state.assets[entry.assetId];
        if(entry.kind==='asset-pdf')await renderPdfToCanvas(state.assetPdfJsDocs.get(entry.assetId),entry.sourcePage,canvas,{maxW:900,maxH:1180});
        else{const url=URL.createObjectURL(a.blob);try{await renderImageToCanvas(url,canvas,{})}finally{URL.revokeObjectURL(url);}}
      }else{
        const p=state.pages.find(x=>x.id===entry.key);
        if(p.kind==='pdf')await renderPdfToCanvas(state.pdfJsDocs.get(p.sourceKey),p.sourcePage,canvas,{rotation:p.rotation,crop:p.crop,space:p.space,maxW:900,maxH:1180});
        else await renderImageToCanvas(p.previewUrl,canvas,{rotation:p.rotation,crop:p.crop,space:p.space});
      }
      renderSignaturePreview(entry);
    }catch(err){console.error(err);setStatus('Preview unavailable: '+err.message,'error');}
    updateEditPanel();
  }

  function signatureApplies(entry){
    if(!entry||entry.locked||!$('#nlpdfUseSignature')?.checked||!state.assets.signature)return false;
    const scope=$('#nlpdfSignatureScope')?.value||'last';if(scope==='all')return true;
    const p=state.pages.find(x=>x.id===entry.key);return Boolean(p&&state.pages[state.pages.length-1]?.id===p.id);
  }
  function renderSignaturePreview(entry){
    const img=$('#nlpdfSignaturePreview');if(!img)return;
    if(!signatureApplies(entry)){img.classList.add('hidden');return;}
    const a=state.assets.signature,url=URL.createObjectURL(a.blob);img.src=url;img.onload=()=>URL.revokeObjectURL(url);img.classList.remove('hidden');
    const size=$('#nlpdfSignatureSize')?.value||'medium',w=size==='small'?16:size==='large'?30:23;img.style.width=w+'%';img.style.height='auto';img.style.bottom='4%';img.style.left='auto';img.style.right='4%';
    const pos=$('#nlpdfSignaturePosition')?.value||'bottom-right';if(pos==='bottom-left'){img.style.left='4%';img.style.right='auto';}else if(pos==='bottom-center'){img.style.left='50%';img.style.right='auto';img.style.transform='translateX(-50%)';}else img.style.transform='none';
  }

  async function renderThumb(entry,holder){
    const c=document.createElement('canvas');
    if(entry.locked){
      if(entry.kind==='asset-pdf')await renderPdfToCanvas(state.assetPdfJsDocs.get(entry.assetId),entry.sourcePage,c,{maxW:96,maxH:136});
      else{const a=state.assets[entry.assetId],url=URL.createObjectURL(a.blob);try{await renderImageToCanvas(url,c,{})}finally{URL.revokeObjectURL(url);}}
    }else{
      const p=state.pages.find(x=>x.id===entry.key);if(p.kind==='pdf')await renderPdfToCanvas(state.pdfJsDocs.get(p.sourceKey),p.sourcePage,c,{rotation:p.rotation,crop:p.crop,space:p.space,maxW:96,maxH:136});else await renderImageToCanvas(p.previewUrl,c,{rotation:p.rotation,crop:p.crop,space:p.space});
    }
    holder.innerHTML=holder.innerHTML.replace('<div class="nlpdf-thumb-loading">Loading…</div>','');holder.appendChild(c);
  }
  async function renderFilmstrip(){
    const strip=$('#nlpdfFilmstrip');if(!strip)return;const entries=displayEntries();
    strip.innerHTML=entries.map((e,i)=>'<article class="nlpdf-page-card '+(e.locked?'asset '+e.position:'')+' '+(state.selected.has(e.key)?'selected ':'')+(state.activeKey===e.key?'active':'')+'" data-page-key="'+esc(e.key)+'" '+(!e.locked?'draggable="true"':'')+'><div class="nlpdf-thumb"><span class="nlpdf-page-index">'+(i+1)+'</span><div class="nlpdf-thumb-loading">Loading…</div></div><div class="nlpdf-page-meta"><strong>'+esc(e.locked?(e.position==='front'?'Default Front':'Default Back'):e.fileName)+'</strong><span>'+esc(e.locked?'Locked · page '+e.sourcePage:(e.kind==='pdf'?'PDF · source p.'+e.sourcePage:'Image'))+'</span></div></article>').join('');
    for(const e of entries){const h=strip.querySelector('[data-page-key="'+CSS.escape(e.key)+'"] .nlpdf-thumb');if(h)renderThumb(e,h).catch(()=>{const l=h.querySelector('.nlpdf-thumb-loading');if(l)l.textContent='Preview unavailable';});}
    updateControls();
  }

  function updateEditPanel(){
    const p=activeDoc(),disabled=!p;$('#nlpdfEditHint').textContent=p?'Document page '+(state.pages.findIndex(x=>x.id===p.id)+1):'Default assets are view-only';
    for(const [prop,id] of [['top','nlpdfCropTop'],['right','nlpdfCropRight'],['bottom','nlpdfCropBottom'],['left','nlpdfCropLeft']]){const e=$('#'+id);if(!e)continue;e.disabled=disabled;e.value=p?(p.crop?.[prop]||0):0;$('#'+id+'Value').textContent=(p?(p.crop?.[prop]||0):0)+'%';}
    $('#nlpdfResetCrop').disabled=disabled;
  }
  function updateControls(){
    const docs=selectedDocs(),active=activeDoc(),idx=active?state.pages.findIndex(p=>p.id===active.id):-1;
    ['nlpdfRotateLeft','nlpdfRotateRight','nlpdfDuplicate','nlpdfDelete'].forEach(id=>{const e=$('#'+id);if(e)e.disabled=!docs.length||state.busy;});
    $('#nlpdfMoveUp').disabled=!active||idx<=0||state.busy;$('#nlpdfMoveDown').disabled=!active||idx<0||idx>=state.pages.length-1||state.busy;
    $('#nlpdfCreate').disabled=!state.pages.length||state.busy;
    $('#nlpdfSelectionLabel').textContent=docs.length?docs.length+' selected'+(active?' · active page '+(idx+1):''):(state.activeKey?'Viewing default asset':'No page selected');
    $('#nlpdfPageCount').textContent=state.pages.length;$('#nlpdfFileCount').textContent=state.sources.size;
    const pkg=$('#nlpdfPackage')?.checked;$('#nlpdfCreate').textContent=pkg?'Create Package':'Create PDF';
  }

  function selectEntry(entry,event){
    state.activeKey=entry.key;
    if(entry.locked){state.selected.clear();state.anchorIndex=-1;}
    else{
      const idx=state.pages.findIndex(p=>p.id===entry.key),multi=event.ctrlKey||event.metaKey;
      if(event.shiftKey&&state.anchorIndex>=0){
        const [a,b]=[state.anchorIndex,idx].sort((x,y)=>x-y);if(!multi)state.selected.clear();for(let i=a;i<=b;i++)state.selected.add(state.pages[i].id);
      }else if(multi){state.selected.has(entry.key)?state.selected.delete(entry.key):state.selected.add(entry.key);state.anchorIndex=idx;}
      else{state.selected.clear();state.selected.add(entry.key);state.anchorIndex=idx;}
    }
    renderFilmstrip();renderViewer();
  }
  function deleteSelected(){
    if(!state.selected.size)return;const ids=new Set(state.selected),activeWasDeleted=ids.has(state.activeKey);state.pages=state.pages.filter(p=>!ids.has(p.id));state.selected.clear();
    if(activeWasDeleted){const next=state.pages[Math.min(state.anchorIndex,state.pages.length-1)];state.activeKey=next?.id||displayEntries()[0]?.key||'';if(next)state.selected.add(next.id);}
    renderFilmstrip();renderViewer();
  }
  function rotateSelected(delta){if(!state.selected.size)return;for(const p of state.pages)if(state.selected.has(p.id))p.rotation=((p.rotation||0)+delta+360)%360;renderFilmstrip();renderViewer();}
  function duplicateSelected(){
    const indices=state.pages.map((p,i)=>state.selected.has(p.id)?i:-1).filter(i=>i>=0);if(!indices.length)return;let offset=0,newIds=[];
    for(const original of indices){const i=original+offset,p=state.pages[i],copy={...p,id:uid(),crop:{...p.crop},space:{...p.space}};state.pages.splice(i+1,0,copy);newIds.push(copy.id);offset++;}
    state.selected=new Set(newIds);state.activeKey=newIds[newIds.length-1];state.anchorIndex=state.pages.findIndex(p=>p.id===state.activeKey);renderFilmstrip();renderViewer();
  }
  function moveActive(delta){const p=activeDoc();if(!p)return;const i=state.pages.findIndex(x=>x.id===p.id),j=i+delta;if(j<0||j>=state.pages.length)return;[state.pages[i],state.pages[j]]=[state.pages[j],state.pages[i]];state.anchorIndex=j;renderFilmstrip();renderViewer();}
  function applyCrop(prop,value){const p=activeDoc();if(!p)return;p.crop[prop]=Number(value)||0;$('#nlpdfCrop'+prop[0].toUpperCase()+prop.slice(1)+'Value').textContent=p.crop[prop]+'%';renderFilmstrip();renderViewer();}
  function resetCrop(){const p=activeDoc();if(!p)return;p.crop=defaultCrop();updateEditPanel();renderFilmstrip();renderViewer();}
  function applySpace(reset=false){
    const amount=reset?0:Number($('#nlpdfSpaceRange').value||0),scope=document.querySelector('input[name="nlpdfSpaceScope"]:checked')?.value||'current';let targets=[];
    if(scope==='all')targets=state.pages;else if(scope==='selected')targets=selectedDocs();else{const p=activeDoc();if(p)targets=[p];}
    for(const p of targets)p.space={bottomMM:amount};renderFilmstrip();renderViewer();toast((reset?'Reset':'Applied')+' Make Space on '+targets.length+' page'+(targets.length===1?'':'s')+'.');
  }

  async function sourcePdfDoc(k){if(state.pdfLibDocs.has(k))return state.pdfLibDocs.get(k);const s=state.sources.get(k),d=await window.PDFLib.PDFDocument.load(s.bytes.slice());state.pdfLibDocs.set(k,d);return d;}
  async function embedImage(out,bytes,mime){return mime==='image/jpeg'?await out.embedJpg(bytes):await out.embedPng(bytes);}
  async function rasterizeImageForExport(p){
    const src=state.sources.get(p.sourceKey),canvas=document.createElement('canvas');await renderImageToCanvas(p.previewUrl,canvas,{rotation:p.rotation,crop:p.crop,space:{bottomMM:0},maxW:1600,maxH:2200});const blob=await new Promise(res=>canvas.toBlob(res,'image/png'));return new Uint8Array(await blob.arrayBuffer());
  }
  function drawEmbedded(outPage,embedded,rotation,spaceMM){
    const margin=28,spacePts=(spaceMM||0)*72/25.4,availW=A4.width-margin*2,availH=A4.height-margin*2-spacePts,rot=((rotation||0)%360+360)%360,srcW=embedded.width,srcH=embedded.height,rotW=(rot===90||rot===270)?srcH:srcW,rotH=(rot===90||rot===270)?srcW:srcH,scale=Math.min(availW/rotW,availH/rotH),w=srcW*scale,h=srcH*scale,shownW=rotW*scale,shownH=rotH*scale,x=(A4.width-shownW)/2,y=spacePts+margin+(availH-shownH)/2;
    const opts={width:w,height:h,rotate:window.PDFLib.degrees(rot)};if(rot===0){opts.x=x;opts.y=y;}else if(rot===90){opts.x=x+shownW;opts.y=y;}else if(rot===180){opts.x=x+shownW;opts.y=y+shownH;}else{opts.x=x;opts.y=y+shownH;}outPage.drawPage(embedded,opts);
  }
  async function addDocumentPage(out,p){
    if(p.kind==='image'){const png=await rasterizeImageForExport(p),img=await out.embedPng(png),pg=out.addPage([A4.width,A4.height]),d=img.scale(1),m=28,availH=A4.height-m*2-(p.space?.bottomMM||0)*72/25.4,scale=Math.min((A4.width-m*2)/d.width,availH/d.height),w=d.width*scale,h=d.height*scale;pg.drawImage(img,{x:(A4.width-w)/2,y:m+(p.space?.bottomMM||0)*72/25.4+(availH-h)/2,width:w,height:h});return pg;}
    const src=await sourcePdfDoc(p.sourceKey),sp=src.getPage(p.sourcePage-1),size=sp.getSize(),c=p.crop||defaultCrop(),left=size.width*(c.left||0)/100,right=size.width*(1-(c.right||0)/100),bottom=size.height*(c.bottom||0)/100,top=size.height*(1-(c.top||0)/100),embedded=await out.embedPage(sp,{left,bottom,right,top}),pg=out.addPage([A4.width,A4.height]);drawEmbedded(pg,embedded,p.rotation,p.space?.bottomMM||0);return pg;
  }
  async function appendDefaultAsset(out,a){
    if(!a)return 0;const bytes=new Uint8Array(await a.blob.arrayBuffer());
    if(a.type==='application/pdf'||/\.pdf$/i.test(a.name)){const src=await window.PDFLib.PDFDocument.load(bytes),pages=await out.copyPages(src,src.getPageIndices());pages.forEach(p=>out.addPage(p));return pages.length;}
    const img=await embedImage(out,bytes,a.type||'image/png'),pg=out.addPage([A4.width,A4.height]),d=img.scale(1),m=28,scale=Math.min((A4.width-m*2)/d.width,(A4.height-m*2)/d.height),w=d.width*scale,h=d.height*scale;pg.drawImage(img,{x:(A4.width-w)/2,y:(A4.height-h)/2,width:w,height:h});return 1;
  }
  async function signatureEmbed(out){const a=state.assets.signature;if(!a)return null;return embedImage(out,new Uint8Array(await a.blob.arrayBuffer()),a.type||'image/png');}
  function drawSignature(page,img){if(!img)return;const pos=$('#nlpdfSignaturePosition').value,size=$('#nlpdfSignatureSize').value,ratio=size==='small'?.16:size==='large'?.30:.23,w=page.getWidth()*ratio,d=img.scale(1),h=w*d.height/d.width,m=34;let x=m;if(pos==='bottom-right')x=page.getWidth()-w-m;else if(pos==='bottom-center')x=(page.getWidth()-w)/2;page.drawImage(img,{x,y:m,width:w,height:h,opacity:.98});}
  async function buildPdfBytes(){
    await ensurePdfLibs();const out=await window.PDFLib.PDFDocument.create();
    if($('#nlpdfUseFront')?.checked&&state.assets.front)await appendDefaultAsset(out,state.assets.front);
    const sig=$('#nlpdfUseSignature')?.checked&&state.assets.signature?await signatureEmbed(out):null,scope=$('#nlpdfSignatureScope').value;
    for(let i=0;i<state.pages.length;i++){const pg=await addDocumentPage(out,state.pages[i]);if(sig&&(scope==='all'||i===state.pages.length-1))drawSignature(pg,sig);}
    if($('#nlpdfUseBack')?.checked&&state.assets.back)await appendDefaultAsset(out,state.assets.back);
    out.setCreator('BU International Center Workspace');out.setProducer('New Letter PDF Tools');return new Uint8Array(await out.save());
  }

  function customNoIenTemplate(){try{const e=JSON.parse(localStorage.getItem(NO_IEN_OVERRIDE_KEY)||'null');if(e&&typeof e.base64==='string'&&e.base64.length>100)return e;}catch{}return null;}
  function letterTemplateBytes(key){const t=(key==='bachelor_no_ien'?customNoIenTemplate():null)||window.LETTER_TEMPLATES?.[key];if(!t?.base64)throw new Error('Selected Word template is missing.');const bin=atob(t.base64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
  async function fileExists(dir,name){try{await dir.getFileHandle(name,{create:false});return true;}catch(err){if(err?.name==='NotFoundError')return false;throw err;}}
  async function writeToDir(dir,name,data){const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(data);await w.close();}
  async function createPackage(pdfBytes){
    if(!window.showDirectoryPicker)throw new Error('Folder package creation requires Chrome or Edge with folder access.');
    const number=safePath($('#nlpdfStudentNumber').value),name=safePath($('#nlpdfStudentName').value);if(!number||!name)throw new Error('Enter student number and name first.');
    const parent=await window.showDirectoryPicker({mode:'readwrite'}),folderName=number+' '+name,letterName='Letter_'+name+'.docx';let pdfName=safeFile($('#nlpdfFilename').value||('Documents_'+name+'.pdf'));if(!/\.pdf$/i.test(pdfName))pdfName+='.pdf';
    const folder=await parent.getDirectoryHandle(folderName,{create:true}),existing=[];if(await fileExists(folder,letterName))existing.push(letterName);if(await fileExists(folder,pdfName))existing.push(pdfName);if(existing.length&&!confirm(existing.join(' and ')+' already exist in '+folderName+'. Replace them?'))return false;
    await writeToDir(folder,letterName,new Blob([letterTemplateBytes($('#nlpdfLetterType').value)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));await writeToDir(folder,pdfName,new Blob([pdfBytes],{type:'application/pdf'}));setStatus('Created '+folderName+' with Letter + PDF.');toast('Student package created.');return true;
  }
  function downloadPdf(bytes){const name=safePath($('#nlpdfStudentName').value)||'Student';let pdfName=safeFile($('#nlpdfFilename').value||('Documents_'+name+'.pdf'));if(!/\.pdf$/i.test(pdfName))pdfName+='.pdf';const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=pdfName;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);setStatus('Created '+pdfName+'.');toast('PDF created.');}
  async function createOutput(){if(!state.pages.length||state.busy)return;state.busy=true;updateControls();savePrefs();setStatus('Creating output…','busy');try{const bytes=await buildPdfBytes();if($('#nlpdfPackage').checked)await createPackage(bytes);else downloadPdf(bytes);}catch(err){if(err?.name==='AbortError')setStatus('Folder selection cancelled.');else{console.error(err);setStatus('Could not create output: '+(err.message||err),'error');toast(err.message||'Could not create output.');}}finally{state.busy=false;updateControls();}}

  function reorderByDrop(a,b){if(!a||!b||a===b)return;const from=state.pages.findIndex(p=>p.id===a),to=state.pages.findIndex(p=>p.id===b);if(from<0||to<0)return;const item=state.pages.splice(from,1)[0];state.pages.splice(to,0,item);state.anchorIndex=to;renderFilmstrip();renderViewer();}
  function shouldIgnoreDeleteKey(e){const t=e.target;return t&&(/INPUT|TEXTAREA|SELECT/.test(t.tagName)||t.isContentEditable);}
  function clearDocuments(){if(state.pages.length&&!confirm('Clear all imported document pages?'))return;for(const s of state.sources.values())if(s.previewUrl)URL.revokeObjectURL(s.previewUrl);state.pages=[];state.selected.clear();state.activeKey=displayEntries()[0]?.key||'';state.sources.clear();state.pdfJsDocs.clear();state.pdfLibDocs.clear();renderFilmstrip();renderViewer();setStatus('Document pages cleared. Default assets are kept.');}

  async function build(){
    const docs=$('#workspaceDocuments'),legacyGrid=docs?.querySelector('.document-workspace-grid');if(!docs||!legacyGrid)return;
    docs.classList.add('nlpdf-primary');if(!$('#nlpdfPrimaryHead'))docs.insertAdjacentHTML('afterbegin',mainHeaderMarkup());if(!$('#newLetterPdfWorkspace'))legacyGrid.insertAdjacentHTML('afterend',workspaceMarkup());
    $('#nlpdfOpenCreateFolder')?.addEventListener('click',oldCreateFolder);

    await ensurePdfLibs();await loadAssets();syncPrefsToUi();syncStudent(true);syncNames();

    $('#nlpdfAddFiles').addEventListener('click',()=>$('#nlpdfFileInput').click());
    $('#nlpdfFileInput').addEventListener('change',e=>{addFiles(e.target.files);e.target.value='';});
    $('#nlpdfStudentNumber').addEventListener('input',syncNames);$('#nlpdfStudentName').addEventListener('input',()=>{$('#nlpdfFilename').dataset.auto='1';syncNames();});$('#nlpdfFilename').addEventListener('input',e=>{e.target.dataset.auto='0';syncNames();});
    $('#nlpdfPackage').addEventListener('change',()=>{savePrefs();updateControls();});
    ['nlpdfUseFront','nlpdfUseBack'].forEach(id=>$('#'+id).addEventListener('change',async()=>{savePrefs();await refreshAssetEntries();}));
    ['nlpdfUseSignature','nlpdfSignatureScope','nlpdfSignaturePosition','nlpdfSignatureSize'].forEach(id=>$('#'+id).addEventListener('change',()=>{savePrefs();renderViewer();}));
    $$('[data-asset-import]').forEach(b=>b.addEventListener('click',()=>{state.pendingAsset=b.dataset.assetImport;const input=$('#nlpdfAssetInput');input.accept=state.pendingAsset==='signature'?'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp':'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp';input.click();}));
    $$('[data-asset-remove]').forEach(b=>b.addEventListener('click',()=>removeAsset(b.dataset.assetRemove).catch(err=>toast(err.message))));
    $('#nlpdfAssetInput').addEventListener('change',async e=>{const f=e.target.files?.[0];try{if(f&&state.pendingAsset)await importAsset(state.pendingAsset,f);}catch(err){console.error(err);toast(err.message||'Could not save asset.');}finally{e.target.value='';state.pendingAsset='';}});

    $('#nlpdfRotateLeft').addEventListener('click',()=>rotateSelected(-90));$('#nlpdfRotateRight').addEventListener('click',()=>rotateSelected(90));$('#nlpdfMoveUp').addEventListener('click',()=>moveActive(-1));$('#nlpdfMoveDown').addEventListener('click',()=>moveActive(1));$('#nlpdfDuplicate').addEventListener('click',duplicateSelected);$('#nlpdfDelete').addEventListener('click',deleteSelected);$('#nlpdfCreate').addEventListener('click',createOutput);
    for(const [prop,id] of [['top','nlpdfCropTop'],['right','nlpdfCropRight'],['bottom','nlpdfCropBottom'],['left','nlpdfCropLeft']])$('#'+id).addEventListener('input',e=>applyCrop(prop,e.target.value));
    $('#nlpdfResetCrop').addEventListener('click',resetCrop);$('#nlpdfSpaceRange').addEventListener('input',e=>$('#nlpdfSpaceValue').textContent=e.target.value+' mm');$('#nlpdfApplySpace').addEventListener('click',()=>applySpace(false));$('#nlpdfResetSpace').addEventListener('click',()=>applySpace(true));

    const canvas=$('#nlpdfDropCanvas');['dragenter','dragover'].forEach(t=>canvas.addEventListener(t,e=>{e.preventDefault();canvas.classList.add('dragover');e.dataTransfer.dropEffect='copy';}));['dragleave','drop'].forEach(t=>canvas.addEventListener(t,e=>{e.preventDefault();if(t==='drop')canvas.classList.remove('dragover');else if(!canvas.contains(e.relatedTarget))canvas.classList.remove('dragover');}));canvas.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
    const strip=$('#nlpdfFilmstrip');strip.addEventListener('click',e=>{const card=e.target.closest('[data-page-key]');if(card){const entry=getDisplayEntry(card.dataset.pageKey);if(entry)selectEntry(entry,e);}});strip.addEventListener('dragstart',e=>{const card=e.target.closest('[data-page-key]');if(!card||card.classList.contains('asset'))return;e.dataTransfer.effectAllowed='move';state.dragId=card.dataset.pageKey;card.classList.add('dragging');});strip.addEventListener('dragend',e=>{e.target.closest('[data-page-key]')?.classList.remove('dragging');$$('.drag-target',strip).forEach(x=>x.classList.remove('drag-target'));state.dragId='';});strip.addEventListener('dragover',e=>{const card=e.target.closest('[data-page-key]');if(!card||card.classList.contains('asset'))return;e.preventDefault();$$('.drag-target',strip).forEach(x=>x.classList.remove('drag-target'));card.classList.add('drag-target');});strip.addEventListener('drop',e=>{const card=e.target.closest('[data-page-key]');if(!card||card.classList.contains('asset'))return;e.preventDefault();reorderByDrop(state.dragId,card.dataset.pageKey);state.dragId='';});
    document.addEventListener('keydown',e=>{if((e.key==='Backspace'||e.key==='Delete')&&!shouldIgnoreDeleteKey(e)&&state.selected.size){e.preventDefault();deleteSelected();}});
    ['caseStudentNumber','caseStudentName','studentNumber','studentName'].forEach(id=>$('#'+id)?.addEventListener('input',()=>syncStudent(false)));

    await renderFilmstrip();await renderViewer();updateControls();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>build().catch(console.error),{once:true});else build().catch(console.error);
})();