(() => {
'use strict';

const DB_NAME='buic-new-letter-pdf-assets-v1', DB_VERSION=1, STORE='assets';
const PREF_KEY='buic-new-letter-pdf-prefs-v4';
const NO_IEN_OVERRIDE_KEY='bu-ic-bachelor-no-ien-template-override-v1';
const A4={wMM:210,hMM:297,wPt:595.28,hPt:841.89};
const state={
  pages:[], selected:new Set(), activeId:'', anchorIndex:-1, viewMode:'single',
  sources:new Map(), pdfJsDocs:new Map(), pdfLibDocs:new Map(), previewCache:new Map(),
  assets:{front:null,back:null,signature:null}, assetInfo:{front:null,back:null},
  busy:false, dragId:'', pendingAsset:'', destinationHandle:null,
  zoom:1, safeArea:false, cropMode:false, cropDraft:null, renderEpoch:0, cropBounds:null, sigAspect:.32,
  signatureUrl:'', sig:{xPct:.72,yPct:.80,widthPct:.22}
};
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const clean=v=>String(v??'').trim(), clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const uid=()=> 'p-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
const esc=(v='')=>String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const defaultCrop=()=>({top:0,right:0,bottom:0,left:0});
const defaultTransform=()=>({scale:1,xMM:0,yMM:0});

function toast(m){const e=$('#toast');if(e){e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600);}}
function setStatus(t,k=''){const e=$('#nlpdfStatus');if(e){e.textContent=t;e.className='nlpdf-footer-center'+(k?' '+k:'');}}
function safePath(v){return clean(v).replace(/[<>:"/\\|?*\x00-\x1F]/g,'').replace(/[. ]+$/g,'').trim();}
function safeFile(v){return safePath(v).slice(0,140)||'Student';}

function loadScript(src,test){
  if(test())return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const abs=new URL(src,location.href).href, old=[...document.scripts].find(s=>s.src===abs);
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

function openDb(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB_NAME,DB_VERSION);q.onupgradeneeded=()=>{const db=q.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function dbGet(id){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
async function dbPut(x){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(x);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
async function dbDelete(id){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}

function prefs(){
  try{return Object.assign({front:true,back:true,signature:false,sigScope:'last',sigWidth:.22,sigX:.72,sigY:.80,spaceMM:25,safeArea:false},JSON.parse(localStorage.getItem(PREF_KEY)||'{}'));}
  catch{return {front:true,back:true,signature:false,sigScope:'last',sigWidth:.22,sigX:.72,sigY:.80,spaceMM:25,safeArea:false};}
}
function savePrefs(){
  try{localStorage.setItem(PREF_KEY,JSON.stringify({
    front:Boolean($('#nlpdfUseFront')?.checked),back:Boolean($('#nlpdfUseBack')?.checked),signature:Boolean($('#nlpdfUseSignature')?.checked),
    sigScope:$('#nlpdfSigScope')?.value||'last',sigWidth:state.sig.widthPct,sigX:state.sig.xPct,sigY:state.sig.yPct,
    safeArea:Boolean($('#nlpdfSafeArea')?.checked)
  }));}catch{}
}

function assetRow(id,label,checked,isSig=false){
  const toggle=id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature';
  return '<div class="nlpdf-asset-row"><input class="nlpdf-asset-toggle" id="'+toggle+'" type="checkbox" '+(checked?'checked':'')+' disabled>'+
    '<div class="nlpdf-asset-copy"><strong>'+label+'</strong><span id="nlpdfAssetName_'+id+'">Not set</span></div>'+
    '<div class="nlpdf-asset-actions"><button class="nlpdf-mini" type="button" data-asset-import="'+id+'">'+(isSig?'Import':'Set')+'</button><button class="nlpdf-mini remove hidden" type="button" data-asset-remove="'+id+'">×</button></div></div>';
}
function rangeMarkup(label,id,min,max,step,val,suffix){
  return '<div class="nlpdf-range"><label><span>'+label+'</span><strong id="'+id+'Value">'+val+suffix+'</strong></label><input id="'+id+'" type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"></div>';
}
function workspaceMarkup(){
  const p=prefs();state.sig={xPct:p.sigX,yPct:p.sigY,widthPct:p.sigWidth};
  return '<section class="new-letter-pdf-workspace" id="newLetterPdfWorkspace">'+
  '<div class="nlpdf-shell">'+
    '<aside class="nlpdf-sidebar">'+
      '<div class="nlpdf-side-head"><div class="nlpdf-side-title"><span class="eyebrow">NEW LETTER</span><strong>PDF Builder</strong></div><button class="nlpdf-create-folder" id="nlpdfCreateFolderOnly" type="button">Create Folder</button></div>'+
      '<div class="nlpdf-side-scroll">'+
        '<section class="nlpdf-panel"><div class="nlpdf-panel-title"><strong>Default assets</strong><span>Shown as one<br>stack each</span></div>'+
          assetRow('front','Front document',p.front)+assetRow('back','Back document',p.back)+assetRow('signature','Signature',p.signature,true)+
          '<div class="nlpdf-signature-controls"><label class="nlpdf-field"><span>Apply signature</span><select id="nlpdfSigScope"><option value="last">Last document page</option><option value="all">All document pages</option></select></label><div class="nlpdf-field"><span>Drag signature directly on A4</span><button class="nlpdf-btn" id="nlpdfResetSignature" type="button">Reset position</button></div><div class="wide">'+rangeMarkup('Signature size','nlpdfSigSize',10,42,1,Math.round(p.sigWidth*100),'%')+'</div></div>'+
        '</section>'+
        '<section class="nlpdf-panel" id="nlpdfCropPanel"><div class="nlpdf-panel-title"><strong>Crop tool</strong><span id="nlpdfActiveLabel">Select a page</span></div>'+
          '<div class="nlpdf-note">Drag the edges or corners of the crop boundary directly on the A4 sheet.</div>'+
          '<div class="nlpdf-row"><button class="nlpdf-btn" id="nlpdfStartCrop" type="button" disabled>⌗ Crop page</button><button class="nlpdf-btn hidden" id="nlpdfApplyCrop" type="button">✓ Apply crop</button><button class="nlpdf-btn hidden" id="nlpdfCancelCrop" type="button">Cancel</button><button class="nlpdf-btn" id="nlpdfResetCrop" type="button" disabled>Reset crop</button></div>'+
        '</section>'+
        '<section class="nlpdf-panel"><div class="nlpdf-panel-title"><strong>Position & scale</strong><span>Drag content<br>inside A4</span></div>'+
          rangeMarkup('Content scale','nlpdfContentScale',55,150,1,100,'%')+
          '<div class="nlpdf-row"><button class="nlpdf-btn" id="nlpdfCenterContent" type="button" disabled>Center</button><button class="nlpdf-btn" id="nlpdfResetTransform" type="button" disabled>Reset</button></div>'+
        '</section>'+
        '<section class="nlpdf-panel"><div class="nlpdf-panel-title"><strong>Safe area</strong><span>Word-style margins</span></div>'+
          '<label class="nlpdf-safe-toggle"><input id="nlpdfSafeArea" type="checkbox"><span><strong>Keep content inside safe area</strong><small>25.4 mm (1 in) margins on all four sides</small></span></label>'+
        '</section>'+
        '<section class="nlpdf-panel"><div class="nlpdf-panel-title"><strong>Make Space</strong><span>Automatic signature clearance</span></div>'+
          '<div class="nlpdf-note">Uniformly fit document content above the signature. No manual spacing or guessing needed.</div>'+
          '<div class="nlpdf-scope"><label><input type="radio" name="nlpdfSpaceScope" value="current" checked>This page</label><label><input type="radio" name="nlpdfSpaceScope" value="all">Every page</label></div>'+
          '<div class="nlpdf-row"><button class="nlpdf-btn" id="nlpdfApplySpace" type="button">Make Space</button><button class="nlpdf-btn" id="nlpdfClearSpace" type="button">Undo Make Space</button></div>'+
          '<div class="nlpdf-note" id="nlpdfSpaceStatus">The saved signature determines the required clearance.</div>'+
        '</section>'+
        '<section class="nlpdf-panel"><div class="nlpdf-note"><strong>Selection</strong><br>Click = one page · Ctrl/Cmd = add/remove · Shift = range · Backspace/Delete = remove selected document pages.</div></section>'+
      '</div>'+
      '<input class="nlpdf-file-input" id="nlpdfFileInput" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.zip,application/pdf,image/jpeg,image/png,image/webp,application/zip" multiple>'+
      '<input class="nlpdf-asset-input" id="nlpdfAssetInput" type="file">'+
    '</aside>'+
    '<main class="nlpdf-editor">'+
      '<div class="nlpdf-toolbar">'+
        '<button class="nlpdf-tool primary" id="nlpdfAddFiles" type="button">+ Add files / ZIP</button>'+
        '<button class="nlpdf-tool" id="nlpdfRotateLeft" type="button" disabled>↶ Rotate</button><button class="nlpdf-tool" id="nlpdfRotateRight" type="button" disabled>↷ Rotate</button>'+
        '<button class="nlpdf-tool" id="nlpdfMoveFirst" type="button" disabled>⇤ First</button><button class="nlpdf-tool" id="nlpdfMoveUp" type="button" disabled>← Earlier</button><button class="nlpdf-tool" id="nlpdfMoveDown" type="button" disabled>Later →</button><button class="nlpdf-tool" id="nlpdfMoveLast" type="button" disabled>Last ⇥</button>'+
        '<button class="nlpdf-tool" id="nlpdfDuplicate" type="button" disabled>⧉ Duplicate</button><button class="nlpdf-tool" id="nlpdfDelete" type="button" disabled>⌫ Delete</button>'+
        '<span class="nlpdf-toolbar-spacer"></span><span class="nlpdf-selection-label" id="nlpdfSelectionLabel">No page selected</span>'+
        '<div class="nlpdf-view-toggle"><button class="active" id="nlpdfSingleView" type="button">Single</button><button id="nlpdfGridView" type="button">Grid</button></div>'+
      '</div>'+
      '<section class="nlpdf-stage" id="nlpdfStage"><div class="nlpdf-drop-overlay">Drop PDF, images, or ZIP anywhere here</div>'+
        '<div class="nlpdf-paper" id="nlpdfPaper"><canvas id="nlpdfCanvas" width="840" height="1188"></canvas><div class="nlpdf-safe-guide hidden" id="nlpdfSafeGuide"></div><div class="nlpdf-crop-layer hidden" id="nlpdfCropLayer"><div class="nlpdf-crop-region" id="nlpdfCropRegion"><i data-crop-handle="nw"></i><i data-crop-handle="n"></i><i data-crop-handle="ne"></i><i data-crop-handle="e"></i><i data-crop-handle="se"></i><i data-crop-handle="s"></i><i data-crop-handle="sw"></i><i data-crop-handle="w"></i></div></div><div class="nlpdf-paper-hint" id="nlpdfPaperHint"><div><strong>Blank A4</strong><span>Drop files onto the workspace or click “Add files / ZIP”.<br>Select a page to crop, move, scale, or make space.</span></div></div><span class="nlpdf-paper-badge hidden" id="nlpdfPaperBadge"></span><span class="nlpdf-content-drag-hint hidden" id="nlpdfDragHint">Drag page content to move</span><img class="nlpdf-signature-preview hidden" id="nlpdfSignaturePreview" alt="Signature"></div>'+
        '<span class="nlpdf-empty-drop">Whole workspace accepts drag & drop</span>'+
      '</section>'+
      '<section class="nlpdf-grid-stage hidden" id="nlpdfGridStage"><div class="nlpdf-drop-overlay">Drop PDF, images, or ZIP anywhere here</div><div class="nlpdf-grid" id="nlpdfGrid"></div></section>'+
      '<section class="nlpdf-filmstrip-wrap" id="nlpdfFilmstripWrap"><div class="nlpdf-filmstrip-head"><strong>Pages</strong><span>Front/Back are shown as stacks, not every default page</span></div><div class="nlpdf-filmstrip" id="nlpdfFilmstrip"></div></section>'+
      '<div class="nlpdf-zoom" id="nlpdfZoomControls"><button id="nlpdfZoomOut" type="button" aria-label="Zoom out">−</button><strong id="nlpdfZoomValue">100%</strong><button id="nlpdfZoomIn" type="button" aria-label="Zoom in">+</button><button id="nlpdfZoomFit" type="button">Fit A4</button></div>'+
      '<footer class="nlpdf-footer"><div class="nlpdf-footer-stats"><div class="nlpdf-footer-stat"><strong id="nlpdfPageCount">0</strong><span>Document pages</span></div><div class="nlpdf-footer-stat"><strong id="nlpdfFileCount">0</strong><span>Source files</span></div></div><div class="nlpdf-footer-center" id="nlpdfStatus">Ready · Files stay in this browser</div><button class="nlpdf-create" id="nlpdfCreate" type="button" disabled>Create PDF</button></footer>'+
    '</main>'+
  '</div></section>'+
  exportModalMarkup();
}
function exportModalMarkup(){
  return '<div class="nlpdf-modal" id="nlpdfExportModal" aria-hidden="true"><div class="nlpdf-modal-backdrop" data-nlpdf-close></div><section class="nlpdf-modal-card" role="dialog" aria-modal="true">'+
    '<div class="nlpdf-modal-head"><div><span class="eyebrow">FINAL REVIEW</span><h2>Create PDF</h2></div><button class="nlpdf-close" type="button" data-nlpdf-close>×</button></div>'+
    '<div class="nlpdf-modal-body">'+
      '<div class="nlpdf-modal-grid"><label class="nlpdf-modal-field"><span>Student number</span><input id="nlpdfExportNumber" placeholder="3408"></label><label class="nlpdf-modal-field"><span>Student name</span><input id="nlpdfExportName" placeholder="Miss ABC"></label>'+
      '<label class="nlpdf-modal-field full"><span>Letter type</span><select id="nlpdfExportLetterType"><option value="bachelor_no_ien">Bachelor Degree No IEN</option><option value="bachelor">Bachelor Degree</option><option value="current_no_ien">Current No IEN</option><option value="exchange">Exchange Bachelor</option><option value="master">Master Degree</option><option value="doctor">Doctor Degree</option></select></label>'+
      '<label class="nlpdf-modal-field full"><span>PDF filename</span><input id="nlpdfExportPdfName"></label></div>'+
      '<div class="nlpdf-output-choice"><label class="nlpdf-choice"><input type="radio" name="nlpdfOutputMode" value="pdf" checked><div><strong>PDF only</strong><span>Creates Documents_Name.pdf in the selected destination.</span></div></label><label class="nlpdf-choice"><input type="radio" name="nlpdfOutputMode" value="package"><div><strong>Folder + Letter + PDF</strong><span>Creates Number Name / Letter_Name.docx + Documents_Name.pdf.</span></div></label></div>'+
      '<div class="nlpdf-final-preview"><div class="nlpdf-final-row"><span>Folder</span><strong id="nlpdfFinalFolder">—</strong></div><div class="nlpdf-final-row"><span>Letter</span><strong id="nlpdfFinalLetter">—</strong></div><div class="nlpdf-final-row"><span>PDF</span><strong id="nlpdfFinalPdf">Documents_Miss ABC.pdf</strong></div><div class="nlpdf-final-row"><span>Pages</span><strong id="nlpdfFinalPages">0 document pages</strong></div></div>'+
      '<div class="nlpdf-destination"><div><strong id="nlpdfDestinationName">No destination selected</strong><span id="nlpdfDestinationHelp">Choose where the final output should be created.</span></div><button class="nlpdf-dest-btn" id="nlpdfChooseDestination" type="button">Choose destination</button></div>'+
    '</div>'+
    '<div class="nlpdf-modal-actions"><button class="nlpdf-cancel" type="button" data-nlpdf-close>Cancel</button><button class="nlpdf-confirm" id="nlpdfConfirmExport" type="button">Create PDF</button></div>'+
  '</section></div>';
}

/* Assets */
async function loadAssets(){
  for(const id of ['front','back','signature']){try{state.assets[id]=await dbGet(id);}catch(err){console.warn(err);}}
  const p=prefs();state.sig={xPct:p.sigX,yPct:p.sigY,widthPct:p.sigWidth};
  renderAssets();await updateAssetInfo();refreshSignatureUrl();
}
function renderAssets(){
  for(const id of ['front','back','signature']){
    const a=state.assets[id],name=$('#nlpdfAssetName_'+id),remove=$('[data-asset-remove="'+id+'"]'),toggle=$('#'+(id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature'));
    if(name)name.textContent=a?a.name:'Not set';if(remove)remove.classList.toggle('hidden',!a);if(toggle){toggle.disabled=!a;if(!a)toggle.checked=false;}
  }
  $('#nlpdfSigScope').disabled=!state.assets.signature;$('#nlpdfSigSize').disabled=!state.assets.signature;$('#nlpdfResetSignature').disabled=!state.assets.signature;
}
async function updateAssetInfo(){
  await ensurePdfLibs();
  for(const id of ['front','back']){
    const a=state.assets[id];if(!a){state.assetInfo[id]=null;continue;}
    if(a.type==='application/pdf'||/\.pdf$/i.test(a.name)){try{const bytes=new Uint8Array(await a.blob.arrayBuffer()),doc=await window.pdfjsLib.getDocument({data:bytes}).promise;state.assetInfo[id]={pageCount:doc.numPages};doc.destroy?.();}catch{state.assetInfo[id]={pageCount:1};}}
    else state.assetInfo[id]={pageCount:1};
  }
  renderFilmstrip();renderGrid();
}
function refreshSignatureUrl(){if(state.signatureUrl)URL.revokeObjectURL(state.signatureUrl);state.signatureUrl=state.assets.signature?URL.createObjectURL(state.assets.signature.blob):'';}
async function convertImageBlob(file){
  if(file.type==='image/jpeg'||file.type==='image/png')return file;
  const url=URL.createObjectURL(file);try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url;}),c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return await new Promise(res=>c.toBlob(res,'image/png'));}finally{URL.revokeObjectURL(url);}
}
async function importAsset(id,file){
  if(!file)return;const sig=id==='signature';
  if(sig&&!/^image\//.test(file.type)&&!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('Signature must be PNG, JPG or WebP.');
  if(!sig&&file.type!=='application/pdf'&&!/^image\//.test(file.type)&&!/\.(pdf|png|jpe?g|webp)$/i.test(file.name))throw new Error('Front/Back must be PDF or image.');
  let blob=file,name=file.name,type=file.type||'application/octet-stream';
  if(/^image\//.test(type)&&type!=='image/png'&&type!=='image/jpeg'){blob=await convertImageBlob(file);type='image/png';name=file.name.replace(/\.[^.]+$/,'.png');}
  const rec={id,name,type,blob,updatedAt:new Date().toISOString()};await dbPut(rec);state.assets[id]=rec;renderAssets();const t=$('#'+(id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature'));t.disabled=false;t.checked=true;savePrefs();refreshSignatureUrl();await updateAssetInfo();renderActive();toast((sig?'Signature':'Default '+id)+' saved.');
}
async function removeAsset(id){await dbDelete(id);state.assets[id]=null;renderAssets();savePrefs();refreshSignatureUrl();await updateAssetInfo();renderActive();toast('Default '+id+' removed.');}

/* Imports */
async function normalizeImage(file){
  if(file.type==='image/jpeg'||/\.jpe?g$/i.test(file.name))return{mime:'image/jpeg',bytes:new Uint8Array(await file.arrayBuffer()),previewUrl:URL.createObjectURL(file)};
  if(file.type==='image/png'||/\.png$/i.test(file.name))return{mime:'image/png',bytes:new Uint8Array(await file.arrayBuffer()),previewUrl:URL.createObjectURL(file)};
  const b=await convertImageBlob(file);return{mime:'image/png',bytes:new Uint8Array(await b.arrayBuffer()),previewUrl:URL.createObjectURL(b)};
}
async function importFile(file){
  if(/\.zip$/i.test(file.name)||file.type==='application/zip'||file.type==='application/x-zip-compressed')return importZip(file);
  const key=uid();
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
    const bytes=new Uint8Array(await file.arrayBuffer()),doc=await window.pdfjsLib.getDocument({data:bytes.slice()}).promise;
    state.sources.set(key,{key,fileName:file.name,kind:'pdf',bytes});state.pdfJsDocs.set(key,doc);
    for(let n=1;n<=doc.numPages;n++)state.pages.push({id:uid(),sourceKey:key,fileName:file.name,kind:'pdf',sourcePage:n,rotation:0,crop:defaultCrop(),transform:defaultTransform(),spaceMM:0});
    return doc.numPages;
  }
  if(/^image\//.test(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name)){
    const im=await normalizeImage(file);state.sources.set(key,{key,fileName:file.name,kind:'image',bytes:im.bytes,mime:im.mime,previewUrl:im.previewUrl});
    state.pages.push({id:uid(),sourceKey:key,fileName:file.name,kind:'image',sourcePage:1,rotation:0,crop:defaultCrop(),transform:defaultTransform(),spaceMM:0,previewUrl:im.previewUrl});return 1;
  }
  throw new Error(file.name+' is not supported.');
}
async function importZip(file){
  await ensureZip();const zip=await window.JSZip.loadAsync(file);
  const entries=Object.values(zip.files).filter(x=>!x.dir&&/\.(pdf|png|jpe?g|webp)$/i.test(x.name));let count=0;
  for(const z of entries){const ext=(z.name.split('.').pop()||'').toLowerCase(),mime=ext==='pdf'?'application/pdf':ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg',blob=await z.async('blob'),f=new File([blob],z.name.split('/').pop(),{type:mime});count+=await importFile(f);}
  if(!entries.length)toast('ZIP contained no supported PDF/image files.');return count;
}
async function addFiles(files){
  const list=[...files];if(!list.length)return;state.busy=true;updateControls();setStatus('Importing '+list.length+' item'+(list.length===1?'':'s')+'…');
  try{
    await ensurePdfLibs();let added=0;
    for(const f of list){try{added+=await importFile(f);}catch(err){console.error(err);toast(err.message||('Could not import '+f.name));}}
    if(!state.activeId&&state.pages[0]){state.activeId=state.pages[0].id;state.selected.add(state.activeId);state.anchorIndex=0;}
    await renderAll();setStatus('Added '+added+' page'+(added===1?'':'s')+'.');
  }finally{state.busy=false;updateControls();}
}

/* Preview source cache */
async function sourceRaster(p){
  const key=p.kind==='pdf'?'pdf:'+p.sourceKey+':'+p.sourcePage:'img:'+p.sourceKey;
  if(state.previewCache.has(key))return state.previewCache.get(key);
  let canvas;
  if(p.kind==='pdf'){
    const doc=state.pdfJsDocs.get(p.sourceKey),page=await doc.getPage(p.sourcePage),base=page.getViewport({scale:1}),scale=Math.min(2,1500/base.width),vp=page.getViewport({scale});
    canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(vp.width));canvas.height=Math.max(1,Math.floor(vp.height));await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:vp}).promise;
  }else{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=p.previewUrl;});
    canvas=document.createElement('canvas');const scale=Math.min(1,1800/img.naturalWidth,2400/img.naturalHeight);canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  }
  state.previewCache.set(key,canvas);return canvas;
}
function cropRotateRaster(src,p){
  const c=p.crop||defaultCrop(),l=clamp(c.left,0,40)/100,r=clamp(c.right,0,40)/100,t=clamp(c.top,0,40)/100,b=clamp(c.bottom,0,40)/100;
  const sx=Math.floor(src.width*l),sy=Math.floor(src.height*t),sw=Math.max(1,Math.floor(src.width*(1-l-r))),sh=Math.max(1,Math.floor(src.height*(1-t-b)));
  const rot=((p.rotation||0)%360+360)%360, out=document.createElement('canvas');if(rot===90||rot===270){out.width=sh;out.height=sw;}else{out.width=sw;out.height=sh;}
  const x=out.getContext('2d');x.save();if(rot===90){x.translate(out.width,0);x.rotate(Math.PI/2);}else if(rot===180){x.translate(out.width,out.height);x.rotate(Math.PI);}else if(rot===270){x.translate(0,out.height);x.rotate(-Math.PI/2);}x.drawImage(src,sx,sy,sw,sh,0,0,sw,sh);x.restore();return out;
}
async 
function layoutOnSheet(p,imgWidth,imgHeight,w,h){
  const mmX=w/A4.wMM,mmY=h/A4.hMM;
  const pad=state.safeArea?25.4:8;
  const minX=pad*mmX,minY=pad*mmY;
  const maxX=w-minX;
  let maxY=h-minY;
  if(p.makeSpace && state.assets.signature && $('#nlpdfUseSignature')?.checked){
    maxY=Math.min(maxY,h*state.sig.yPct-5*mmY);
  }
  const availableW=Math.max(1,maxX-minX),availableH=Math.max(1,maxY-minY);
  const fit=Math.min(availableW/imgWidth,availableH/imgHeight);
  const requested=clamp(p.transform?.scale||1,.3,2);
  const factor=(state.safeArea||p.makeSpace)?Math.min(requested,1):requested;
  const dw=imgWidth*fit*factor,dh=imgHeight*fit*factor;
  let x=(w-dw)/2+(p.transform?.xMM||0)*mmX;
  let y=minY+(availableH-dh)/2+(p.transform?.yMM||0)*mmY;
  if(state.safeArea||p.makeSpace){
    x=clamp(x,minX,Math.max(minX,maxX-dw));
    y=clamp(y,minY,Math.max(minY,maxY-dh));
  }
  return {x,y,w:dw,h:dh,fit:fit*factor,minX,minY,maxX,maxY};
}
async function drawPageToCanvas(p,canvas,w=840,h=1188){
  const source=await sourceRaster(p);
  const editing=state.cropMode&&p.id===state.activeId;
  const drawingPage=editing?{...p,crop:defaultCrop(),rotation:0}:p;
  const img=cropRotateRaster(source,drawingPage);
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  const L=layoutOnSheet(p,img.width,img.height,w,h);
  ctx.drawImage(img,L.x,L.y,L.w,L.h);
  if(editing)state.cropBounds={...L,pageId:p.id};
  return L;
}

/* A4 editor */
function activePage(){return state.pages.find(p=>p.id===state.activeId)||null;}
function selectedPages(){return state.pages.filter(p=>state.selected.has(p.id));}

async function renderActive(){
  const canvas=$('#nlpdfCanvas'),hint=$('#nlpdfPaperHint'),badge=$('#nlpdfPaperBadge'),dragHint=$('#nlpdfDragHint'),p=activePage();
  const epoch=++state.renderEpoch;
  canvas.width=840;canvas.height=1188;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,840,1188);
  $('#nlpdfSafeGuide')?.classList.toggle('hidden',!state.safeArea);
  if(!p){
    hint.classList.remove('hidden');badge.classList.add('hidden');dragHint.classList.add('hidden');
    $('#nlpdfCropLayer').classList.add('hidden');
    renderSignature(Boolean(state.assets.signature&&$('#nlpdfUseSignature')?.checked));
    syncPageControls();return;
  }
  hint.classList.add('hidden');badge.classList.remove('hidden');
  dragHint.classList.toggle('hidden',state.cropMode);
  badge.textContent='Document page '+(state.pages.findIndex(x=>x.id===p.id)+1);
  const temp=document.createElement('canvas');
  try{
    await drawPageToCanvas(p,temp,840,1188);
    if(epoch!==state.renderEpoch)return;
    ctx.clearRect(0,0,840,1188);ctx.drawImage(temp,0,0);
  }catch(err){if(epoch===state.renderEpoch){console.error(err);setStatus('Preview unavailable: '+err.message);}}
  if(epoch!==state.renderEpoch)return;
  if(state.cropMode)updateCropOverlay();
  else $('#nlpdfCropLayer').classList.add('hidden');
  renderSignature(Boolean(state.assets.signature&&$('#nlpdfUseSignature')?.checked&&!state.cropMode));
  syncPageControls();
}
function signatureApplies(p){
  if(!p||!state.assets.signature||!$('#nlpdfUseSignature')?.checked)return false;
  return $('#nlpdfSigScope').value==='all'||state.pages[state.pages.length-1]?.id===p.id;
}
function renderSignature(show){
  const img=$('#nlpdfSignaturePreview');if(!img)return;
  if(!show||!state.signatureUrl){img.classList.add('hidden');return;}
  if(img.src!==state.signatureUrl)img.src=state.signatureUrl;
  img.classList.remove('hidden');
  const maxY=1-state.sig.widthPct*(A4.wMM/A4.hMM)*state.sigAspect;
  state.sig.xPct=clamp(state.sig.xPct,0,1-state.sig.widthPct);
  state.sig.yPct=clamp(state.sig.yPct,0,Math.max(0,maxY));
  img.style.left=(state.sig.xPct*100)+'%';
  img.style.top=(state.sig.yPct*100)+'%';
  img.style.width=(state.sig.widthPct*100)+'%';
  img.style.height='auto';
  img.title=activePage()&&!signatureApplies(activePage())
    ? 'Placement preview (export applies to last document page)'
    : 'Drag signature to reposition';
}
function syncPageControls(){
  const p=activePage(),disabled=!p;
  $('#nlpdfActiveLabel').textContent=p?'Page '+(state.pages.findIndex(x=>x.id===p.id)+1):'Select a page';
  $('#nlpdfStartCrop').disabled=disabled||state.cropMode;
  $('#nlpdfResetCrop').disabled=disabled||state.cropMode;
  $('#nlpdfApplyCrop').classList.toggle('hidden',!state.cropMode);
  $('#nlpdfCancelCrop').classList.toggle('hidden',!state.cropMode);
  $('#nlpdfCropPanel').classList.toggle('is-cropping',state.cropMode);
  $('#nlpdfContentScale').disabled=disabled||state.cropMode;
  $('#nlpdfContentScale').value=p?Math.round((p.transform?.scale||1)*100):100;
  $('#nlpdfContentScaleValue').textContent=(p?Math.round((p.transform?.scale||1)*100):100)+'%';
  $('#nlpdfCenterContent').disabled=disabled||state.cropMode;
  $('#nlpdfResetTransform').disabled=disabled||state.cropMode;
  $('#nlpdfSpaceStatus').textContent=p?.makeSpace?'Make Space active on this page.':'Reserve space automatically above the signature.';
}

function updateControls(){
  const sel=selectedPages(),p=activePage(),i=p?state.pages.findIndex(x=>x.id===p.id):-1;
  ['nlpdfRotateLeft','nlpdfRotateRight','nlpdfDuplicate','nlpdfDelete'].forEach(id=>$('#'+id).disabled=!sel.length||state.busy);
  $('#nlpdfMoveUp').disabled=!p||i<=0||state.busy;$('#nlpdfMoveDown').disabled=!p||i<0||i>=state.pages.length-1||state.busy;$('#nlpdfMoveFirst').disabled=!p||i<=0||state.busy;$('#nlpdfMoveLast').disabled=!p||i<0||i>=state.pages.length-1||state.busy;$('#nlpdfCreate').disabled=!state.pages.length||state.busy;
  $('#nlpdfSelectionLabel').textContent=sel.length?sel.length+' selected · active page '+(i+1):'No page selected';$('#nlpdfPageCount').textContent=state.pages.length;$('#nlpdfFileCount').textContent=state.sources.size;
}
function selectPage(id,event={}){const i=state.pages.findIndex(p=>p.id===id);if(i<0)return;if(state.cropMode){state.cropMode=false;state.cropDraft=null;}state.activeId=id;const multi=event.ctrlKey||event.metaKey;
  if(event.shiftKey&&state.anchorIndex>=0){const [a,b]=[state.anchorIndex,i].sort((x,y)=>x-y);if(!multi)state.selected.clear();for(let n=a;n<=b;n++)state.selected.add(state.pages[n].id);}
  else if(multi){state.selected.has(id)?state.selected.delete(id):state.selected.add(id);state.anchorIndex=i;}
  else{state.selected.clear();state.selected.add(id);state.anchorIndex=i;}
  renderAll();
}
function deleteSelected(){if(!state.selected.size)return;if(state.cropMode){state.cropMode=false;state.cropDraft=null;}const ids=new Set(state.selected),old=state.pages.findIndex(p=>p.id===state.activeId);state.pages=state.pages.filter(p=>!ids.has(p.id));state.selected.clear();const n=state.pages[Math.min(Math.max(old,0),state.pages.length-1)];state.activeId=n?.id||'';if(n){state.selected.add(n.id);state.anchorIndex=state.pages.indexOf(n);}else state.anchorIndex=-1;renderAll();}
function rotateSelected(d){if(state.cropMode)return;for(const p of state.pages)if(state.selected.has(p.id))p.rotation=((p.rotation||0)+d+360)%360;renderAll();}
function duplicateSelected(){const ids=[...state.selected],newIds=[];for(const id of ids){const i=state.pages.findIndex(p=>p.id===id);if(i<0)continue;const p=state.pages[i],cp={...p,id:uid(),crop:{...p.crop},transform:{...p.transform}};state.pages.splice(i+1,0,cp);newIds.push(cp.id);}if(newIds.length){state.selected=new Set(newIds);state.activeId=newIds[newIds.length-1];state.anchorIndex=state.pages.findIndex(p=>p.id===state.activeId);}renderAll();}
function moveActive(d){const p=activePage();if(!p)return;const i=state.pages.indexOf(p),j=i+d;if(j<0||j>=state.pages.length)return;[state.pages[i],state.pages[j]]=[state.pages[j],state.pages[i]];state.anchorIndex=j;renderAll();}
function reorder(a,b){
  if(!a||!b||a===b)return;
  const ids=state.selected.has(a)?new Set(state.selected):new Set([a]);
  const moving=state.pages.filter(p=>ids.has(p.id)),rest=state.pages.filter(p=>!ids.has(p.id));
  if(!moving.length||ids.has(b))return;
  const j=rest.findIndex(p=>p.id===b);if(j<0)return;
  rest.splice(j,0,...moving);
  state.pages=rest;state.anchorIndex=state.pages.findIndex(p=>p.id===state.activeId);renderAll();
}
function moveToEdge(edge,draggedId=null){
  const ids=draggedId&&!state.selected.has(draggedId)?new Set([draggedId]):new Set(state.selected);
  if(!ids.size)return;
  const moving=state.pages.filter(p=>ids.has(p.id)),rest=state.pages.filter(p=>!ids.has(p.id));
  state.pages=edge==='first'?[...moving,...rest]:[...rest,...moving];
  state.anchorIndex=state.pages.findIndex(p=>p.id===state.activeId);renderAll();
}
function resetTransform(){const p=activePage();if(!p||state.cropMode)return;p.transform=defaultTransform();renderAll();}
function centerContent(){const p=activePage();if(!p||state.cropMode)return;p.transform.xMM=0;p.transform.yMM=0;renderAll();}
function applySpace(clear=false){
  if(!clear&&(!state.assets.signature||!$('#nlpdfUseSignature')?.checked)){toast('Enable a saved Signature first.');return;}
  const scope=$('input[name="nlpdfSpaceScope"]:checked')?.value||'current';
  const pages=scope==='all'?state.pages:(activePage()?[activePage()]:[]);
  for(const p of pages){p.makeSpace=!clear;p.spaceMM=0;}
  renderAll();toast((clear?'Cleared':'Applied')+' signature clearance on '+pages.length+' page(s).');
}
function startCrop(){
  const p=activePage();if(!p)return;state.cropMode=true;state.cropDraft={...p.crop};renderActive();
}
function applyCrop(){
  const p=activePage();if(!p||!state.cropMode)return;
  p.crop={...state.cropDraft};state.cropMode=false;state.cropDraft=null;state.cropBounds=null;renderAll();
}
function cancelCrop(){state.cropMode=false;state.cropDraft=null;state.cropBounds=null;renderActive();}
function resetCrop(){const p=activePage();if(!p)return;state.cropMode=false;state.cropDraft=null;p.crop=defaultCrop();renderAll();}
function updateCropOverlay(){
  const layer=$('#nlpdfCropLayer'),box=$('#nlpdfCropRegion'),b=state.cropBounds;
  if(!state.cropMode||!b||b.pageId!==state.activeId){layer.classList.add('hidden');return;}
  layer.classList.remove('hidden');
  layer.style.left=(b.x/840*100)+'%';layer.style.top=(b.y/1188*100)+'%';
  layer.style.width=(b.w/840*100)+'%';layer.style.height=(b.h/1188*100)+'%';
  const d=state.cropDraft||defaultCrop();
  box.style.left=d.left+'%';box.style.top=d.top+'%';
  box.style.width=(100-d.left-d.right)+'%';box.style.height=(100-d.top-d.bottom)+'%';
}
function setupCropInteraction(){
  const box=$('#nlpdfCropRegion'),layer=$('#nlpdfCropLayer');let drag=null;
  box.addEventListener('pointerdown',e=>{
    if(!state.cropMode||e.button!==0)return;
    const r=layer.getBoundingClientRect();
    drag={handle:e.target.dataset.cropHandle||'move',x:e.clientX,y:e.clientY,
      start:{...state.cropDraft},width:Math.max(1,r.width),height:Math.max(1,r.height)};
    box.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
  });
  box.addEventListener('pointermove',e=>{
    if(!drag)return;
    const ox=drag.start,dx=(e.clientX-drag.x)/drag.width*100,dy=(e.clientY-drag.y)/drag.height*100,h=drag.handle,d={...ox};
    if(h==='move'){
      const w=100-ox.left-ox.right,hh=100-ox.top-ox.bottom;
      d.left=clamp(ox.left+dx,0,100-w);d.right=100-w-d.left;
      d.top=clamp(ox.top+dy,0,100-hh);d.bottom=100-hh-d.top;
    }else{
      if(h.includes('w'))d.left=clamp(ox.left+dx,0,100-ox.right-5);
      if(h.includes('e'))d.right=clamp(ox.right-dx,0,100-d.left-5);
      if(h.includes('n'))d.top=clamp(ox.top+dy,0,100-ox.bottom-5);
      if(h.includes('s'))d.bottom=clamp(ox.bottom-dy,0,100-d.top-5);
    }
    for(const k of ['top','right','bottom','left'])d[k]=Math.round(d[k]*10)/10;
    state.cropDraft=d;updateCropOverlay();
  });
  box.addEventListener('pointerup',()=>drag=null);
  box.addEventListener('pointercancel',()=>drag=null);
}
function fitPaper(){
  const stage=$('#nlpdfStage'),paper=$('#nlpdfPaper');if(!stage||!paper||stage.classList.contains('hidden'))return;
  const availableW=Math.max(170,stage.clientWidth-58),availableH=Math.max(190,stage.clientHeight-44);
  const fitted=Math.min(availableW,availableH*A4.wMM/A4.hMM);
  paper.style.setProperty('--nlpdf-paper-width',Math.max(150,Math.round(fitted*state.zoom))+'px');
  $('#nlpdfZoomValue').textContent=Math.round(state.zoom*100)+'%';
}
function setZoom(next){state.zoom=clamp(Math.round(next*100)/100,.5,3);fitPaper();}


/* Stack / thumbnails */
function stackMeta(which){const a=state.assets[which],info=state.assetInfo[which],enabled=$('#'+(which==='front'?'nlpdfUseFront':'nlpdfUseBack'))?.checked;return a&&enabled?{which,name:a.name,count:info?.pageCount||1}:null;}
function stackMini(m){return '<article class="nlpdf-page-card" data-stack="'+m.which+'"><div class="nlpdf-stack-mini"><i></i><i></i><i>'+esc(m.which==='front'?'Front':'Back')+'</i><b>'+m.count+'</b></div><div class="nlpdf-page-meta"><strong>Default '+(m.which==='front'?'Front':'Back')+'</strong><span>'+m.count+' page'+(m.count===1?'':'s')+' · locked</span></div></article>';}
function stackGrid(m){return '<article class="nlpdf-grid-card nlpdf-stack-card" data-stack="'+m.which+'"><div class="nlpdf-stack-thumb"><span class="nlpdf-stack-sheet"></span><span class="nlpdf-stack-sheet"></span><span class="nlpdf-stack-sheet"><strong>Default '+(m.which==='front'?'Front':'Back')+'</strong></span><span class="nlpdf-stack-count">'+m.count+' page'+(m.count===1?'':'s')+'</span></div><div class="nlpdf-grid-meta"><strong>'+esc(m.name)+'</strong><span>Locked default asset</span></div></article>';}
async function thumbCanvas(p,w=140,h=198){const c=document.createElement('canvas');await drawPageToCanvas(p,c,w,h);return c;}
async function renderFilmstrip(){
  const s=$('#nlpdfFilmstrip'),front=stackMeta('front'),back=stackMeta('back');
  s.innerHTML=(front?stackMini(front):'')+state.pages.map((p,i)=>'<article class="nlpdf-page-card '+(state.selected.has(p.id)?'selected ':'')+(state.activeId===p.id?'active':'')+'" data-page-id="'+p.id+'" draggable="true"><div class="nlpdf-thumb"><span class="nlpdf-page-index">'+(i+1)+'</span><span class="nlpdf-loading"></span></div><div class="nlpdf-page-meta"><strong>'+esc(p.fileName)+'</strong><span>Page '+(i+1)+'</span></div></article>').join('')+(back?stackMini(back):'');
  for(const p of state.pages){const h=s.querySelector('[data-page-id="'+CSS.escape(p.id)+'"] .nlpdf-thumb');if(!h)continue;thumbCanvas(p,140,198).then(c=>h.appendChild(c)).catch(()=>{});}
}
async function renderGrid(){
  const g=$('#nlpdfGrid'),front=stackMeta('front'),back=stackMeta('back');
  g.innerHTML=(front?stackGrid(front):'')+state.pages.map((p,i)=>'<article class="nlpdf-grid-card '+(state.selected.has(p.id)?'selected ':'')+(state.activeId===p.id?'active':'')+'" data-page-id="'+p.id+'" draggable="true"><div class="nlpdf-grid-thumb"><span class="nlpdf-page-index">'+(i+1)+'</span></div><div class="nlpdf-grid-meta"><strong>'+esc(p.fileName)+'</strong><span>Document page '+(i+1)+'</span></div></article>').join('')+(back?stackGrid(back):'');
  for(const p of state.pages){const h=g.querySelector('[data-page-id="'+CSS.escape(p.id)+'"] .nlpdf-grid-thumb');if(!h)continue;thumbCanvas(p,260,368).then(c=>h.appendChild(c)).catch(()=>{});}
}
async function renderAll(){updateControls();await Promise.allSettled([renderActive(),renderFilmstrip(),renderGrid()]);}

/* View switching */
function setView(mode){state.viewMode=mode==='grid'?'grid':'single';$('#nlpdfSingleView').classList.toggle('active',state.viewMode==='single');$('#nlpdfGridView').classList.toggle('active',state.viewMode==='grid');$('#nlpdfStage').classList.toggle('hidden',state.viewMode==='grid');$('#nlpdfGridStage').classList.toggle('hidden',state.viewMode!=='grid');$('#nlpdfFilmstripWrap').classList.toggle('hidden',state.viewMode==='grid');if(state.viewMode==='grid')renderGrid();else renderActive();}

/* Export */
async function sourcePdfDoc(k){if(state.pdfLibDocs.has(k))return state.pdfLibDocs.get(k);const s=state.sources.get(k),d=await window.PDFLib.PDFDocument.load(s.bytes.slice());state.pdfLibDocs.set(k,d);return d;}
function pdfLayout(srcW,srcH,p){
  const margin=22,space=(p.spaceMM||0)*72/25.4,availW=A4.wPt-margin*2,availH=A4.hPt-margin*2-space,rot=((p.rotation||0)%360+360)%360,rw=(rot===90||rot===270)?srcH:srcW,rh=(rot===90||rot===270)?srcW:srcH,fit=Math.min(availW/rw,availH/rh)*clamp(p.transform?.scale||1,.3,2),w=srcW*fit,h=srcH*fit,shownW=rw*fit,shownH=rh*fit,dx=(p.transform?.xMM||0)*72/25.4,dy=(p.transform?.yMM||0)*72/25.4;
  return {rot,w,h,shownW,shownH,x:(A4.wPt-shownW)/2+dx,y:space+margin+(availH-shownH)/2-dy};
}
function drawEmbedded(page,embedded,p){
  const L=pdfLayout(embedded.width,embedded.height,p),o={width:L.w,height:L.h,rotate:window.PDFLib.degrees(L.rot)};
  if(L.rot===0){o.x=L.x;o.y=L.y;}else if(L.rot===90){o.x=L.x+L.shownW;o.y=L.y;}else if(L.rot===180){o.x=L.x+L.shownW;o.y=L.y+L.shownH;}else{o.x=L.x;o.y=L.y+L.shownH;}page.drawPage(embedded,o);
}
async function addDocPage(out,p){
  if(p.kind==='pdf'){
    const src=await sourcePdfDoc(p.sourceKey),sp=src.getPage(p.sourcePage-1),sz=sp.getSize(),c=p.crop,left=sz.width*c.left/100,right=sz.width*(1-c.right/100),bottom=sz.height*c.bottom/100,top=sz.height*(1-c.top/100),embedded=await out.embedPage(sp,{left,bottom,right,top}),pg=out.addPage([A4.wPt,A4.hPt]);drawEmbedded(pg,embedded,p);return pg;
  }
  const src=await sourceRaster(p),cropped=cropRotateRaster(src,p),blob=await new Promise(res=>cropped.toBlob(res,'image/png')),bytes=new Uint8Array(await blob.arrayBuffer()),img=await out.embedPng(bytes),pg=out.addPage([A4.wPt,A4.hPt]);
  const margin=22,space=(p.spaceMM||0)*72/25.4,availW=A4.wPt-margin*2,availH=A4.hPt-margin*2-space,fit=Math.min(availW/img.width,availH/img.height)*clamp(p.transform?.scale||1,.3,2),w=img.width*fit,h=img.height*fit,dx=(p.transform?.xMM||0)*72/25.4,dy=(p.transform?.yMM||0)*72/25.4;
  pg.drawImage(img,{x:(A4.wPt-w)/2+dx,y:space+margin+(availH-h)/2-dy,width:w,height:h});return pg;
}
async function appendAsset(out,a){if(!a)return 0;const bytes=new Uint8Array(await a.blob.arrayBuffer());if(a.type==='application/pdf'||/\.pdf$/i.test(a.name)){const src=await window.PDFLib.PDFDocument.load(bytes),pages=await out.copyPages(src,src.getPageIndices());pages.forEach(p=>out.addPage(p));return pages.length;}const img=a.type==='image/jpeg'?await out.embedJpg(bytes):await out.embedPng(bytes),pg=out.addPage([A4.wPt,A4.hPt]),m=22,fit=Math.min((A4.wPt-m*2)/img.width,(A4.hPt-m*2)/img.height),w=img.width*fit,h=img.height*fit;pg.drawImage(img,{x:(A4.wPt-w)/2,y:(A4.hPt-h)/2,width:w,height:h});return 1;}
async function embedSignature(out){if(!state.assets.signature)return null;const b=new Uint8Array(await state.assets.signature.blob.arrayBuffer());return state.assets.signature.type==='image/jpeg'?await out.embedJpg(b):await out.embedPng(b);}
function drawSignature(page,img){
  const w=page.getWidth()*state.sig.widthPct,d=img.scale(1),h=w*d.height/d.width,x=clamp(page.getWidth()*state.sig.xPct,0,page.getWidth()-w),y=clamp(page.getHeight()-(page.getHeight()*state.sig.yPct)-h,0,page.getHeight()-h);page.drawImage(img,{x,y,width:w,height:h,opacity:.98});
}
async function buildPdf(){
  await ensurePdfLibs();const out=await window.PDFLib.PDFDocument.create();
  if($('#nlpdfUseFront').checked&&state.assets.front)await appendAsset(out,state.assets.front);
  const sig=$('#nlpdfUseSignature').checked&&state.assets.signature?await embedSignature(out):null,scope=$('#nlpdfSigScope').value;
  for(let i=0;i<state.pages.length;i++){const pg=await addDocPage(out,state.pages[i]);if(sig&&(scope==='all'||i===state.pages.length-1))drawSignature(pg,sig);}
  if($('#nlpdfUseBack').checked&&state.assets.back)await appendAsset(out,state.assets.back);
  out.setCreator('BU International Center Workspace');out.setProducer('New Letter PDF Builder');return new Uint8Array(await out.save());
}
function customNoIenTemplate(){try{const e=JSON.parse(localStorage.getItem(NO_IEN_OVERRIDE_KEY)||'null');if(e&&typeof e.base64==='string'&&e.base64.length>100)return e;}catch{}return null;}
function letterBytes(key){const t=(key==='bachelor_no_ien'?customNoIenTemplate():null)||window.LETTER_TEMPLATES?.[key];if(!t?.base64)throw new Error('Selected Word template is missing.');const bin=atob(t.base64),b=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);return b;}
async function writeFile(dir,name,data){const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(data);await w.close();}
function caseNumber(){return clean($('#caseStudentNumber')?.value)||clean($('#studentNumber')?.value);}
function caseName(){return clean($('#caseStudentName')?.value)||clean($('#studentName')?.value);}
function openExport(){
  $('#nlpdfExportNumber').value=caseNumber();$('#nlpdfExportName').value=caseName();$('#nlpdfExportPdfName').dataset.auto='1';syncExportPreview();
  $('#nlpdfFinalPages').textContent=state.pages.length+' document page'+(state.pages.length===1?'':'s')+(stackMeta('front')?' + front':'')+(stackMeta('back')?' + back':'');
  $('#nlpdfExportModal').classList.add('open');$('#nlpdfExportModal').setAttribute('aria-hidden','false');
}
function closeExport(){$('#nlpdfExportModal').classList.remove('open');$('#nlpdfExportModal').setAttribute('aria-hidden','true');}
function syncExportPreview(){
  const num=safePath($('#nlpdfExportNumber').value)||'3408',name=safePath($('#nlpdfExportName').value)||'Miss ABC',pdf=$('#nlpdfExportPdfName');
  if(pdf.dataset.auto==='1'||!clean(pdf.value))pdf.value='Documents_'+name+'.pdf';
  const mode=$('input[name="nlpdfOutputMode"]:checked')?.value||'pdf';$('#nlpdfFinalFolder').textContent=mode==='package'?num+' '+name:'Not created';$('#nlpdfFinalLetter').textContent=mode==='package'?'Letter_'+name+'.docx':'Not created';$('#nlpdfFinalPdf').textContent=pdf.value;$('#nlpdfConfirmExport').textContent=mode==='package'?'Create Package':'Create PDF';
}
async function chooseDestination(){
  if(!window.showDirectoryPicker){toast('Folder selection requires Chrome or Edge.');return false;}
  try{state.destinationHandle=await window.showDirectoryPicker({mode:'readwrite'});$('#nlpdfDestinationName').textContent=state.destinationHandle.name||'Selected folder';$('#nlpdfDestinationHelp').textContent='Output will be created here for this export.';return true;}catch(err){if(err?.name!=='AbortError')toast(err.message||'Could not select destination.');return false;}
}
async function confirmExport(){
  if(state.busy)return;const name=safePath($('#nlpdfExportName').value),num=safePath($('#nlpdfExportNumber').value),mode=$('input[name="nlpdfOutputMode"]:checked')?.value||'pdf';
  if(!name){toast('Enter the student name.');$('#nlpdfExportName').focus();return;}if(mode==='package'&&!num){toast('Enter the student number.');$('#nlpdfExportNumber').focus();return;}
  if(!state.destinationHandle){const ok=await chooseDestination();if(!ok)return;}
  state.busy=true;$('#nlpdfConfirmExport').disabled=true;setStatus('Creating final PDF…');
  try{
    const bytes=await buildPdf();let pdfName=safeFile($('#nlpdfExportPdfName').value||('Documents_'+name+'.pdf'));if(!/\.pdf$/i.test(pdfName))pdfName+='.pdf';
    if(mode==='package'){const folder=await state.destinationHandle.getDirectoryHandle(num+' '+name,{create:true});await writeFile(folder,'Letter_'+name+'.docx',new Blob([letterBytes($('#nlpdfExportLetterType').value)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));await writeFile(folder,pdfName,new Blob([bytes],{type:'application/pdf'}));toast('Folder + Letter + PDF created.');}
    else{await writeFile(state.destinationHandle,pdfName,new Blob([bytes],{type:'application/pdf'}));toast('PDF created.');}
    closeExport();setStatus('Ready · Export complete');
  }catch(err){console.error(err);toast(err.message||'Could not create output.');setStatus('Export failed');}
  finally{state.busy=false;$('#nlpdfConfirmExport').disabled=false;updateControls();}
}

/* Events */
function setupDrop(el){
  ['dragenter','dragover'].forEach(t=>el.addEventListener(t,e=>{e.preventDefault();el.classList.add('dragover');e.dataTransfer.dropEffect='copy';}));
  ['dragleave','drop'].forEach(t=>el.addEventListener(t,e=>{e.preventDefault();if(t==='drop')el.classList.remove('dragover');else if(!el.contains(e.relatedTarget))el.classList.remove('dragover');}));
  el.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
}
function setupPageContainer(el){
  el.addEventListener('click',e=>{const card=e.target.closest('[data-page-id]');if(card)selectPage(card.dataset.pageId,e);});
  el.addEventListener('dblclick',e=>{const card=e.target.closest('[data-page-id]');if(card){selectPage(card.dataset.pageId,e);setView('single');}});
  el.addEventListener('dragstart',e=>{const card=e.target.closest('[data-page-id]');if(!card)return;state.dragId=card.dataset.pageId;card.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
  el.addEventListener('dragend',e=>{e.target.closest('[data-page-id]')?.classList.remove('dragging');$$('.drag-target',el).forEach(x=>x.classList.remove('drag-target'));state.dragId='';});
  el.addEventListener('dragover',e=>{const card=e.target.closest('[data-page-id]');if(!card)return;e.preventDefault();$$('.drag-target',el).forEach(x=>x.classList.remove('drag-target'));card.classList.add('drag-target');});
  el.addEventListener('drop',e=>{const card=e.target.closest('[data-page-id]');if(!card)return;e.preventDefault();reorder(state.dragId,card.dataset.pageId);state.dragId='';});
}
function setupContentDrag(){
  const paper=$('#nlpdfPaper'),canvas=$('#nlpdfCanvas');let drag=null;
  canvas.addEventListener('pointerdown',e=>{const p=activePage();if(!p||e.button!==0)return;drag={x:e.clientX,y:e.clientY,startX:p.transform.xMM,startY:p.transform.yMM};canvas.setPointerCapture(e.pointerId);e.preventDefault();});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;const p=activePage(),r=paper.getBoundingClientRect();p.transform.xMM=drag.startX+(e.clientX-drag.x)/r.width*A4.wMM;p.transform.yMM=drag.startY+(e.clientY-drag.y)/r.height*A4.hMM;renderActive();});
  const end=e=>{if(drag){drag=null;renderFilmstrip();renderGrid();}};
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
}
function setupSignatureDrag(){
  const img=$('#nlpdfSignaturePreview'),paper=$('#nlpdfPaper');let d=null;
  img.addEventListener('pointerdown',e=>{if(img.classList.contains('hidden'))return;d={x:e.clientX,y:e.clientY,sx:state.sig.xPct,sy:state.sig.yPct};img.classList.add('dragging');img.setPointerCapture(e.pointerId);e.stopPropagation();e.preventDefault();});
  img.addEventListener('pointermove',e=>{if(!d)return;const r=paper.getBoundingClientRect();state.sig.xPct=clamp(d.sx+(e.clientX-d.x)/r.width,0,1-state.sig.widthPct);state.sig.yPct=clamp(d.sy+(e.clientY-d.y)/r.height,0,.95);renderSignature(true);});
  const end=()=>{if(d){d=null;img.classList.remove('dragging');savePrefs();}};
  img.addEventListener('pointerup',end);img.addEventListener('pointercancel',end);
}
function ignoreDeleteKey(e){return e.target&&(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable);}

async function build(){
  const docs=$('#workspaceDocuments'),legacy=docs?.querySelector('.document-workspace-grid');if(!docs||!legacy)return;
  docs.classList.add('nlpdf-primary');if(!$('#newLetterPdfWorkspace'))legacy.insertAdjacentHTML('afterend',workspaceMarkup());
  await ensurePdfLibs();await loadAssets();
  const p=prefs();$('#nlpdfSigScope').value=p.sigScope;$('#nlpdfSpace').value=p.spaceMM;$('#nlpdfSpaceValue').textContent=p.spaceMM+' mm';$('#nlpdfSigSize').value=Math.round(state.sig.widthPct*100);$('#nlpdfSigSizeValue').textContent=Math.round(state.sig.widthPct*100)+'%';

  $('#nlpdfCreateFolderOnly').addEventListener('click',()=>$('#documentsCreateFolder')?.click());
  $('#nlpdfAddFiles').addEventListener('click',()=>$('#nlpdfFileInput').click());$('#nlpdfFileInput').addEventListener('change',e=>{addFiles(e.target.files);e.target.value='';});
  $$('[data-asset-import]').forEach(b=>b.addEventListener('click',()=>{state.pendingAsset=b.dataset.assetImport;const i=$('#nlpdfAssetInput');i.accept=state.pendingAsset==='signature'?'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp':'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp';i.click();}));
  $$('[data-asset-remove]').forEach(b=>b.addEventListener('click',()=>removeAsset(b.dataset.assetRemove).catch(err=>toast(err.message))));
  $('#nlpdfAssetInput').addEventListener('change',async e=>{const f=e.target.files?.[0];try{if(f&&state.pendingAsset)await importAsset(state.pendingAsset,f);}catch(err){console.error(err);toast(err.message||'Could not save asset.');}finally{e.target.value='';state.pendingAsset='';}});
  ['nlpdfUseFront','nlpdfUseBack'].forEach(id=>$('#'+id).addEventListener('change',()=>{savePrefs();renderFilmstrip();renderGrid();}));
  ['nlpdfUseSignature','nlpdfSigScope'].forEach(id=>$('#'+id).addEventListener('change',()=>{savePrefs();renderActive();}));
  $('#nlpdfSigSize').addEventListener('input',e=>{state.sig.widthPct=Number(e.target.value)/100;$('#nlpdfSigSizeValue').textContent=e.target.value+'%';state.sig.xPct=clamp(state.sig.xPct,0,1-state.sig.widthPct);savePrefs();renderSignature(signatureApplies(activePage()));});
  $('#nlpdfResetSignature').addEventListener('click',()=>{state.sig.xPct=.72;state.sig.yPct=.80;state.sig.widthPct=.22;$('#nlpdfSigSize').value=22;$('#nlpdfSigSizeValue').textContent='22%';savePrefs();renderSignature(signatureApplies(activePage()));});

  $('#nlpdfRotateLeft').addEventListener('click',()=>rotateSelected(-90));$('#nlpdfRotateRight').addEventListener('click',()=>rotateSelected(90));$('#nlpdfMoveUp').addEventListener('click',()=>moveActive(-1));$('#nlpdfMoveDown').addEventListener('click',()=>moveActive(1));$('#nlpdfDuplicate').addEventListener('click',duplicateSelected);$('#nlpdfDelete').addEventListener('click',deleteSelected);
  for(const [prop,id] of [['top','nlpdfCropTop'],['right','nlpdfCropRight'],['bottom','nlpdfCropBottom'],['left','nlpdfCropLeft']])$('#'+id).addEventListener('input',e=>{const p=activePage();if(!p)return;p.crop[prop]=Number(e.target.value);$('#'+id+'Value').textContent=e.target.value+'%';renderActive();});
  $('#nlpdfResetCrop').addEventListener('click',()=>{const p=activePage();if(!p)return;p.crop=defaultCrop();renderAll();});
  $('#nlpdfContentScale').addEventListener('input',e=>{const p=activePage();if(!p)return;p.transform.scale=Number(e.target.value)/100;$('#nlpdfContentScaleValue').textContent=e.target.value+'%';renderActive();});
  $('#nlpdfCenterContent').addEventListener('click',centerContent);$('#nlpdfResetTransform').addEventListener('click',resetTransform);
  $('#nlpdfSpace').addEventListener('input',e=>{$('#nlpdfSpaceValue').textContent=e.target.value+' mm';savePrefs();});$('#nlpdfApplySpace').addEventListener('click',()=>applySpace(false));$('#nlpdfClearSpace').addEventListener('click',()=>applySpace(true));
  $('#nlpdfSingleView').addEventListener('click',()=>setView('single'));$('#nlpdfGridView').addEventListener('click',()=>setView('grid'));

  setupDrop($('#nlpdfStage'));setupDrop($('#nlpdfGridStage'));setupPageContainer($('#nlpdfFilmstrip'));setupPageContainer($('#nlpdfGrid'));setupContentDrag();setupSignatureDrag();
  document.addEventListener('keydown',e=>{if((e.key==='Backspace'||e.key==='Delete')&&!ignoreDeleteKey(e)&&state.selected.size){e.preventDefault();deleteSelected();}});
  $('#nlpdfCreate').addEventListener('click',openExport);
  $$('[data-nlpdf-close]').forEach(x=>x.addEventListener('click',closeExport));$('#nlpdfChooseDestination').addEventListener('click',chooseDestination);$('#nlpdfConfirmExport').addEventListener('click',confirmExport);
  ['nlpdfExportNumber','nlpdfExportName'].forEach(id=>$('#'+id).addEventListener('input',()=>{if(id==='nlpdfExportName')$('#nlpdfExportPdfName').dataset.auto='1';syncExportPreview();}));
  $('#nlpdfExportPdfName').addEventListener('input',e=>{e.target.dataset.auto='0';syncExportPreview();});$$('input[name="nlpdfOutputMode"]').forEach(x=>x.addEventListener('change',syncExportPreview));

  renderAssets();await updateAssetInfo();await renderAll();updateControls();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>build().catch(console.error),{once:true});else build().catch(console.error);
})();