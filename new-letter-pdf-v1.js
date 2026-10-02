(() => {
'use strict';

const DB_NAME='buic-new-letter-pdf-assets-v1', DB_VERSION=1, STORE='assets';
const PREF_KEY='buic-new-letter-pdf-prefs-v4';
const NO_IEN_OVERRIDE_KEY='bu-ic-bachelor-no-ien-template-override-v1';
const LETTER_PACKAGE_DATES_KEY='buic-letter-package-dates-v1';
const A4={wMM:210,hMM:297,wPt:595.28,hPt:841.89};
const state={
  pages:[], selected:new Set(), activeId:'', anchorIndex:-1, viewMode:'single',
  sources:new Map(), pdfJsDocs:new Map(), pdfLibDocs:new Map(), previewCache:new Map(),
  assets:{front:null,back:null,signature:null}, assetInfo:{front:null,back:null},
  busy:false, dragId:'', pendingAsset:'', destinationHandle:null,
  zoom:1, safeArea:false, duplicateDetection:true, duplicateOnly:false, duplicateGroups:new Map(), duplicatePageHashes:new Map(), duplicateDismissed:new Set(), duplicateHashCache:new Map(), duplicateScanToken:0,
  cropMode:false, cropDraft:null, renderEpoch:0, cropBounds:null, sigAspect:.32, signaturePageId:'', toolOpen:'', guides:{x:false,y:false}, contentBounds:null, history:{undo:[],redo:[],current:null,restoring:false},
  editLetterRequested:false, pendingLetter:null,
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
  try{const p=Object.assign({front:true,back:true,signature:false,sigScope:'all',sigWidth:.22,sigX:.72,sigY:.80,safeArea:false,duplicateDetection:true},JSON.parse(localStorage.getItem(PREF_KEY)||'{}'));if(p.sigScope==='last')p.sigScope='all';return p;}
  catch{return {front:true,back:true,signature:false,sigScope:'all',sigWidth:.22,sigX:.72,sigY:.80,spaceMM:25,safeArea:false,duplicateDetection:true};}
}
function savePrefs(){
  try{localStorage.setItem(PREF_KEY,JSON.stringify({
    front:Boolean($('#nlpdfUseFront')?.checked),back:Boolean($('#nlpdfUseBack')?.checked),signature:Boolean($('#nlpdfUseSignature')?.checked),
    sigScope:$('#nlpdfSigScope')?.value||'all',sigWidth:state.sig.widthPct,sigX:state.sig.xPct,sigY:state.sig.yPct,
    safeArea:Boolean($('#nlpdfSafeArea')?.checked),duplicateDetection:Boolean($('#nlpdfDetectDuplicates')?.checked)
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
      '<div class="nlpdf-side-head"><div class="nlpdf-side-title"><span class="eyebrow">NEW LETTER</span><strong>PDF Builder</strong></div><button class="nlpdf-add-new-file" id="nlpdfAddNewFile" type="button">+ Add new file</button></div>'+
      '<div class="nlpdf-side-scroll">'+
        '<section class="nlpdf-panel"><div class="nlpdf-panel-title"><strong>Default asset · Front / Back</strong><span>Locked paper stacks</span></div>'+
          assetRow('front','Front document',p.front)+assetRow('back','Back document',p.back)+'</section>'+ 
        '<section class="nlpdf-panel"><div class="nlpdf-panel-title"><strong>Default asset · Signature</strong><span>Saved locally</span></div>'+assetRow('signature','Signature',p.signature,true)+
          '<div class="nlpdf-signature-controls"><select id="nlpdfSigScope" hidden aria-label="Signature scope"><option value="all">All document pages</option></select><div class="wide">'+rangeMarkup('Signature size','nlpdfSigSize',10,42,1,Math.round(p.sigWidth*100),'%')+'</div></div>'+
        '</section>'+
        '<section class="nlpdf-panel" id="nlpdfCropPanel"><div class="nlpdf-panel-title"><strong>Crop tool</strong><span id="nlpdfActiveLabel">Select a page</span></div></section>'+
        '<section class="nlpdf-panel"><div class="nlpdf-panel-title"><strong>Position & scale</strong><span>Drag content<br>inside A4</span></div>'+
          rangeMarkup('Content scale','nlpdfContentScale',55,150,1,100,'%')+
          '<div class="nlpdf-row"><button class="nlpdf-btn" id="nlpdfCenterContent" type="button" disabled>↔ Center content</button></div>'+
        '</section>'+
        '<section class="nlpdf-panel nlpdf-safe-strip" id="nlpdfSafePanel"><div class="nlpdf-toolbar-toggles">'+
          '<label class="nlpdf-safe-toggle" title="Restrict content to A4 margins"><input id="nlpdfSafeArea" type="checkbox"><span><strong>Safe area</strong><small>25.4 mm margins</small></span></label>'+
          '<label class="nlpdf-safe-toggle nlpdf-duplicate-toggle" title="Warn when document pages have exactly matching rendered content"><input id="nlpdfDetectDuplicates" type="checkbox" checked><span><strong>Duplicate check</strong></span></label>'+
          '<button class="nlpdf-which-duplicate hidden" id="nlpdfWhichDuplicate" type="button">Which duplicate</button>'+
        '</div></section>'+
        '<section class="nlpdf-panel" id="nlpdfSpacePanel">'+
          '<div class="nlpdf-scope"><label><input type="radio" name="nlpdfSpaceScope" value="current" checked>This page</label><label><input type="radio" name="nlpdfSpaceScope" value="all">Every page</label></div>'+
          '<div class="nlpdf-row"><button class="nlpdf-btn" id="nlpdfApplySpace" type="button">Make Space</button><button class="nlpdf-btn" id="nlpdfClearSpace" type="button">Undo</button></div>'+
        '</section>'+
        '<section class="nlpdf-panel nlpdf-clear-panel"><button class="nlpdf-clear-all" id="nlpdfClearAll" type="button" disabled>Clear All</button></section>'+
      '</div>'+
      '<input class="nlpdf-file-input" id="nlpdfFileInput" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.zip,application/pdf,image/jpeg,image/png,image/webp,application/zip" multiple>'+
      '<input class="nlpdf-asset-input" id="nlpdfAssetInput" type="file">'+
    '</aside>'+
    '<main class="nlpdf-editor">'+
      '<nav class="nlpdf-toolrail" id="nlpdfToolRail" aria-label="Document editing tools">'+
          '<button type="button" data-tool="crop" title="Crop page" aria-label="Crop page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v13a2 2 0 0 0 2 2h13M18 21V8a2 2 0 0 0-2-2H3"/></svg></button>'+
          '<button type="button" data-tool="space" title="Automatic Make Space" aria-label="Automatic Make Space"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v9H5zM5 21h14M9 16l3 3 3-3M12 13v6"/></svg></button>'+
          '<button id="nlpdfRotateRight" type="button" data-tool="rotate" title="Rotate clockwise 90°" aria-label="Rotate clockwise 90°" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.5 6.2M3 4v7h7"/></svg></button>'+
        '</nav><div class="nlpdf-tool-flyout hidden" id="nlpdfToolFlyout"><div class="nlpdf-tool-flyout-head"><strong id="nlpdfToolFlyoutTitle">Tools</strong><button type="button" id="nlpdfToolFlyoutClose" aria-label="Close tools">×</button></div><div id="nlpdfToolFlyoutContent"></div></div>'+ 
      '<div class="nlpdf-toolbar">'+
        '<button class="nlpdf-tool" id="nlpdfUndo" type="button" disabled title="Undo (Ctrl+Z)">↶ Undo</button><button class="nlpdf-tool" id="nlpdfRedo" type="button" disabled title="Redo (Ctrl+Y)">↷ Redo</button>'+ 
        '<button class="nlpdf-tool" id="nlpdfDuplicate" type="button" disabled>⧉ Duplicate</button><button class="nlpdf-tool" id="nlpdfDelete" type="button" disabled>⌫ Delete</button>'+
        '<span class="nlpdf-toolbar-spacer"></span><span class="nlpdf-selection-label" id="nlpdfSelectionLabel">No page selected</span>'+
        '<div class="nlpdf-toolbar-safe" id="nlpdfToolbarSafe"></div>'+
        '<div class="nlpdf-view-toggle"><button class="active" id="nlpdfSingleView" type="button">Single</button><button id="nlpdfGridView" type="button">Grid</button></div>'+
      '</div>'+
      '<section class="nlpdf-stage" id="nlpdfStage"><div class="nlpdf-drop-overlay">Drop PDF, images, or ZIP anywhere here</div>'+
        '<div class="nlpdf-paper" id="nlpdfPaper"><canvas id="nlpdfCanvas" width="840" height="1188"></canvas><div id="nlpdfTransformLayer" class="nlpdf-transform-layer hidden"><i data-resize="nw"></i><i data-resize="ne"></i><i data-resize="sw"></i><i data-resize="se"></i></div><div id="nlpdfSnapX" class="nlpdf-snap-guide x hidden"></div><div id="nlpdfSnapY" class="nlpdf-snap-guide y hidden"></div><div class="nlpdf-safe-guide hidden" id="nlpdfSafeGuide"></div><div class="nlpdf-crop-layer hidden" id="nlpdfCropLayer"><div class="nlpdf-crop-region" id="nlpdfCropRegion"><i data-crop-handle="nw"></i><i data-crop-handle="n"></i><i data-crop-handle="ne"></i><i data-crop-handle="e"></i><i data-crop-handle="se"></i><i data-crop-handle="s"></i><i data-crop-handle="sw"></i><i data-crop-handle="w"></i></div></div><div class="nlpdf-paper-hint" id="nlpdfPaperHint"><div><strong>Blank A4</strong><span>Drop files onto the workspace or click “Add files / ZIP”.<br>Select a page to crop, move, scale, or make space.</span></div></div><span class="nlpdf-paper-badge hidden" id="nlpdfPaperBadge"></span><img class="nlpdf-signature-preview hidden" id="nlpdfSignaturePreview" alt="Signature"></div>'+
        '<div class="nlpdf-crop-actions hidden" id="nlpdfCropActions" role="group" aria-label="Crop actions"><button class="nlpdf-crop-apply" id="nlpdfApplyCrop" type="button">✓ Accept crop</button><button class="nlpdf-crop-cancel" id="nlpdfCancelCrop" type="button">Cancel</button></div>'+
      '</section>'+
      '<section class="nlpdf-grid-stage hidden" id="nlpdfGridStage"><div class="nlpdf-drop-overlay">Drop PDF, images, or ZIP anywhere here</div><div class="nlpdf-grid" id="nlpdfGrid"></div></section>'+
      '<aside class="nlpdf-filmstrip-wrap" id="nlpdfFilmstripWrap"><div class="nlpdf-filmstrip-head"><strong>Pages</strong><span>Front/Back are shown as stacks, not every default page</span></div><div class="nlpdf-filmstrip" id="nlpdfFilmstrip"></div></aside>'+
      '<button class="nlpdf-zoom-add" id="nlpdfAddFiles" type="button" aria-label="Add PDF, images or ZIP" title="Add PDF, images or ZIP">+</button>'+
      '<div class="nlpdf-zoom" id="nlpdfZoomControls"><button id="nlpdfZoomOut" type="button" aria-label="Zoom out">−</button><strong id="nlpdfZoomValue">100%</strong><button id="nlpdfZoomIn" type="button" aria-label="Zoom in">+</button><button id="nlpdfZoomFit" type="button">Fit A4</button></div>'+
      '<footer class="nlpdf-footer"><div class="nlpdf-footer-stats"><div class="nlpdf-footer-stat"><strong id="nlpdfPageCount">0</strong><span>Document pages</span></div><div class="nlpdf-footer-stat"><strong id="nlpdfFileCount">0</strong><span>Source files</span></div></div><div class="nlpdf-footer-center" id="nlpdfStatus">Ready · Files stay in this browser</div><div class="nlpdf-footer-actions"><button class="nlpdf-create" id="nlpdfCreate" type="button" disabled>Create Package</button></div></footer>'+
    '</main>'+
  '</div></section>'+
  exportModalMarkup();
}
function exportModalMarkup(){
  return '<div class="nlpdf-modal" id="nlpdfExportModal" aria-hidden="true"><div class="nlpdf-modal-backdrop" data-nlpdf-close></div><section class="nlpdf-modal-card" role="dialog" aria-modal="true">'+
    '<div class="nlpdf-modal-head"><div><span class="eyebrow">FINAL REVIEW</span><h2>Create Package</h2></div><button class="nlpdf-close" type="button" data-nlpdf-close>×</button></div>'+
    '<div class="nlpdf-modal-body">'+
      '<div class="nlpdf-modal-grid"><label class="nlpdf-modal-field"><span>Student number</span><input id="nlpdfExportNumber" placeholder="3408"></label><label class="nlpdf-modal-field"><span>Student name</span><input id="nlpdfExportName" placeholder="Miss ABC"></label>'+
      '<div class="nlpdf-modal-field full"><span>Letter type</span><div class="nlpdf-letter-type-row"><select id="nlpdfExportLetterType"><option value="bachelor_no_ien">Bachelor Degree No IEN</option><option value="bachelor">Bachelor Degree</option><option value="current_no_ien">Current No IEN</option><option value="exchange">Exchange Bachelor</option><option value="master">Master Degree</option><option value="doctor">Doctor Degree</option></select><button class="nlpdf-edit-letter" id="nlpdfEditLetter" type="button">Edit letter</button></div><small class="nlpdf-letter-requirement hidden" id="nlpdfLetterRequirement">Select Letter below to continue with Edit letter.</small></div>'+
      '<label class="nlpdf-modal-field full"><span>PDF filename</span><input id="nlpdfExportPdfName"></label></div>'+
      '<div class="nlpdf-output-choice" role="group" aria-label="Create outputs"><label class="nlpdf-choice"><input type="checkbox" name="nlpdfOutput" value="folder"><div><strong>Folder</strong></div></label><label class="nlpdf-choice"><input type="checkbox" name="nlpdfOutput" value="pdf" checked><div><strong>PDF</strong></div></label><label class="nlpdf-choice"><input type="checkbox" name="nlpdfOutput" value="letter"><div><strong>Letter</strong></div></label></div>'+
      '<div class="nlpdf-final-preview"><div class="nlpdf-final-row"><span>Folder</span><strong id="nlpdfFinalFolder">Not created</strong></div><div class="nlpdf-final-row"><span>Letter</span><strong id="nlpdfFinalLetter">Not created</strong></div><div class="nlpdf-final-row"><span>PDF</span><strong id="nlpdfFinalPdf">Documents_Miss ABC.pdf</strong></div><div class="nlpdf-final-row"><span>Pages</span><strong id="nlpdfFinalPages">0 document pages</strong></div></div>'+
      '<div class="nlpdf-destination"><div><strong id="nlpdfDestinationName">No destination selected</strong><span id="nlpdfDestinationHelp">Choose where the selected outputs should be created.</span></div><button class="nlpdf-dest-btn" id="nlpdfChooseDestination" type="button">Choose destination</button></div>'+
    '</div>'+
    '<div class="nlpdf-export-progress hidden" id="nlpdfExportProgress" role="status" aria-live="polite"><div class="nlpdf-export-progress-spinner" aria-hidden="true"></div><div class="nlpdf-export-progress-title" id="nlpdfProgressTitle">Creating in progress…</div><div class="nlpdf-export-progress-detail" id="nlpdfProgressDetail">Preparing documents.</div><div class="nlpdf-export-progress-track"><div id="nlpdfProgressFill"></div></div><div class="nlpdf-export-progress-counter" id="nlpdfProgressCounter"></div></div>'+
    '<div class="nlpdf-modal-actions"><button class="nlpdf-cancel" type="button" data-nlpdf-close>Cancel</button><button class="nlpdf-confirm" id="nlpdfConfirmExport" type="button">Create Package</button></div>'+
  '</section></div>'+letterEditorMarkup();
}
function letterEditorMarkup(){
  return '<section class="nlpdf-letter-editor hidden" id="nlpdfLetterEditor" aria-hidden="true">'+
    '<header class="nlpdf-letter-editor-head"><div><span class="eyebrow">LETTER EDITOR</span><h2 id="nlpdfLetterEditorTitle">Edit Letter</h2><span id="nlpdfLetterEditorContext"></span></div><button class="nlpdf-letter-editor-close" id="nlpdfCancelLetterEdit" type="button">Back to PDF Builder</button></header>'+
    '<div class="nlpdf-letter-editor-body"><div class="nlpdf-letter-document-shell"><div class="nlpdf-letter-document" id="nlpdfLetterDocument"></div></div></div>'+
    '<button class="nlpdf-package-settings-fab" id="nlpdfPackageSettingsBtn" type="button">Package dates</button>'+
    '<aside class="nlpdf-package-settings hidden" id="nlpdfPackageSettings" aria-hidden="true"><div class="nlpdf-package-settings-head"><div><span class="eyebrow">PACKAGE SETTINGS</span><strong>Academic dates</strong></div><button type="button" id="nlpdfClosePackageSettings">×</button></div>'+
      '<div class="nlpdf-letter-package-grid">'+
        '<label><span>Student type</span><input id="nlpdfLetterStudentType" readonly></label>'+
        '<label><span>Semester</span><select id="nlpdfLetterSemester"><option value="">Select</option><option value="First">First</option><option value="Second">Second</option><option value="Summer">Summer</option></select></label>'+
        '<label><span>Academic year</span><input id="nlpdfLetterAcademicYear" inputmode="numeric" placeholder="2026"></label>'+
        '<label><span>Starting Date</span><input id="nlpdfLetterStartDate" placeholder="e.g. January 11, 2027"></label>'+
        '<label><span>Finishing Date</span><input id="nlpdfLetterFinishDate" placeholder="e.g. May 31, 2027"></label>'+
        '<label><span>Orientation</span><input id="nlpdfLetterOrientation" placeholder="e.g. January 4 - 8, 2027"></label>'+
      '</div><div class="nlpdf-letter-package-status" id="nlpdfLetterPackageStatus">Package dates are stored by Student type + Semester + Academic year.</div>'+
    '</aside>'+
    '<footer class="nlpdf-letter-editor-actions"><span id="nlpdfLetterEditorStatus">Letter has not been created yet.</span><button class="nlpdf-confirm" id="nlpdfCreateEditedLetter" type="button">Create Letter</button></footer>'+
  '</section>';
}

/* Unified editor history: snapshots contain edits/settings but not PDF binary buffers. */
function snapshot(){
  return {
    pages:state.pages.map(p=>({...p,crop:{...p.crop},transform:{...p.transform}})),
    selected:[...state.selected],activeId:state.activeId,anchorIndex:state.anchorIndex,
    sig:{...state.sig},signaturePageId:state.signaturePageId,
    safeArea:state.safeArea,
    toggles:{
      front:Boolean($('#nlpdfUseFront')?.checked),
      back:Boolean($('#nlpdfUseBack')?.checked),
      signature:Boolean($('#nlpdfUseSignature')?.checked),
      scope:$('#nlpdfSigScope')?.value||'all'
    },
    assets:{...state.assets}
  };
}
function snapshotFingerprint(s){
  const names={};
  for(const k of ['front','back','signature'])names[k]=s.assets[k]?.updatedAt||s.assets[k]?.name||null;
  return JSON.stringify({...s,assets:names,selected:undefined,activeId:undefined,anchorIndex:undefined});
}
function resetHistory(){
  state.history.undo.length=0;state.history.redo.length=0;
  state.history.current=snapshot();updateHistoryButtons();
}
function recordEdit(){
  if(state.history.restoring)return;
  const next=snapshot(),hist=state.history;
  if(!hist.current){hist.current=next;updateHistoryButtons();return;}
  if(snapshotFingerprint(hist.current)===snapshotFingerprint(next)){
    hist.current=next;updateHistoryButtons();return;
  }
  hist.undo.push(hist.current);if(hist.undo.length>90)hist.undo.shift();
  hist.redo.length=0;hist.current=next;
  updateHistoryButtons();
}
function updateHistoryButtons(){
  const hist=state.history;
  const u=$('#nlpdfUndo'),r=$('#nlpdfRedo');
  if(u)u.disabled=!hist.undo.length||hist.restoring;
  if(r)r.disabled=!hist.redo.length||hist.restoring;
}
async function restoreSnapshot(next){
  const hist=state.history;hist.restoring=true;updateHistoryButtons();
  const before={...state.assets};
  state.pages=next.pages.map(p=>({...p,crop:{...p.crop},transform:{...p.transform}}));
  state.selected=new Set(next.selected);state.activeId=next.activeId;
  state.anchorIndex=next.anchorIndex;state.sig={...next.sig};
  state.signaturePageId=next.signaturePageId;state.safeArea=next.safeArea;
  state.assets={...next.assets};
  $('#nlpdfUseFront').checked=next.toggles.front;
  $('#nlpdfUseBack').checked=next.toggles.back;
  $('#nlpdfUseSignature').checked=next.toggles.signature;
  $('#nlpdfSigScope').value=next.toggles.scope;
  $('#nlpdfSafeArea').checked=state.safeArea;
  $('#nlpdfSigSize').value=Math.round(state.sig.widthPct*100);
  $('#nlpdfSigSizeValue').textContent=Math.round(state.sig.widthPct*100)+'%';
  state.cropMode=false;state.cropDraft=null;state.cropBounds=null;
  try{
    for(const id of ['front','back','signature']){
      if(before[id]!==state.assets[id]){
        if(state.assets[id])await dbPut(state.assets[id]);
        else await dbDelete(id);
      }
    }
    renderAssets();refreshSignatureUrl();savePrefs();
    await updateAssetInfo();await renderAll();updateControls();await scanDuplicates();
  }finally{hist.restoring=false;updateHistoryButtons();}
}
async function undoEdit(){
  const h=state.history;if(!h.undo.length||h.restoring)return;
  const previous=h.undo.pop();h.redo.push(h.current);h.current=previous;
  await restoreSnapshot(previous);
}
async function redoEdit(){
  const h=state.history;if(!h.redo.length||h.restoring)return;
  const next=h.redo.pop();h.undo.push(h.current);h.current=next;
  await restoreSnapshot(next);
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
  $('#nlpdfSigScope').disabled=!state.assets.signature;$('#nlpdfSigSize').disabled=!state.assets.signature;
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

function refreshSignatureUrl(){
  if(state.signatureUrl)URL.revokeObjectURL(state.signatureUrl);
  state.signatureUrl=state.assets.signature?URL.createObjectURL(state.assets.signature.blob):'';
  if(!state.signatureUrl)return;
  const probe=new Image();
  probe.onload=()=>{
    state.sigAspect=probe.naturalHeight/Math.max(1,probe.naturalWidth);
    renderSignature(Boolean($('#nlpdfUseSignature')?.checked&&!state.cropMode&&(!activePage()||signatureApplies(activePage()))));
    if(activePage()?.makeSpace)renderActive();
  };
  probe.src=state.signatureUrl;
}

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
  const rec={id,name,type,blob,updatedAt:new Date().toISOString()};await dbPut(rec);state.assets[id]=rec;renderAssets();const t=$('#'+(id==='front'?'nlpdfUseFront':id==='back'?'nlpdfUseBack':'nlpdfUseSignature'));t.disabled=false;t.checked=true;savePrefs();refreshSignatureUrl();await updateAssetInfo();renderActive();recordEdit();toast((sig?'Signature':'Default '+id)+' saved.');
}
async function removeAsset(id){await dbDelete(id);state.assets[id]=null;renderAssets();savePrefs();refreshSignatureUrl();await updateAssetInfo();renderActive();recordEdit();toast('Default '+id+' removed.');}

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
    if(!state.activeId&&state.pages[0]){state.activeId=state.pages[0].id;state.selected.add(state.activeId);state.anchorIndex=0;}if($('#nlpdfSigScope')?.value==='page'&&!state.signaturePageId)state.signaturePageId=state.activeId;
    await renderAll();recordEdit();setStatus('Added '+added+' page'+(added===1?'':'s')+'.');state.duplicateDismissed.clear();scanDuplicates().catch(console.error);
  }finally{state.busy=false;updateControls();}
}

/* Preview source cache */
async function sourceRaster(p){
  const key=p.kind==='pdf'?'pdf:'+p.sourceKey+':'+p.sourcePage:'img:'+p.sourceKey;
  if(state.previewCache.has(key))return state.previewCache.get(key);
  let canvas;
  if(p.kind==='pdf'){
    const doc=state.pdfJsDocs.get(p.sourceKey),page=await doc.getPage(p.sourcePage),base=page.getViewport({scale:1}),scale=Math.min(2,1500/base.width),vp=page.getViewport({scale});
    canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(vp.width));canvas.height=Math.max(1,Math.floor(vp.height));await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:vp,intent:'display',annotationMode:pdfCanvasAnnotationMode()}).promise;
  }else{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=p.previewUrl;});
    canvas=document.createElement('canvas');const scale=Math.min(1,1800/img.naturalWidth,2400/img.naturalHeight);canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  }
  state.previewCache.set(key,canvas);return canvas;
}
function rotateRaster(src,rotation){
  const rot=((rotation||0)%360+360)%360;
  if(rot===0)return src;
  const out=document.createElement('canvas');
  if(rot===90||rot===270){out.width=src.height;out.height=src.width;}
  else{out.width=src.width;out.height=src.height;}
  const ctx=out.getContext('2d');ctx.save();
  if(rot===90){ctx.translate(out.width,0);ctx.rotate(Math.PI/2);}
  else if(rot===180){ctx.translate(out.width,out.height);ctx.rotate(Math.PI);}
  else if(rot===270){ctx.translate(0,out.height);ctx.rotate(-Math.PI/2);}
  ctx.drawImage(src,0,0);ctx.restore();
  return out;
}
function cropRotateRaster(src,p){
  const rotated=rotateRaster(src,p.rotation||0),c=p.crop||defaultCrop();
  const l=clamp(c.left||0,0,95)/100,r=clamp(c.right||0,0,95)/100;
  const t=clamp(c.top||0,0,95)/100,b=clamp(c.bottom||0,0,95)/100;
  const sx=Math.floor(rotated.width*l),sy=Math.floor(rotated.height*t);
  const sw=Math.max(1,Math.floor(rotated.width*(1-l-r)));
  const sh=Math.max(1,Math.floor(rotated.height*(1-t-b)));
  const out=document.createElement('canvas');out.width=sw;out.height=sh;
  out.getContext('2d').drawImage(rotated,sx,sy,sw,sh,0,0,sw,sh);
  return out;
}
function sourceCropForRotation(crop,rotation){
  const c=crop||defaultCrop(),rot=((rotation||0)%360+360)%360;
  if(rot===90)return {left:c.top,right:c.bottom,top:c.right,bottom:c.left};
  if(rot===180)return {left:c.right,right:c.left,top:c.bottom,bottom:c.top};
  if(rot===270)return {left:c.bottom,right:c.top,top:c.left,bottom:c.right};
  return c;
}
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
  const drawingPage=editing?{...p,crop:defaultCrop()}:p;
  const img=cropRotateRaster(source,drawingPage);
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  const L=layoutOnSheet(p,img.width,img.height,w,h);
  ctx.drawImage(img,L.x,L.y,L.w,L.h);
  if(editing&&w===840&&h===1188)state.cropBounds={...L,pageId:p.id};
  return L;
}

/* A4 editor */
function activePage(){return state.pages.find(p=>p.id===state.activeId)||null;}
function selectedPages(){return state.pages.filter(p=>state.selected.has(p.id));}

async function renderActive(){
  const canvas=$('#nlpdfCanvas'),hint=$('#nlpdfPaperHint'),badge=$('#nlpdfPaperBadge'),p=activePage();
  const epoch=++state.renderEpoch;
  canvas.width=840;canvas.height=1188;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,840,1188);
  $('#nlpdfSafeGuide')?.classList.toggle('hidden',!state.safeArea);
  if(!p){
    updateTransformOverlay(null);showSnapGuides(false,false);
    hint.classList.remove('hidden');badge.classList.add('hidden');
    $('#nlpdfCropLayer').classList.add('hidden');
    renderSignature(Boolean(state.assets.signature&&$('#nlpdfUseSignature')?.checked));
    syncPageControls();return;
  }
  hint.classList.add('hidden');badge.classList.remove('hidden');
  badge.textContent='Document page '+(state.pages.findIndex(x=>x.id===p.id)+1);
  const temp=document.createElement('canvas');
  try{
    const rendered=await drawPageToCanvas(p,temp,840,1188);
    if(epoch!==state.renderEpoch)return;
    ctx.clearRect(0,0,840,1188);ctx.drawImage(temp,0,0);
    updateTransformOverlay(rendered);
  }catch(err){if(epoch===state.renderEpoch){console.error(err);setStatus('Preview unavailable: '+err.message);}}
  if(epoch!==state.renderEpoch)return;
  if(state.cropMode)updateCropOverlay();
  else $('#nlpdfCropLayer').classList.add('hidden');
  renderSignature(Boolean(signatureApplies(p)&&!state.cropMode));
  syncPageControls();
}
function signatureApplies(p){
  if(!p||!state.assets.signature||!$('#nlpdfUseSignature')?.checked)return false;
  return $('#nlpdfSigScope').value==='all'||($('#nlpdfSigScope').value==='page'&&state.signaturePageId===p.id);
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
    ? 'Placement preview only: choose this page to apply'
    : 'Drag signature to reposition';
  const hint=$('#nlpdfSigHint');if(hint)hint.textContent=activePage()&&!signatureApplies(activePage())?'Placement preview only: signature is assigned to another page.':'Drag the signature on A4 to position it for export.';
}
function syncPageControls(){
  const p=activePage(),disabled=!p;
  $('#nlpdfCropActions').classList.toggle('hidden',!state.cropMode);
  const cropTool=$('[data-tool="crop"]', $('#nlpdfToolRail'));if(cropTool)cropTool.classList.toggle('active',state.cropMode);
  $('#nlpdfContentScale').disabled=disabled||state.cropMode;
  $('#nlpdfContentScale').value=p?Math.round((p.transform?.scale||1)*100):100;
  $('#nlpdfContentScaleValue').textContent=(p?Math.round((p.transform?.scale||1)*100):100)+'%';
  $('#nlpdfCenterContent').disabled=disabled||state.cropMode;

  const spaceStatus=$('#nlpdfSpaceStatus');if(spaceStatus)spaceStatus.textContent=p?.makeSpace?'Make Space active on this page.':'';
}

function updateControls(){
  const sel=selectedPages(),p=activePage(),i=p?state.pages.findIndex(x=>x.id===p.id):-1;
  ['nlpdfRotateRight','nlpdfDuplicate','nlpdfDelete'].forEach(id=>$('#'+id).disabled=!sel.length||state.busy);
  const cropTool=$('[data-tool="crop"]', $('#nlpdfToolRail'));if(cropTool)cropTool.disabled=!p||state.busy;
  $('#nlpdfCreate').disabled=!state.pages.length||state.busy;
  $('#nlpdfClearAll').disabled=!state.pages.length||state.busy;
  $('#nlpdfSelectionLabel').textContent=sel.length?sel.length+' selected · active page '+(i+1):'No page selected';$('#nlpdfPageCount').textContent=state.pages.length;$('#nlpdfFileCount').textContent=new Set(state.pages.map(p=>p.sourceKey)).size;
}
function selectPage(id,event={}){const i=state.pages.findIndex(p=>p.id===id);if(i<0)return;if(state.cropMode){state.cropMode=false;state.cropDraft=null;}state.activeId=id;const multi=event.ctrlKey||event.metaKey;
  if(event.shiftKey&&state.anchorIndex>=0){const [a,b]=[state.anchorIndex,i].sort((x,y)=>x-y);if(!multi)state.selected.clear();for(let n=a;n<=b;n++)state.selected.add(state.pages[n].id);}
  else if(multi){state.selected.has(id)?state.selected.delete(id):state.selected.add(id);state.anchorIndex=i;}
  else{state.selected.clear();state.selected.add(id);state.anchorIndex=i;}
  renderAll();
}
function deleteSelected(){if(!state.selected.size)return;if(state.cropMode){state.cropMode=false;state.cropDraft=null;}const ids=new Set(state.selected),old=state.pages.findIndex(p=>p.id===state.activeId);state.pages=state.pages.filter(p=>!ids.has(p.id));state.selected.clear();const n=state.pages[Math.min(Math.max(old,0),state.pages.length-1)];state.activeId=n?.id||'';if(n){state.selected.add(n.id);state.anchorIndex=state.pages.indexOf(n);}else state.anchorIndex=-1;if(!state.pages.some(p=>p.id===state.signaturePageId))state.signaturePageId=n?.id||'';renderAll();recordEdit();scanDuplicates().catch(console.error);}
function clearAllDocuments(){
  if(!state.pages.length||state.busy)return;
  if(state.cropMode){state.cropMode=false;state.cropDraft=null;state.cropBounds=null;}
  state.pages=[];
  state.selected.clear();
  state.activeId='';
  state.anchorIndex=-1;
  state.signaturePageId='';
  state.dragId='';
  state.contentBounds=null;
  showSnapGuides(false,false);
  renderAll();
  recordEdit();
  setStatus('Cleared imported document pages · Default assets and settings kept');
  state.duplicateGroups=new Map();state.duplicatePageHashes=new Map();state.duplicateOnly=false;updateDuplicateControls();
  toast('Document pages cleared. Default assets and settings were kept.');
}
function rotateSelected(d){if(state.cropMode)return;for(const p of state.pages)if(state.selected.has(p.id))p.rotation=((p.rotation||0)+d+360)%360;renderAll();recordEdit();}
function duplicateSelected(){const ids=[...state.selected],newIds=[];for(const id of ids){const i=state.pages.findIndex(p=>p.id===id);if(i<0)continue;const p=state.pages[i],cp={...p,id:uid(),crop:{...p.crop},transform:{...p.transform}};state.pages.splice(i+1,0,cp);newIds.push(cp.id);}if(newIds.length){state.selected=new Set(newIds);state.activeId=newIds[newIds.length-1];state.anchorIndex=state.pages.findIndex(p=>p.id===state.activeId);}renderAll();recordEdit();state.duplicateDismissed.clear();scanDuplicates().catch(console.error);}
function moveActive(d){const p=activePage();if(!p)return;const i=state.pages.indexOf(p),j=i+d;if(j<0||j>=state.pages.length)return;[state.pages[i],state.pages[j]]=[state.pages[j],state.pages[i]];state.anchorIndex=j;renderAll();recordEdit();}
function reorder(a,b){
  if(!a||!b||a===b)return;
  const ids=state.selected.has(a)?new Set(state.selected):new Set([a]);
  const moving=state.pages.filter(p=>ids.has(p.id)),rest=state.pages.filter(p=>!ids.has(p.id));
  if(!moving.length||ids.has(b))return;
  const j=rest.findIndex(p=>p.id===b);if(j<0)return;
  const sourcePosition=state.pages.findIndex(p=>p.id===a);
  const targetPosition=state.pages.findIndex(p=>p.id===b);
  // Drop downwards means AFTER the target; drop upwards means BEFORE it.
  // Always inserting before made dragging onto the next page a no-op.
  rest.splice(j+(sourcePosition<targetPosition?1:0),0,...moving);
  state.pages=rest;state.anchorIndex=state.pages.findIndex(p=>p.id===state.activeId);renderAll();recordEdit();
}
function moveToEdge(edge,draggedId=null){
  const ids=draggedId&&!state.selected.has(draggedId)?new Set([draggedId]):new Set(state.selected);
  if(!ids.size)return;
  const moving=state.pages.filter(p=>ids.has(p.id)),rest=state.pages.filter(p=>!ids.has(p.id));
  state.pages=edge==='first'?[...moving,...rest]:[...rest,...moving];
  state.anchorIndex=state.pages.findIndex(p=>p.id===state.activeId);renderAll();recordEdit();
}
function resetTransform(){const p=activePage();if(!p||state.cropMode)return;p.transform=defaultTransform();renderAll();recordEdit();}
function centerContent(){const p=activePage();if(!p||state.cropMode)return;p.transform.xMM=0;p.transform.yMM=0;renderAll();recordEdit();}
function applySpace(clear=false){
  if(!clear&&(!state.assets.signature||!$('#nlpdfUseSignature')?.checked)){toast('Enable a saved Signature first.');return;}
  const scope=$('input[name="nlpdfSpaceScope"]:checked')?.value||'current';
  const pages=scope==='all'?state.pages:(activePage()?[activePage()]:[]);
  for(const p of pages){p.makeSpace=!clear;p.spaceMM=0;}
  renderAll();recordEdit();toast((clear?'Cleared':'Applied')+' signature clearance on '+pages.length+' page(s).');
}
function startCrop(){
  const p=activePage();if(!p)return;state.cropMode=true;state.cropDraft={...p.crop};renderActive();
}
function applyCrop(){
  const p=activePage();if(!p||!state.cropMode)return;
  p.crop={...state.cropDraft};state.cropMode=false;state.cropDraft=null;state.cropBounds=null;
  state.closeToolFlyout?.();renderAll();recordEdit();
}
function cancelCrop(){
  state.cropMode=false;state.cropDraft=null;state.cropBounds=null;
  state.closeToolFlyout?.();renderActive();
}
function resetCrop(){const p=activePage();if(!p)return;state.cropMode=false;state.cropDraft=null;p.crop=defaultCrop();renderAll();recordEdit();}
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
function setupCropEmptyClickApply(){
  const stage=$('#nlpdfStage');let tap=null;
  stage.addEventListener('pointerdown',e=>{
    if(!state.cropMode||e.button!==0||e.target.closest('#nlpdfCropRegion,#nlpdfCropActions,#nlpdfToolRail'))return;
    tap={id:e.pointerId,x:e.clientX,y:e.clientY};
  },true);
  stage.addEventListener('pointerup',e=>{
    if(!tap||tap.id!==e.pointerId)return;
    const dx=e.clientX-tap.x,dy=e.clientY-tap.y,moved=Math.hypot(dx,dy)>6;
    tap=null;
    if(!moved&&state.cropMode&&!e.target.closest('#nlpdfCropRegion,#nlpdfCropActions,#nlpdfToolRail')){
      e.preventDefault();e.stopPropagation();applyCrop();
    }
  },true);
  stage.addEventListener('pointercancel',()=>{tap=null;},true);
}
function fitPaper(){
  const stage=$('#nlpdfStage'),paper=$('#nlpdfPaper');if(!stage||!paper||stage.classList.contains('hidden'))return;
  const availableW=Math.max(170,stage.clientWidth-58),availableH=Math.max(190,stage.clientHeight-44);
  const fitted=Math.min(availableW,availableH*A4.wMM/A4.hMM);
  paper.style.setProperty('--nlpdf-paper-width',Math.max(150,Math.round(fitted*state.zoom))+'px');
  $('#nlpdfZoomValue').textContent=Math.round(state.zoom*100)+'%';
}
function setZoom(next){state.zoom=clamp(Math.round(next*100)/100,.5,3);fitPaper();}

/* Drag background horizontally to zoom: moving outward zooms in on either side. */
function setupBackgroundZoom(){
  const stage=$('#nlpdfStage'),paper=$('#nlpdfPaper');
  let drag=null;
  stage.addEventListener('pointerdown',e=>{
    if(e.button!==0||state.cropMode||state.busy||e.target.closest('#nlpdfPaper'))return;
    const r=paper.getBoundingClientRect();
    const side=e.clientX<r.left?'left':e.clientX>r.right?'right':null;
    if(!side)return;
    drag={pointerId:e.pointerId,side,startX:e.clientX,startZoom:state.zoom};
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('nlpdf-gesture-zoom');
    stage.dataset.zoomSide=side;
    e.preventDefault();
  });
  stage.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.pointerId)return;
    const outward=drag.side==='left'?-1:1;
    const amount=(e.clientX-drag.startX)*outward;
    setZoom(drag.startZoom+amount/230);
  });
  const stop=e=>{
    if(!drag||e.pointerId!==drag.pointerId)return;
    drag=null;
    stage.classList.remove('nlpdf-gesture-zoom');
    delete stage.dataset.zoomSide;
    if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener('pointerup',stop);
  stage.addEventListener('pointercancel',stop);
}


/* Exact visual duplicate detection. Warnings never delete pages. */
async function sha256Hex(bytes){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function duplicateFingerprint(p){
  const cacheKey=p.kind+':'+p.sourceKey+':'+p.sourcePage;
  if(state.duplicateHashCache.has(cacheKey))return state.duplicateHashCache.get(cacheKey);
  const canvas=await sourceRaster(p);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const prefix=new TextEncoder().encode(canvas.width+'x'+canvas.height+':');
  const bytes=new Uint8Array(prefix.length+pixels.length);bytes.set(prefix);bytes.set(pixels,prefix.length);
  const hash=await sha256Hex(bytes);
  state.duplicateHashCache.set(cacheKey,hash);
  return hash;
}
function duplicateHashForPage(id){return state.duplicatePageHashes.get(id)||'';}
function duplicatePageIds(){return new Set(state.duplicatePageHashes.keys());}
function updateDuplicateControls(){
  const button=$('#nlpdfWhichDuplicate');
  if(!button)return;
  const count=state.duplicatePageHashes.size;
  button.classList.toggle('hidden',!state.duplicateDetection||!count);
  button.textContent=state.duplicateOnly?'Show all':'Which duplicate';
  button.title=count?count+' page'+(count===1?'':'s')+' share duplicate content':'';
}
async function scanDuplicates(){
  const token=++state.duplicateScanToken;
  if(!state.duplicateDetection||state.pages.length<2){
    state.duplicateGroups=new Map();state.duplicatePageHashes=new Map();state.duplicateOnly=false;updateDuplicateControls();
    if(state.viewMode==='grid')renderGrid();else renderFilmstrip();
    return;
  }
  const byHash=new Map();
  for(const p of state.pages){
    const hash=await duplicateFingerprint(p);
    if(token!==state.duplicateScanToken)return;
    if(!byHash.has(hash))byHash.set(hash,[]);
    byHash.get(hash).push(p.id);
  }
  const groups=new Map([...byHash].filter(([hash,ids])=>ids.length>1&&!state.duplicateDismissed.has(hash)));
  const pageHashes=new Map();
  for(const [hash,ids] of groups)for(const id of ids)pageHashes.set(id,hash);
  state.duplicateGroups=groups;state.duplicatePageHashes=pageHashes;
  if(state.duplicateOnly&&!pageHashes.size)state.duplicateOnly=false;
  updateDuplicateControls();
  if(state.viewMode==='grid')await renderGrid();else await renderFilmstrip();
}
function dismissDuplicate(hash){
  if(!hash)return;
  state.duplicateDismissed.add(hash);
  const ids=state.duplicateGroups.get(hash)||[];
  state.duplicateGroups.delete(hash);
  for(const id of ids)state.duplicatePageHashes.delete(id);
  if(state.duplicateOnly&&!state.duplicatePageHashes.size)state.duplicateOnly=false;
  updateDuplicateControls();
  if(state.viewMode==='grid')renderGrid();else renderFilmstrip();
}
function toggleDuplicateOnly(){
  if(!state.duplicatePageHashes.size)return;
  state.duplicateOnly=!state.duplicateOnly;
  updateDuplicateControls();
  if(state.viewMode==='grid')renderGrid();else renderFilmstrip();
}

/* Stack / thumbnails */
function stackMeta(which){const a=state.assets[which],info=state.assetInfo[which],enabled=$('#'+(which==='front'?'nlpdfUseFront':'nlpdfUseBack'))?.checked;return a&&enabled?{which,name:a.name,count:info?.pageCount||1}:null;}
function stackMini(m){return '<article class="nlpdf-page-card" data-stack="'+m.which+'"><div class="nlpdf-stack-mini"><i></i><i></i><i>'+esc(m.which==='front'?'Front':'Back')+'</i><b>'+m.count+'</b></div><div class="nlpdf-page-meta"><strong>Default '+(m.which==='front'?'Front':'Back')+'</strong><span>'+m.count+' page'+(m.count===1?'':'s')+' · locked</span></div></article>';}
function stackGrid(m){return '<article class="nlpdf-grid-card nlpdf-stack-card" data-stack="'+m.which+'"><div class="nlpdf-stack-thumb"><span class="nlpdf-stack-sheet"></span><span class="nlpdf-stack-sheet"></span><span class="nlpdf-stack-sheet"><strong>Default '+(m.which==='front'?'Front':'Back')+'</strong></span><span class="nlpdf-stack-count">'+m.count+' page'+(m.count===1?'':'s')+'</span></div><div class="nlpdf-grid-meta"><strong>'+esc(m.name)+'</strong><span>Locked default asset</span></div></article>';}
async function thumbCanvas(p,w=140,h=198){const c=document.createElement('canvas');await drawPageToCanvas(p,c,w,h);return c;}
async function renderFilmstrip(){
  const s=$('#nlpdfFilmstrip'),front=stackMeta('front'),back=stackMeta('back'),dups=duplicatePageIds();
  const visible=state.duplicateOnly?state.pages.filter(p=>dups.has(p.id)):state.pages;
  s.innerHTML=(state.duplicateOnly?'':(front?stackMini(front):''))+visible.map(p=>{const i=state.pages.indexOf(p),hash=duplicateHashForPage(p.id);return '<article class="nlpdf-page-card '+(state.selected.has(p.id)?'selected ':'')+(state.activeId===p.id?'active ':'')+(hash?'duplicate-warning':'')+'" data-page-id="'+p.id+'" draggable="true"><div class="nlpdf-thumb"><span class="nlpdf-page-index">'+(i+1)+'</span>'+(hash?'<button class="nlpdf-dup-dismiss" type="button" data-duplicate-dismiss="'+hash+'" title="Dismiss this duplicate warning">Dismiss</button>':'')+'<span class="nlpdf-loading"></span></div><div class="nlpdf-page-meta"><strong>'+esc(p.fileName)+'</strong><span>Page '+(i+1)+(hash?' · duplicate':'')+'</span></div></article>';}).join('')+(state.duplicateOnly?'':(back?stackMini(back):''));
  for(const p of visible){const h=s.querySelector('[data-page-id="'+CSS.escape(p.id)+'"] .nlpdf-thumb');if(!h)continue;thumbCanvas(p,140,198).then(c=>h.appendChild(c)).catch(()=>{});}
}
async function renderGrid(){
  const g=$('#nlpdfGrid'),front=stackMeta('front'),back=stackMeta('back'),dups=duplicatePageIds();
  const visible=state.duplicateOnly?state.pages.filter(p=>dups.has(p.id)):state.pages;
  g.innerHTML=(state.duplicateOnly?'':(front?stackGrid(front):''))+visible.map(p=>{const i=state.pages.indexOf(p),hash=duplicateHashForPage(p.id);return '<article class="nlpdf-grid-card '+(state.selected.has(p.id)?'selected ':'')+(state.activeId===p.id?'active ':'')+(hash?'duplicate-warning':'')+'" data-page-id="'+p.id+'" draggable="true"><div class="nlpdf-grid-thumb"><span class="nlpdf-page-index">'+(i+1)+'</span>'+(hash?'<button class="nlpdf-dup-dismiss" type="button" data-duplicate-dismiss="'+hash+'" title="Dismiss this duplicate warning">Dismiss</button>':'')+'</div><div class="nlpdf-grid-meta"><strong>'+esc(p.fileName)+'</strong><span>Document page '+(i+1)+(hash?' · duplicate':'')+'</span></div></article>';}).join('')+(state.duplicateOnly?'':(back?stackGrid(back):''));
  for(const p of visible){const h=g.querySelector('[data-page-id="'+CSS.escape(p.id)+'"] .nlpdf-grid-thumb');if(!h)continue;thumbCanvas(p,260,368).then(c=>h.appendChild(c)).catch(()=>{});}
}
async function renderAll(){updateControls();const tasks=[renderActive()];if(state.viewMode==='grid')tasks.push(renderGrid());else tasks.push(renderFilmstrip());await Promise.allSettled(tasks);}

/* View switching */
function setView(mode){state.viewMode=mode==='grid'?'grid':'single';$('#nlpdfSingleView').classList.toggle('active',state.viewMode==='single');$('#nlpdfGridView').classList.toggle('active',state.viewMode==='grid');$('#nlpdfStage').classList.toggle('hidden',state.viewMode==='grid');$('#nlpdfGridStage').classList.toggle('hidden',state.viewMode!=='grid');$('#nlpdfFilmstripWrap').classList.toggle('hidden',state.viewMode==='grid');if(state.viewMode==='grid')renderGrid();else{renderFilmstrip();renderActive();requestAnimationFrame(fitPaper);}}

/* Export */
async function sourcePdfDoc(k){if(state.pdfLibDocs.has(k))return state.pdfLibDocs.get(k);const s=state.sources.get(k),d=await window.PDFLib.PDFDocument.load(s.bytes.slice());state.pdfLibDocs.set(k,d);return d;}

function normalizeRightAngle(value){return ((Math.round((Number(value)||0)/90)*90)%360+360)%360;}
function pdfSourceVisualRotation(page){
  try{return normalizeRightAngle(page?.getRotation?.().angle||0);}catch{return 0;}
}
function pdfLayout(srcW,srcH,p,visualRot=normalizeRightAngle(p.rotation)){
  const rot=normalizeRightAngle(visualRot);
  const rw=(rot===90||rot===270)?srcH:srcW;
  const rh=(rot===90||rot===270)?srcW:srcH;
  const L=layoutOnSheet(p,rw,rh,A4.wPt,A4.hPt);
  const factor=L.w/rw;
  return {...L,rot,unrotatedW:srcW*factor,unrotatedH:srcH*factor};
}
function drawEmbedded(page,embedded,p,visualRot){
  const L=pdfLayout(embedded.width,embedded.height,p,visualRot);
  const bottom=A4.hPt-L.y-L.h;
  const pdfRot=normalizeRightAngle(360-L.rot);
  const opts={width:L.unrotatedW,height:L.unrotatedH,rotate:window.PDFLib.degrees(pdfRot)};
  if(pdfRot===0){opts.x=L.x;opts.y=bottom;}
  else if(pdfRot===90){opts.x=L.x+L.w;opts.y=bottom;}
  else if(pdfRot===180){opts.x=L.x+L.w;opts.y=bottom+L.h;}
  else{opts.x=L.x;opts.y=bottom+L.h;}
  page.drawPage(embedded,opts);
}
async function canvasPngBytes(canvas){
  const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!png)throw new Error('Could not render PDF page.');
  return new Uint8Array(await png.arrayBuffer());
}
function pdfCanvasAnnotationMode(){
  const modes=window.pdfjsLib?.AnnotationMode;
  return modes?.ENABLE_STORAGE??modes?.ENABLE??1;
}
async function pdfPageHasAnnotations(p){
  if(!p||p.kind!=='pdf')return false;
  const doc=state.pdfJsDocs.get(p.sourceKey);
  if(!doc)return true;
  try{
    const page=await doc.getPage(p.sourcePage);
    const annotations=await page.getAnnotations({intent:'any'});
    return Array.isArray(annotations)&&annotations.length>0;
  }catch(err){
    console.warn('Could not inspect PDF annotations; using raster-safe export for '+p.fileName+'.',err);
    return true;
  }
}
async function pdfBytesHaveAnnotations(bytes){
  const doc=await window.pdfjsLib.getDocument({data:bytes.slice()}).promise;
  try{
    for(let n=1;n<=doc.numPages;n++){
      const page=await doc.getPage(n),annotations=await page.getAnnotations({intent:'any'});
      if(Array.isArray(annotations)&&annotations.length)return true;
    }
    return false;
  }catch(err){
    console.warn('Could not inspect PDF annotations; using raster-safe asset export.',err);
    return true;
  }finally{doc.destroy?.();}
}
async function renderPdfPageForExport(doc,pageNumber,maxWidth=2000){
  const page=await doc.getPage(pageNumber),base=page.getViewport({scale:1});
  const scale=Math.max(1,Math.min(3,maxWidth/Math.max(1,base.width)));
  const viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  await page.render({canvasContext:ctx,viewport,intent:'display',annotationMode:pdfCanvasAnnotationMode()}).promise;
  return {canvas,base};
}
async function addRasterizedDocPage(out,p){
  const doc=state.pdfJsDocs.get(p.sourceKey);
  if(!doc)throw new Error('PDF preview source is unavailable.');
  const rendered=await renderPdfPageForExport(doc,p.sourcePage),cropped=cropRotateRaster(rendered.canvas,p);
  const image=await out.embedPng(await canvasPngBytes(cropped));
  const page=out.addPage([A4.wPt,A4.hPt]);
  const L=layoutOnSheet(p,image.width,image.height,A4.wPt,A4.hPt);
  page.drawImage(image,{x:L.x,y:A4.hPt-L.y-L.h,width:L.w,height:L.h});
  return page;
}
async function addDocPage(out,p){
  if(p.kind==='pdf'){
    // pdf-lib embedPage copies page content streams but not page annotations/widgets.
    // Rasterize annotated PDFs so added text, form values, highlights and other
    // visible overlays are flattened into the exported page instead of disappearing.
    if(await pdfPageHasAnnotations(p))return addRasterizedDocPage(out,p);
    try{
      const src=await sourcePdfDoc(p.sourceKey),sp=src.getPage(p.sourcePage-1),sz=sp.getSize(),c=p.crop;
      const sourceRot=pdfSourceVisualRotation(sp);
      const visualRot=normalizeRightAngle(sourceRot+(p.rotation||0));
      const sourceCrop=sourceCropForRotation(c,visualRot);const left=sz.width*sourceCrop.left/100,right=sz.width*(1-sourceCrop.right/100);
      const bottom=sz.height*sourceCrop.bottom/100,top=sz.height*(1-sourceCrop.top/100);
      const embedded=await out.embedPage(sp,{left,bottom,right,top});
      const page=out.addPage([A4.wPt,A4.hPt]);drawEmbedded(page,embedded,p,visualRot);return page;
    }catch(err){
      state.pdfLibDocs.delete(p.sourceKey);
      console.warn('Vector PDF export unavailable; using PDF.js raster fallback for '+p.fileName+'.',err);
      return addRasterizedDocPage(out,p);
    }
  }
  const source=await sourceRaster(p),cropped=cropRotateRaster(source,p);
  const image=await out.embedPng(await canvasPngBytes(cropped));
  const page=out.addPage([A4.wPt,A4.hPt]);
  const L=layoutOnSheet(p,image.width,image.height,A4.wPt,A4.hPt);
  page.drawImage(image,{x:L.x,y:A4.hPt-L.y-L.h,width:L.w,height:L.h});
  return page;
}

async function appendPdfAssetRasterized(out,bytes){
  const doc=await window.pdfjsLib.getDocument({data:bytes.slice()}).promise;
  try{
    const count=doc.numPages;
    for(let n=1;n<=count;n++){
      const rendered=await renderPdfPageForExport(doc,n);
      const image=await out.embedPng(await canvasPngBytes(rendered.canvas));
      const page=out.addPage([rendered.base.width,rendered.base.height]);
      page.drawImage(image,{x:0,y:0,width:rendered.base.width,height:rendered.base.height});
    }
    return count;
  }finally{doc.destroy?.();}
}
async function appendAsset(out,a){
  if(!a)return 0;
  const bytes=new Uint8Array(await a.blob.arrayBuffer());
  if(a.type==='application/pdf'||/\.pdf$/i.test(a.name)){
    // copyPages can lose AcroForm structure/field appearances. Preserve what the
    // user can actually see by flattening annotated default PDFs through PDF.js.
    if(await pdfBytesHaveAnnotations(bytes))return appendPdfAssetRasterized(out,bytes);
    try{
      const src=await window.PDFLib.PDFDocument.load(bytes.slice()),pages=await out.copyPages(src,src.getPageIndices());
      pages.forEach(p=>out.addPage(p));return pages.length;
    }catch(err){
      console.warn('Vector PDF asset import unavailable; using PDF.js raster fallback for '+a.name+'.',err);
      return appendPdfAssetRasterized(out,bytes);
    }
  }
  const img=a.type==='image/jpeg'?await out.embedJpg(bytes):await out.embedPng(bytes),pg=out.addPage([A4.wPt,A4.hPt]),m=22,fit=Math.min((A4.wPt-m*2)/img.width,(A4.hPt-m*2)/img.height),w=img.width*fit,h=img.height*fit;
  pg.drawImage(img,{x:(A4.wPt-w)/2,y:(A4.hPt-h)/2,width:w,height:h});return 1;
}
async function embedSignature(out){if(!state.assets.signature)return null;const b=new Uint8Array(await state.assets.signature.blob.arrayBuffer());return state.assets.signature.type==='image/jpeg'?await out.embedJpg(b):await out.embedPng(b);}

function drawSignature(page,img){
  if(!img)return false;
  const ratio=img.height/img.width;
  if(!Number.isFinite(ratio)||ratio<=0)throw new Error('Signature has invalid dimensions.');
  const width=Math.min(page.getWidth()*state.sig.widthPct,page.getHeight()*.55/ratio);
  const height=width*ratio;
  const x=clamp(page.getWidth()*state.sig.xPct,0,page.getWidth()-width);
  const y=clamp(page.getHeight()*(1-state.sig.yPct)-height,0,page.getHeight()-height);
  page.drawImage(img,{x,y,width,height,opacity:1});
  return true;
}

async function buildPdf(progress=()=>{}){
  await ensurePdfLibs();const out=await window.PDFLib.PDFDocument.create();
  progress('Preparing default documents…',0,state.pages.length);
  if($('#nlpdfUseFront').checked&&state.assets.front)await appendAsset(out,state.assets.front);
  const sig=$('#nlpdfUseSignature').checked&&state.assets.signature?await embedSignature(out):null,scope=$('#nlpdfSigScope').value;
  let signed=0;
  for(let i=0;i<state.pages.length;i++){
    progress('Processing document '+(i+1)+' of '+state.pages.length+'…',i,state.pages.length);
    const pg=await addDocPage(out,state.pages[i]);
    if(sig&&(scope==='all'||(scope==='page'&&state.pages[i].id===state.signaturePageId)))signed+=drawSignature(pg,sig)?1:0;
  }
  if(sig&&signed===0)throw new Error('Select a document page for the signature or use All document pages.');
  if($('#nlpdfUseBack').checked&&state.assets.back)await appendAsset(out,state.assets.back);
  progress('Finalizing PDF…',state.pages.length,state.pages.length);
  out.setCreator('BU International Center Workspace');out.setProducer('New Letter PDF Builder');return new Uint8Array(await out.save());
}
function customNoIenTemplate(){try{const e=JSON.parse(localStorage.getItem(NO_IEN_OVERRIDE_KEY)||'null');if(e&&typeof e.base64==='string'&&e.base64.length>100)return e;}catch{}return null;}
function letterBytes(key){const t=(key==='bachelor_no_ien'?customNoIenTemplate():null)||window.LETTER_TEMPLATES?.[key];if(!t?.base64)throw new Error('Selected Word template is missing.');const bin=atob(t.base64),b=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);return b;}
async function writeFile(dir,name,data){const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(data);await w.close();}
function caseNumber(){return clean($('#caseStudentNumber')?.value)||clean($('#studentNumber')?.value);}
function caseName(){return clean($('#caseStudentName')?.value)||clean($('#studentName')?.value);}
function selectedOutputs(){
  const values=new Set($$('input[name="nlpdfOutput"]:checked').map(x=>x.value));
  return {folder:values.has('folder'),pdf:values.has('pdf'),letter:values.has('letter'),any:values.size>0};
}
function openExport(){
  state.editLetterRequested=false;
  $('#nlpdfEditLetter').classList.remove('active');
  $('#nlpdfExportNumber').value=caseNumber();$('#nlpdfExportName').value=caseName();$('#nlpdfExportPdfName').dataset.auto='1';syncExportPreview();
  $('#nlpdfFinalPages').textContent=state.pages.length+' document page'+(state.pages.length===1?'':'s')+(stackMeta('front')?' + front':'')+(stackMeta('back')?' + back':'');
  $('#nlpdfExportModal').classList.add('open');$('#nlpdfExportModal').setAttribute('aria-hidden','false');
}
function closeExport(){$('#nlpdfExportModal').classList.remove('open');$('#nlpdfExportModal').setAttribute('aria-hidden','true');}
function syncExportPreview(){
  const num=safePath($('#nlpdfExportNumber').value)||'3408',name=safePath($('#nlpdfExportName').value)||'Miss ABC',pdf=$('#nlpdfExportPdfName');
  if(pdf.dataset.auto==='1'||!clean(pdf.value))pdf.value='Documents_'+name+'.pdf';
  const outputs=selectedOutputs();
  $('#nlpdfFinalFolder').textContent=outputs.folder?num+' '+name:'Not created';
  $('#nlpdfFinalLetter').textContent=outputs.letter?'Letter_'+name+'.docx':'Not created';
  $('#nlpdfFinalPdf').textContent=outputs.pdf?pdf.value:'Not created';
  const needsLetter=state.editLetterRequested&&!outputs.letter;
  $('#nlpdfLetterRequirement').classList.toggle('hidden',!needsLetter);
  $('#nlpdfEditLetter').classList.toggle('active',state.editLetterRequested);
  const confirm=$('#nlpdfConfirmExport');
  confirm.textContent='Create Package';
  confirm.disabled=state.busy||!outputs.any||needsLetter;
}
function requestLetterEdit(){
  state.editLetterRequested=!state.editLetterRequested;
  syncExportPreview();
  if(!state.editLetterRequested){toast('Edit letter turned off.');return;}
  if(!selectedOutputs().letter){toast('Select Letter to continue with Edit letter.');return;}
  toast('Edit letter turned on.');
}
async function chooseDestination(){
  if(!window.showDirectoryPicker){toast('Folder selection requires Chrome or Edge.');return false;}
  try{state.destinationHandle=await window.showDirectoryPicker({mode:'readwrite'});$('#nlpdfDestinationName').textContent=state.destinationHandle.name||'Selected folder';$('#nlpdfDestinationHelp').textContent='Selected outputs will be created here.';return true;}catch(err){if(err?.name!=='AbortError')toast(err.message||'Could not select destination.');return false;}
}
function exportProgress(title,detail='',done=0,total=0,mode='active'){
  const layer=$('#nlpdfExportProgress'),heading=$('#nlpdfProgressTitle'),body=$('#nlpdfProgressDetail');
  if(!layer||!heading||!body)return;
  layer.classList.remove('hidden');
  layer.dataset.mode=mode;
  heading.textContent=title;body.textContent=detail;
  const fill=$('#nlpdfProgressFill'),counter=$('#nlpdfProgressCounter');
  const counted=Number.isFinite(total)&&total>0;
  if(fill){fill.style.width=counted?Math.round(100*clamp(done/total,0,1))+'%':'38%';fill.classList.toggle('indeterminate',!counted&&mode==='active');}
  if(counter)counter.textContent=counted?done+' / '+total+' document pages':'';
}
function hideExportProgress(){
  const layer=$('#nlpdfExportProgress');if(!layer)return;
  layer.classList.add('hidden');layer.dataset.mode='';
}
async function allowExportProgressToPaint(){
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
function letterTypeLabel(type){
  return ({
    bachelor_no_ien:'Bachelor Degree No IEN',
    bachelor:'Bachelor Degree',
    current_no_ien:'Current No IEN',
    exchange:'Exchange Bachelor',
    master:'Master Degree',
    doctor:'Doctor Degree',
    visiting:'Visiting Student'
  })[type]||type||'Student';
}
function normalizedLetterValue(value){return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').replace(/[.:;,]+$/g,'').trim();}
function snapshotRows(sheet){
  const rows=window.REFERENCE_SNAPSHOT?.[sheet];if(!Array.isArray(rows)||rows.length<2)return[];
  const headers=rows[0].map(clean);return rows.slice(1).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]??''])));
}
function centralReference(){
  const live=window.BUIC_REFERENCE_DATA;
  if(live?.countries&&live?.faculty&&live?.embassy)return live;
  return {countries:snapshotRows('Countries'),faculty:snapshotRows('Faculty_Major'),embassy:snapshotRows('Embassy')};
}
function countryValues(r){
  return {
    id:clean(r['Record ID']),countryEn:clean(r['Country EN'])||clean(r['Full Country Name EN']),fullCountryEn:clean(r['Full Country Name EN'])||clean(r['Country EN']),
    countryTh:clean(r['Country TH'])||clean(r['Full Country Name TH']),fullCountryTh:clean(r['Full Country Name TH'])||clean(r['Country TH']),
    nationalityEn:clean(r['Nationality EN']),nationalityTh:clean(r['Nationality TH'])
  };
}
function facultyValues(r){
  return {
    id:clean(r['Record ID']),programEn:clean(r['Major EN'])||clean(r['(auto) Major EN Copy'])||clean(r['Major EN Copy']),
    programTh:clean(r['Major TH']),facultyEn:(clean(r['Faculty EN'])||clean(r['(auto) Faculty EN Copy'])||clean(r['Faculty EN Copy'])).replace(/^School of\s+/i,''),
    facultyTh:clean(r['Faculty TH']),degree:clean(r['Degree Level'])
  };
}
function embassyValues(r){
  const address=clean(r['Current Address EN'])||clean(r['Address EN']);
  const lines=address.split(/\r?\n|\s*\|\s*/).map(clean).filter(Boolean);
  return {
    id:clean(r['Record ID']),embassy:clean(r['Current Display Name EN'])||clean(r['Display Name EN'])||clean(r['Current Office Name EN'])||clean(r['Office Name EN']),
    embassyOffice:clean(r['Current Office Name EN'])||clean(r['Office Name EN']),
    embassyThai:clean(r['Current Official Name TH'])||clean(r['Official Name TH']),
    embassyCountry:clean(r['Current Country / Territory EN'])||clean(r['Country / Territory EN']),
    embassyCity:clean(r['Current City EN'])||clean(r['City EN']),address,lines
  };
}
function exactCentralMatch(value){
  const v=normalizedLetterValue(value);if(!v)return null;
  const refs=centralReference();
  for(const r of refs.countries||[]){
    const x=countryValues(r);
    for(const [kind,val] of [['nationalityEn',x.nationalityEn],['nationalityTh',x.nationalityTh],['countryEn',x.countryEn],['countryEn',x.fullCountryEn],['countryTh',x.countryTh],['countryTh',x.fullCountryTh]])if(val&&normalizedLetterValue(val)===v)return {kind,record:r};
  }
  for(const r of refs.faculty||[]){
    const x=facultyValues(r);
    for(const [kind,val] of [['programEn',x.programEn],['programTh',x.programTh],['facultyEn',x.facultyEn],['facultyTh',x.facultyTh]])if(val&&normalizedLetterValue(val)===v)return {kind,record:r};
  }
  for(const r of refs.embassy||[]){
    const x=embassyValues(r);
    for(const [kind,val] of [['embassy',x.embassy],['embassy',x.embassyOffice],['embassyThai',x.embassyThai]])if(val&&normalizedLetterValue(val)===v)return {kind,record:r};

  }
  return null;
}
function letterPackageProfiles(){try{const value=JSON.parse(localStorage.getItem(LETTER_PACKAGE_DATES_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}}
function letterPackageKey(type,semester,year){return [clean(type).toLowerCase(),clean(semester).toLowerCase(),clean(year)].join('|');}
function packageFieldElement(kind){return ({semester:'#nlpdfLetterSemester',academicYear:'#nlpdfLetterAcademicYear',startDate:'#nlpdfLetterStartDate',finishDate:'#nlpdfLetterFinishDate',orientation:'#nlpdfLetterOrientation'})[kind]||'';}
function packageFieldValue(kind){const selector=packageFieldElement(kind);return selector?clean($(selector)?.value):'';}
function setPackageField(kind,value){const selector=packageFieldElement(kind),el=selector?$(selector):null;if(el&&value!==undefined&&value!==null)el.value=value;}
function packageAcademicYearThai(){const y=Number(packageFieldValue('academicYear'));return Number.isFinite(y)&&y>1900?String(y+543):packageFieldValue('academicYear');}
function applySavedPackageDates(context){
  const semester=packageFieldValue('semester'),year=packageFieldValue('academicYear');
  if(!semester||!year){$('#nlpdfLetterPackageStatus').textContent='Choose Semester and Academic year to reuse saved dates.';return false;}
  const profile=letterPackageProfiles()[letterPackageKey(context.type,semester,year)];
  if(!profile){$('#nlpdfLetterPackageStatus').textContent='No saved dates for this combination. Template values are shown.';return false;}
  for(const kind of ['startDate','finishDate','orientation'])if(profile[kind])setPackageField(kind,profile[kind]);
  $('#nlpdfLetterPackageStatus').textContent='Loaded saved dates for '+letterTypeLabel(context.type)+' · '+semester+' · '+year+'.';
  syncPackageValuesToContext(context);return true;
}
function savePackageDates(context){
  const semester=packageFieldValue('semester'),year=packageFieldValue('academicYear');if(!semester||!year)return;
  const profiles=letterPackageProfiles();
  profiles[letterPackageKey(context.type,semester,year)]={startDate:packageFieldValue('startDate'),finishDate:packageFieldValue('finishDate'),orientation:packageFieldValue('orientation')};
  try{localStorage.setItem(LETTER_PACKAGE_DATES_KEY,JSON.stringify(profiles));}catch{}
}
function highlightedRun(run,ns){
  const pr=[...run.children].find(x=>x.localName==='rPr');if(!pr)return false;
  const h=[...pr.getElementsByTagNameNS(ns,'highlight')][0];
  if(h){const value=(h.getAttributeNS(ns,'val')||h.getAttribute('w:val')||h.getAttribute('val')||'yellow').toLowerCase();if(value&&value!=='none'&&value!=='white')return true;}
  const shd=[...pr.getElementsByTagNameNS(ns,'shd')][0];
  if(shd){const fill=(shd.getAttributeNS(ns,'fill')||shd.getAttribute('w:fill')||shd.getAttribute('fill')||'').toUpperCase();if(fill&&!['AUTO','FFFFFF','000000','NIL'].includes(fill))return true;}
  return false;
}
function ensureYellowHighlight(run,doc,ns){
  let pr=[...run.children].find(x=>x.localName==='rPr');if(!pr){pr=doc.createElementNS(ns,'w:rPr');run.insertBefore(pr,run.firstChild);}
  let h=[...pr.getElementsByTagNameNS(ns,'highlight')][0];if(!h){h=doc.createElementNS(ns,'w:highlight');pr.appendChild(h);}h.setAttributeNS(ns,'w:val','yellow');
}
function paragraphRecord(paragraph,index,ns,pageIndex){
  let offset=0;
  const runs=[...paragraph.getElementsByTagNameNS(ns,'r')].map(run=>{
    const texts=[...run.getElementsByTagNameNS(ns,'t')],value=texts.map(t=>t.textContent||'').join(''),start=offset,end=offset+value.length;offset=end;
    return {run,texts,value,start,end,highlighted:highlightedRun(run,ns)};
  });
  const full=runs.map(x=>x.value).join('');
  const pPr=[...paragraph.children].find(x=>x.localName==='pPr');
  const jc=pPr?.getElementsByTagNameNS(ns,'jc')?.[0]?.getAttributeNS(ns,'val')||'left';
  const br=[...paragraph.getElementsByTagNameNS(ns,'br')].some(x=>(x.getAttributeNS(ns,'type')||'')==='page');
  return {paragraph,index,pageIndex,runs,full,jc,pageBreak:br,occurrences:[]};
}
function highlightedRanges(record){
  const out=[];let cur=null;
  for(const r of record.runs){
    if(r.highlighted&&clean(r.value)){if(!cur)cur={start:r.start,end:r.end,value:r.value};else{cur.end=r.end;cur.value+=r.value;}}
    else if(cur){out.push(cur);cur=null;}
  }
  if(cur)out.push(cur);return out;
}
function overlapsHighlighted(record,start,end){return record.runs.some(r=>r.highlighted&&Math.max(start,r.start)<Math.min(end,r.end));}
function occurrenceParts(record,start,end){
  return record.runs.filter(r=>Math.max(start,r.start)<Math.min(end,r.end)).map(r=>({run:r.run,texts:r.texts,original:r.value,from:Math.max(0,start-r.start),to:Math.min(r.value.length,end-r.start),runStart:r.start}));
}
function addOccurrence(fields,record,kind,label,start,end,opts={}){
  if(start<0||end<=start||!overlapsHighlighted(record,start,end))return null;
  if(record.occurrences.some(o=>Math.max(start,o.start)<Math.min(end,o.end)))return null;
  const raw=record.full.slice(start,end);
  const key=kind;
  let field=fields.get(key);
  if(!field){field={key,kind,label,value:raw,package:Boolean(opts.package),reference:opts.reference||'',occurrences:[]};fields.set(key,field);}
  const occurrence={record,start,end,raw,parts:occurrenceParts(record,start,end),format:opts.format||''};
  field.occurrences.push(occurrence);record.occurrences.push({field, ...occurrence});
  return field;
}
function addRegexOccurrence(fields,record,re,kind,label,group=1,opts={}){
  const m=re.exec(record.full);if(!m)return null;
  const value=m[group];if(value===undefined)return null;
  const local=m[0].indexOf(value),start=m.index+Math.max(0,local),end=start+value.length;
  return addOccurrence(fields,record,kind,label,start,end,opts);
}
function semanticLetterModel(doc,ns){
  const body=[...doc.getElementsByTagNameNS(ns,'body')][0],records=[];let pageIndex=0,index=0;
  for(const node of [...body.children]){
    if(node.localName!=='p')continue;
    const rec=paragraphRecord(node,index++,ns,pageIndex);records.push(rec);if(rec.pageBreak)pageIndex++;
  }
  const fields=new Map();
  for(const rec of records){
    const t=rec.full,trim=clean(t);
    if(!trim)continue;
    if(/^([A-Z][a-z]+\s+\d{1,2},\s+\d{4}|[Dd][d]mm,\s*\d{4})$/.test(trim))addOccurrence(fields,rec,'letterDateEn','Letter date',t.indexOf(trim),t.indexOf(trim)+trim.length);
    addRegexOccurrence(fields,rec,/^To:\s*(.+)$/,'studentName','Student name');
    addRegexOccurrence(fields,rec,/^Dear\s+(.+?)(?::)?$/,'studentName','Student name');
    addRegexOccurrence(fields,rec,/Program of Study:\s*(.+)$/,'programEn','Program / Major',1,{reference:'faculty'});
    addRegexOccurrence(fields,rec,/School:\s*(.+)$/,'facultyEn','School / Faculty',1,{reference:'faculty'});
    addRegexOccurrence(fields,rec,/Starting Date:\s*(.+)$/,'startDate','Starting Date',1,{package:true});
    addRegexOccurrence(fields,rec,/Finishing Date:\s*(.+?)\s*$/,'finishDate','Finishing Date',1,{package:true});
    addRegexOccurrence(fields,rec,/The\s+(?:Preliminary Course of the\s+)?(First|Second|Summer)\s+Semester/,'semester','Semester',1,{package:true});
    addRegexOccurrence(fields,rec,/Academic Year\s+(\d{4})/,'academicYear','Academic year',1,{package:true});
    addRegexOccurrence(fields,rec,/(?:commence|started)\s+on\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/,'startDate','Starting Date',1,{package:true});
    addRegexOccurrence(fields,rec,/Orientation[^.]*?(?:on|during)\s+(.+?)(?:\s*$)/,'orientation','Orientation',1,{package:true});
    addRegexOccurrence(fields,rec,/Passport\s+No\.\s*([A-Za-z0-9]+)/i,'passport','Passport number');
    addRegexOccurrence(fields,rec,/I am writing to inform you that\s+([^,]+),/,'studentName','Student name');
    addRegexOccurrence(fields,rec,/,\s+(?:an?\s+)?([^,]+?)\s+Citizen\b/,'nationalityEn','Nationality',1,{reference:'country'});
    addRegexOccurrence(fields,rec,/student at\s+([^,]+),/i,'homeUniversity','Home university / school');
    addRegexOccurrence(fields,rec,/student at\s+[^,]+,\s*([^,]+?)\s+has been admitted/i,'homeCountry','Home university country');
    addRegexOccurrence(fields,rec,/(?:Bachelor’s|Master’s|Doctor)\s+Degree Program in\s+(.+?)(?:\.|\s+The study period)/,'programEn','Program / Major',1,{reference:'faculty'});
    addRegexOccurrence(fields,rec,/study period spans from\s+(.+?)(?:\.|$)/i,'studyPeriod','Study period');
    addRegexOccurrence(fields,rec,/issuing\s+(.+?)\s+an extendable/i,'studentName','Student name');
    addRegexOccurrence(fields,rec,/ที่\s*มกท\/ศนช\.\s*([0-9]+)/,'documentNo','Document number');
    if(/^\d{1,2}\s+[\u0E00-\u0E7F]+\s+25\d{2}$/.test(trim))addOccurrence(fields,rec,'thaiLetterDate','วันที่หนังสือ',t.indexOf(trim),t.indexOf(trim)+trim.length);
    addRegexOccurrence(fields,rec,/เรื่อง[^\n]*ของ\s+(.+)$/,'studentName','Student name');
    addRegexOccurrence(fields,rec,/เรียน[^\n]*?(?:ประจำ)?(.+)$/,'embassyThai','สถานทูต / สถานกงสุล',1,{reference:'embassy'});
    addRegexOccurrence(fields,rec,/มหาวิทยาลัยได้รับ\s+(.+?)\s+สัญชาติ/,'studentName','Student name');
    addRegexOccurrence(fields,rec,/สัญชาติ\s*([^\s]+(?:\s+[^\s]+)?)\s+หนังสือเดินทางหมายเลข/,'nationalityTh','สัญชาติ',1,{reference:'country'});
    addRegexOccurrence(fields,rec,/หนังสือเดินทางหมายเลข\s*([A-Za-z0-9]+)/,'passport','Passport number');
    addRegexOccurrence(fields,rec,/ภาคการศึกษาที่\s*([123])/,'semester','Semester',1,{package:true,format:'semesterNumber'});
    addRegexOccurrence(fields,rec,/ปีการศึกษา\s*(25\d{2})/,'academicYearThai','ปีการศึกษา',1,{package:true,format:'thaiYear'});
    if(/\(\d{1,2}\s+[\u0E00-\u0E7F]+\s+25\d{2}\s*[-–]\s*\d{1,2}\s+[\u0E00-\u0E7F]+\s+25\d{2}\)/.test(t))addRegexOccurrence(fields,rec,/(\d{1,2}\s+[\u0E00-\u0E7F]+\s+25\d{2}\s*[-–]\s*\d{1,2}\s+[\u0E00-\u0E7F]+\s+25\d{2})/,'studyPeriodThai','ช่วงเวลาศึกษา');
  }
  for(const rec of records){
    for(const range of highlightedRanges(rec)){
      if(rec.occurrences.some(o=>Math.max(range.start,o.start)<Math.min(range.end,o.end)))continue;
      const match=exactCentralMatch(range.value);if(!match)continue;
      const label=({nationalityEn:'Nationality',nationalityTh:'สัญชาติ',countryEn:'Country',countryTh:'ประเทศ',programEn:'Program / Major',programTh:'สาขาวิชา',facultyEn:'School / Faculty',facultyTh:'คณะ / วิทยาลัย',embassy:'Thai mission / Embassy',embassyThai:'สถานทูต / สถานกงสุล',embassyAddress:'Embassy address'})[match.kind]||match.kind;
      const reference=match.kind==='embassy'?'embassy':match.kind==='programEn'||match.kind==='facultyEn'?'faculty':match.kind==='nationalityEn'||match.kind==='countryEn'?'country':'';
      addOccurrence(fields,rec,match.kind,label,range.start,range.end,{reference});
    }
  }
  const embassyRecs=centralReference().embassy||[];
  for(const rec of records){
    if(rec.occurrences.length)continue;
    const range=highlightedRanges(rec);
    if(range.length!==1||!clean(range[0].value))continue;
    const val=normalizedLetterValue(range[0].value);
    let lineNo=0,hit=null;
    for(const er of embassyRecs){
      const e=embassyValues(er),parts=e.address.split(/\r?\n/).map(clean).filter(Boolean);
      const ix=parts.findIndex(x=>normalizedLetterValue(x)===val||normalizedLetterValue(x).includes(val));
      if(ix>=0){hit=er;lineNo=ix+1;break;}
    }
    if(hit)addOccurrence(fields,rec,'embassyAddress'+lineNo,'Embassy address '+lineNo,range[0].start,range[0].end);
  }
  for(let i=0;i<records.length;i++){
    const rec=records[i];
    if(!/^To:\s*/.test(rec.full))continue;
    for(let j=i+1;j<Math.min(records.length,i+5);j++){
      const next=records[j];if(!clean(next.full))continue;
      const ranges=highlightedRanges(next);
      if(ranges.length===1&&!next.occurrences.length)addOccurrence(fields,next,'recipientLocation','Student location',ranges[0].start,ranges[0].end);
      break;
    }
  }
  return {records,fields:[...fields.values()],pages:Math.max(1,...records.map(r=>r.pageIndex+1))};
}
function paragraphCss(record){
  const align=record.jc==='center'?'center':record.jc==='right'?'right':record.jc==='both'?'justify':'left';
  return 'text-align:'+align+';';
}
function runStaticHtml(run){
  let style='';
  const pr=[...run.run.children].find(x=>x.localName==='rPr'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  if(pr){
    if(pr.getElementsByTagNameNS(ns,'b').length)style+='font-weight:700;';
    if(pr.getElementsByTagNameNS(ns,'i').length)style+='font-style:italic;';
    if(pr.getElementsByTagNameNS(ns,'u').length)style+='text-decoration:underline;';
    const sz=pr.getElementsByTagNameNS(ns,'sz')[0]?.getAttributeNS(ns,'val');if(sz)style+='font-size:'+(Number(sz)/2)+'pt;';
  }
  if(run.highlighted)style+='background:#fff176;';
  return '<span'+(style?' style="'+style+'"':'')+'>'+esc(run.value)+'</span>';
}
function fieldCurrentValue(context,field){
  if(field.kind==='academicYearThai')return packageAcademicYearThai()||field.value;
  if(field.package)return packageFieldValue(field.kind)||field.value;
  return context.values[field.key]??field.value;
}
function semesterNumber(v){return ({First:'1',Second:'2',Summer:'3'})[v]||v;}
function occurrenceValue(context,field,occ){
  const value=fieldCurrentValue(context,field);
  if(occ.format==='semesterNumber')return semesterNumber(value);
  if(occ.format==='thaiYear')return packageAcademicYearThai()||value;
  return value;
}
function bestCountryRecord(value){
  const v=normalizedLetterValue(value);return (centralReference().countries||[]).find(r=>Object.values(countryValues(r)).some(x=>typeof x==='string'&&normalizedLetterValue(x)===v));
}
function bestFacultyRecord(value){
  const v=normalizedLetterValue(value);return (centralReference().faculty||[]).find(r=>Object.values(facultyValues(r)).some(x=>typeof x==='string'&&normalizedLetterValue(x)===v));
}
function bestEmbassyRecord(value){
  const v=normalizedLetterValue(value);return (centralReference().embassy||[]).find(r=>Object.values(embassyValues(r)).some(x=>typeof x==='string'&&normalizedLetterValue(x)===v));
}
function renderRefSelect(field,context,refKind){
  const refs=centralReference();let rows=[],labelFn,match;
  if(refKind==='country'){rows=refs.countries||[];labelFn=r=>{const x=countryValues(r);return x.nationalityEn||x.countryEn;};match=bestCountryRecord(fieldCurrentValue(context,field));}
  if(refKind==='faculty'){rows=refs.faculty||[];labelFn=r=>{const x=facultyValues(r);return x.programEn||x.facultyEn;};match=bestFacultyRecord(fieldCurrentValue(context,field));}
  if(refKind==='embassy'){rows=refs.embassy||[];labelFn=r=>embassyValues(r).embassy;match=bestEmbassyRecord(fieldCurrentValue(context,field));}
  const opts=rows.map(r=>'<option value="'+esc(clean(r['Record ID']))+'" '+(match&&clean(match['Record ID'])===clean(r['Record ID'])?'selected':'')+'>'+esc(labelFn(r))+'</option>').join('');
  return '<select class="nlpdf-inline-field nlpdf-inline-select" data-letter-ref="'+refKind+'" data-letter-key="'+esc(field.key)+'" aria-label="'+esc(field.label)+'"><option value="">'+esc(fieldCurrentValue(context,field))+'</option>'+opts+'</select>';
}
function renderInlineField(field,context,occ){
  if(field.reference)return renderRefSelect(field,context,field.reference);
  const value=occurrenceValue(context,field,occ);
  const readonly=field.package?' readonly data-package-inline="1"':'';
  return '<input class="nlpdf-inline-field '+(field.package?'is-package':'')+'" data-letter-key="'+esc(field.key)+'" value="'+esc(value)+'" aria-label="'+esc(field.label)+'" title="'+esc(field.label)+'"'+readonly+'>';
}
function renderParagraph(record,context){
  if(record.pageBreak)return '';
  const occs=[...record.occurrences].sort((a,b)=>a.start-b.start);
  if(!occs.length)return '<p class="nlpdf-doc-paragraph" style="'+paragraphCss(record)+'">'+record.runs.map(runStaticHtml).join('')+'</p>';
  let html='',cursor=0;
  for(const occ of occs){
    if(occ.start>cursor)html+=esc(record.full.slice(cursor,occ.start));
    html+=renderInlineField(occ.field,context,occ);
    cursor=occ.end;
  }
  if(cursor<record.full.length)html+=esc(record.full.slice(cursor));
  return '<p class="nlpdf-doc-paragraph" style="'+paragraphCss(record)+'">'+html+'</p>';
}
function renderLetterDocument(context){
  const host=$('#nlpdfLetterDocument');if(!host)return;
  const pages=[];
  for(let page=0;page<context.editor.model.pages;page++){
    const content=context.editor.model.records.filter(r=>r.pageIndex===page).map(r=>renderParagraph(r,context)).join('');
    pages.push('<article class="nlpdf-letter-page"><div class="nlpdf-letter-page-header"><div class="nlpdf-letter-bu-mark">BANGKOK<br>UNIVERSITY</div><div class="nlpdf-letter-bu-address">BANGKOK UNIVERSITY<br>9/1 Moo 5 Phahonyothin Rd. Klong Nueng<br>Klong Luang Pathum Thani 12120</div><div class="nlpdf-letter-bu-address thai">มหาวิทยาลัยกรุงเทพ<br>9/1 หมู่ที่ 5 ถนนพหลโยธิน อำเภอคลองหลวง<br>จังหวัดปทุมธานี 12120</div></div><div class="nlpdf-letter-page-body">'+content+'</div></article>');
  }
  host.innerHTML=pages.join('');
}
function syncLetterControls(context,key,value){
  context.values[key]=value;
  $$('[data-letter-key="'+CSS.escape(key)+'"]','#nlpdfLetterDocument').forEach(el=>{if(el.tagName==='SELECT')return;if(document.activeElement!==el)el.value=value;});
}
function applyReferenceRecord(context,kind,id){
  const refs=centralReference();
  if(kind==='country'){
    const r=(refs.countries||[]).find(x=>clean(x['Record ID'])===id);if(!r)return;const x=countryValues(r);
    for(const k of ['nationalityEn','nationalityTh','countryEn','countryTh'])if(x[k])syncLetterControls(context,k,x[k]);
  }else if(kind==='faculty'){
    const r=(refs.faculty||[]).find(x=>clean(x['Record ID'])===id);if(!r)return;const x=facultyValues(r);
    for(const k of ['programEn','programTh','facultyEn','facultyTh'])if(x[k])syncLetterControls(context,k,x[k]);
  }else if(kind==='embassy'){
    const r=(refs.embassy||[]).find(x=>clean(x['Record ID'])===id);if(!r)return;const x=embassyValues(r);
    for(const k of ['embassy','embassyThai','embassyCountry'])if(x[k])syncLetterControls(context,k,x[k]);
    x.lines.slice(0,4).forEach((line,i)=>syncLetterControls(context,'embassyAddress'+(i+1),line));
  }
  renderLetterDocument(context);
}
function inferInitialPackage(context){
  const fields=context.editor.model.fields;
  const semester=fields.find(f=>f.kind==='semester')?.value;
  if(semester)setPackageField('semester',/^1$/.test(semester)?'First':/^2$/.test(semester)?'Second':/^3$/.test(semester)?'Summer':semester);
  const year=fields.find(f=>f.kind==='academicYear')?.value||fields.find(f=>f.kind==='academicYearThai')?.value;
  if(year)setPackageField('academicYear',Number(year)>2500?String(Number(year)-543):year);
  for(const kind of ['startDate','finishDate','orientation']){const f=fields.find(x=>x.kind===kind);if(f)setPackageField(kind,f.value);}
}
function syncPackageValuesToContext(context){
  for(const kind of ['semester','academicYear','startDate','finishDate','orientation'])context.values[kind]=packageFieldValue(kind);
  context.values.academicYearThai=packageAcademicYearThai();
  renderLetterDocument(context);
}
function openPackageSettings(){
  const panel=$('#nlpdfPackageSettings');panel.classList.remove('hidden');panel.setAttribute('aria-hidden','false');
}
function closePackageSettings(){
  const panel=$('#nlpdfPackageSettings');panel.classList.add('hidden');panel.setAttribute('aria-hidden','true');
}
async function prepareLetterEditor(context){
  await ensureZip();const bytes=letterBytes(context.type),zip=await window.JSZip.loadAsync(bytes),xmlFile=zip.file('word/document.xml');
  if(!xmlFile)throw new Error('The selected Word template has no editable document body.');
  const xml=await xmlFile.async('string'),doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw new Error('The selected Word template could not be read.');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',model=semanticLetterModel(doc,ns);
  context.editor={zip,doc,ns,model};context.values={};state.pendingLetter=context;
  for(const field of model.fields)context.values[field.key]=field.value;
  $('#nlpdfLetterEditorTitle').textContent='Edit '+letterTypeLabel(context.type);$('#nlpdfLetterEditorContext').textContent=(context.num?context.num+' · ':'')+context.name;$('#nlpdfLetterStudentType').value=letterTypeLabel(context.type);
  inferInitialPackage(context);applySavedPackageDates(context);syncPackageValuesToContext(context);renderLetterDocument(context);
  const body=$('#nlpdfLetterDocument');
  body.oninput=e=>{const el=e.target.closest('[data-letter-key]');if(!el||el.tagName==='SELECT'||el.hasAttribute('readonly'))return;syncLetterControls(context,el.dataset.letterKey,el.value);};
  body.onchange=e=>{const el=e.target.closest('[data-letter-ref]');if(!el)return;applyReferenceRecord(context,el.dataset.letterRef,el.value);};
  body.onclick=e=>{if(e.target.closest('[data-package-inline]'))openPackageSettings();};
  $('#nlpdfPackageSettingsBtn').onclick=openPackageSettings;$('#nlpdfClosePackageSettings').onclick=closePackageSettings;
  const packageChanged=()=>{syncPackageValuesToContext(context);};
  for(const id of ['nlpdfLetterStartDate','nlpdfLetterFinishDate','nlpdfLetterOrientation'])$('#'+id).oninput=packageChanged;
  $('#nlpdfLetterSemester').onchange=()=>{if(!applySavedPackageDates(context))packageChanged();};
  $('#nlpdfLetterAcademicYear').onchange=()=>{if(!applySavedPackageDates(context))packageChanged();};
  $('#nlpdfCreateEditedLetter').disabled=!model.fields.length;
  $('#nlpdfLetterEditorStatus').textContent=model.fields.length+' linked editable topic'+(model.fields.length===1?'':'s')+' identified. Unrecognized highlighted text stays unchanged.';
  $('#nlpdfLetterEditor').classList.remove('hidden');$('#nlpdfLetterEditor').setAttribute('aria-hidden','false');
}
function closeLetterEditor(){closePackageSettings();$('#nlpdfLetterEditor').classList.add('hidden');$('#nlpdfLetterEditor').setAttribute('aria-hidden','true');state.pendingLetter=null;}
function fieldReplacement(context,field,occ){return occurrenceValue(context,field,occ);}
function replaceOccurrence(occ,value,doc,ns){
  const parts=occ.parts;if(!parts.length)return;
  parts.forEach((part,i)=>{
    if(!part.texts.length)return;
    const before=i===0?part.original.slice(0,part.from):'',after=i===parts.length-1?part.original.slice(part.to):'';
    part.texts[0].textContent=(i===0?before+value:before)+(i===parts.length-1?after:'');
    if(/^\s|\s$/.test(part.texts[0].textContent))part.texts[0].setAttribute('xml:space','preserve');else part.texts[0].removeAttribute('xml:space');
    for(let j=1;j<part.texts.length;j++)part.texts[j].textContent='';
    if(i===0)ensureYellowHighlight(part.run,doc,ns);
  });
}
async function createEditedLetter(){
  const context=state.pendingLetter;if(!context?.editor||state.busy)return;
  state.busy=true;$('#nlpdfCreateEditedLetter').disabled=true;$('#nlpdfLetterEditorStatus').textContent='Creating letter…';
  try{
    const {zip,doc,ns,model}=context.editor;
    const all=[];
    for(const field of model.fields)for(const occ of field.occurrences)all.push({field,occ});
    all.sort((a,b)=>b.occ.record.index-a.occ.record.index||b.occ.start-a.occ.start);
    for(const item of all)replaceOccurrence(item.occ,fieldReplacement(context,item.field,item.occ),doc,ns);
    savePackageDates(context);zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));
    const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
    await writeFile(context.targetDir,context.letterName,new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
    $('#nlpdfLetterEditorStatus').textContent='Letter created successfully. Editable values remain highlighted for checking.';setStatus('Ready · Letter created');toast('Letter created · highlights kept.');
    await new Promise(resolve=>setTimeout(resolve,650));closeLetterEditor();
  }catch(err){console.error(err);$('#nlpdfLetterEditorStatus').textContent=err?.message||'Could not create letter.';toast(err?.message||'Could not create letter.');}
  finally{state.busy=false;$('#nlpdfCreateEditedLetter').disabled=false;updateControls();}
}
async function confirmExport(){
  if(state.busy)return;
  const name=safePath($('#nlpdfExportName').value),num=safePath($('#nlpdfExportNumber').value),outputs=selectedOutputs();
  if(!outputs.any){toast('Select Folder, PDF, or Letter.');return;}
  if(state.editLetterRequested&&!outputs.letter){syncExportPreview();return;}
  if((outputs.pdf||outputs.letter)&&!name){toast('Enter the student name.');$('#nlpdfExportName').focus();return;}
  if(outputs.folder&&!num){toast('Enter the student number.');$('#nlpdfExportNumber').focus();return;}
  if(!state.destinationHandle){const ok=await chooseDestination();if(!ok)return;}
  state.busy=true;$('#nlpdfConfirmExport').disabled=true;
  exportProgress('Creating in progress…','Preparing selected outputs.',0,outputs.pdf?state.pages.length:0);
  setStatus('Creating package…');updateControls();await allowExportProgressToPaint();
  let handoff=null;
  try{
    let targetDir=state.destinationHandle;
    if(outputs.folder){
      exportProgress('Creating in progress…','Creating student folder.',0,outputs.pdf?state.pages.length:0);
      targetDir=await state.destinationHandle.getDirectoryHandle(num+' '+name,{create:true});
    }
    if(outputs.pdf){
      const bytes=await buildPdf((phase,done,total)=>exportProgress('Creating in progress…',phase,done,total));
      let pdfName=safeFile($('#nlpdfExportPdfName').value||('Documents_'+name+'.pdf'));if(!/\.pdf$/i.test(pdfName))pdfName+='.pdf';
      exportProgress('Creating in progress…','Writing PDF…',state.pages.length,state.pages.length);
      await writeFile(targetDir,pdfName,new Blob([bytes],{type:'application/pdf'}));
    }
    if(outputs.letter){
      const letterName='Letter_'+name+'.docx',type=$('#nlpdfExportLetterType').value;
      if(state.editLetterRequested)handoff={num,name,type,letterName,targetDir};
      else{
        exportProgress('Creating in progress…','Writing letter…',outputs.pdf?state.pages.length:0,outputs.pdf?state.pages.length:0);
        await writeFile(targetDir,letterName,new Blob([letterBytes(type)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
      }
    }
    if(handoff){
      hideExportProgress();closeExport();state.busy=false;updateControls();
      await prepareLetterEditor(handoff);
      return;
    }
    exportProgress('Successfully created','Selected outputs are fully saved.',outputs.pdf?state.pages.length:0,outputs.pdf?state.pages.length:0,'success');
    setStatus('Ready · Export complete');toast('Package created.');
    await new Promise(resolve=>setTimeout(resolve,850));closeExport();
  }catch(err){
    console.error(err);exportProgress('Could not create package',err?.message||'The export did not complete.',0,0,'error');setStatus('Export failed');toast(err?.message||'Could not create output.');await new Promise(resolve=>setTimeout(resolve,1500));
  }finally{
    if(!handoff){hideExportProgress();state.busy=false;$('#nlpdfConfirmExport').disabled=false;updateControls();syncExportPreview();}
  }
}

/* Movable floating tool panels */
function setupToolRail(){
  const flyout=$('#nlpdfToolFlyout'),content=$('#nlpdfToolFlyoutContent');
  const map={space:$('#nlpdfSpacePanel')};
  const safe=$('#nlpdfSafePanel');
  if(safe){$('#nlpdfToolbarSafe').appendChild(safe);safe.classList.remove('hidden');}
  for(const panel of Object.values(map)){if(panel){content.appendChild(panel);panel.classList.add('hidden');}}
  function close(){
    state.toolOpen='';
    flyout.classList.add('hidden');
    for(const panel of Object.values(map))panel?.classList.add('hidden');
    Array.from(document.querySelectorAll('#nlpdfToolRail [data-tool]')).forEach(b=>b.classList.toggle('active',b.dataset.tool==='crop'&&state.cropMode));
  }
  function open(key){
    if(key==='rotate')return;
    if(key==='crop'){
      if(!activePage()||state.busy)return;
      close();
      if(!state.cropMode)startCrop();
      Array.from(document.querySelectorAll('#nlpdfToolRail [data-tool]')).forEach(b=>b.classList.toggle('active',b.dataset.tool==='crop'));
      return;
    }
    if(state.toolOpen===key){close();return;}
    state.toolOpen=key;
    flyout.classList.remove('hidden');
    $('#nlpdfToolFlyoutTitle').textContent='Make Space';
    for(const [id,panel] of Object.entries(map))panel?.classList.toggle('hidden',id!==key);
    Array.from(document.querySelectorAll('#nlpdfToolRail [data-tool]')).forEach(b=>b.classList.toggle('active',b.dataset.tool===key));
  }
  Array.from(document.querySelectorAll('#nlpdfToolRail [data-tool]')).forEach(b=>b.addEventListener('click',()=>open(b.dataset.tool)));
  $('#nlpdfToolFlyoutClose').addEventListener('click',close);
  window.addEventListener('pointerdown',e=>{
    if(state.toolOpen&&!e.target.closest('#nlpdfToolRail,#nlpdfToolFlyout'))close();
  });
  state.closeToolFlyout=close;
  state.openToolFlyout=open;
}
function updateTransformOverlay(L){
  const wrap=$('#nlpdfTransformLayer');
  if(!wrap)return;
  const p=activePage();
  if(!p||state.cropMode||!L){wrap.classList.add('hidden');state.contentBounds=null;return;}
  state.contentBounds={...L,pageId:p.id};
  wrap.classList.remove('hidden');
  // Keep the resize grips inside the paper even when content has been dragged beyond A4.
  // The document itself may extend beyond the clipped A4; the grips must remain accessible.
  const inset=10;
  const left=clamp(L.x,inset,840-inset-22);
  const top=clamp(L.y,inset,1188-inset-22);
  const right=clamp(L.x+L.w,left+22,840-inset);
  const bottom=clamp(L.y+L.h,top+22,1188-inset);
  wrap.style.left=(left/840*100)+'%';
  wrap.style.top=(top/1188*100)+'%';
  wrap.style.width=((right-left)/840*100)+'%';
  wrap.style.height=((bottom-top)/1188*100)+'%';
}
function setupResizeDrag(){
  const layer=$('#nlpdfTransformLayer'),paper=$('#nlpdfPaper');
  let gesture=null;
  layer.addEventListener('pointerdown',e=>{
    const grip=e.target.closest('[data-resize]');
    const p=activePage(),L=state.contentBounds;
    if(!grip||!p||!L||state.cropMode||e.button!==0)return;
    const r=paper.getBoundingClientRect();
    gesture={
      grip:grip.dataset.resize,x:e.clientX,y:e.clientY,
      scale:p.transform.scale,
      width:Math.max(15,L.w/840*r.width),height:Math.max(15,L.h/1188*r.height)
    };
    grip.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
  });
  layer.addEventListener('pointermove',e=>{
    if(!gesture)return;
    const p=activePage();if(!p)return;
    const {grip,x,y,scale,width,height}=gesture;
    const sx=grip.includes('e')?1:-1,sy=grip.includes('s')?1:-1;
    const fx=1+sx*(e.clientX-x)/width,fy=1+sy*(e.clientY-y)/height;
    const multiplier=Math.max(.1,(fx+fy)/2);
    p.transform.scale=clamp(scale*multiplier,.3,2);
    renderActive();
  });
  const finish=()=>{
    if(!gesture)return;gesture=null;
    recordEdit();renderFilmstrip();
    if(state.viewMode==='grid')renderGrid();
  };
  layer.addEventListener('pointerup',finish);layer.addEventListener('pointercancel',finish);
}
function showSnapGuides(x,y){
  $('#nlpdfSnapX')?.classList.toggle('hidden',!x);
  $('#nlpdfSnapY')?.classList.toggle('hidden',!y);
}

/* Events */
function setupDrop(el){
  ['dragenter','dragover'].forEach(t=>el.addEventListener(t,e=>{e.preventDefault();el.classList.add('dragover');e.dataTransfer.dropEffect='copy';}));
  ['dragleave','drop'].forEach(t=>el.addEventListener(t,e=>{e.preventDefault();if(t==='drop')el.classList.remove('dragover');else if(!el.contains(e.relatedTarget))el.classList.remove('dragover');}));
  el.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
}
function setupPageContainer(el){
  const lastTap={id:'',at:0};
  el.addEventListener('click',e=>{
    const dismiss=e.target.closest('[data-duplicate-dismiss]');if(dismiss){e.preventDefault();e.stopPropagation();dismissDuplicate(dismiss.dataset.duplicateDismiss);return;}
    const card=e.target.closest('[data-page-id]');if(!card)return;
    const id=card.dataset.pageId,now=Date.now();
    const doubleTap=(el.id==='nlpdfGrid'&&lastTap.id===id&&now-lastTap.at<550);
    lastTap.id=id;lastTap.at=now;
    selectPage(id,e);
    if(doubleTap)setView('single');
  });
  el.addEventListener('dblclick',e=>{
    const card=e.target.closest('[data-page-id]');
    if(card&&state.viewMode==='grid'){selectPage(card.dataset.pageId,e);setView('single');}
  });
  el.addEventListener('dragstart',e=>{
    const card=e.target.closest('[data-page-id]');if(!card||!e.dataTransfer)return;
    state.dragId=card.dataset.pageId;card.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('application/x-buic-page',state.dragId);
    e.dataTransfer.setData('text/plain',state.dragId);
  });
  el.addEventListener('dragend',e=>{
    e.target.closest('[data-page-id]')?.classList.remove('dragging');
    $$('.drag-target',el).forEach(x=>x.classList.remove('drag-target'));
    state.dragId='';
  });
  el.addEventListener('dragover',e=>{
    const types=[...(e.dataTransfer?.types||[])];
    if(!state.dragId&&!types.includes('application/x-buic-page'))return;
    e.preventDefault();e.stopPropagation();
    if(e.dataTransfer)e.dataTransfer.dropEffect='move';
    $$('.drag-target',el).forEach(x=>x.classList.remove('drag-target'));
    const card=e.target.closest('[data-page-id],[data-stack]');
    if(card)card.classList.add('drag-target');
    if(el.id==='nlpdfFilmstrip'){
      const r=el.getBoundingClientRect();
      if(e.clientY<r.top+45)el.scrollTop-=18;
      else if(e.clientY>r.bottom-45)el.scrollTop+=18;
    }
  });
  el.addEventListener('drop',e=>{
    const dragged=state.dragId||e.dataTransfer?.getData('application/x-buic-page')||e.dataTransfer?.getData('text/plain');
    if(!dragged||!state.pages.some(p=>p.id===dragged))return;
    e.preventDefault();e.stopPropagation();
    const card=e.target.closest('[data-page-id],[data-stack]');
    state.dragId='';
    if(card?.dataset.stack)moveToEdge(card.dataset.stack==='front'?'first':'last',dragged);
    else if(card?.dataset.pageId)reorder(dragged,card.dataset.pageId);
    else moveToEdge('last',dragged);
  });
}
function setupContentDrag(){
  const paper=$('#nlpdfPaper'),canvas=$('#nlpdfCanvas');
  let drag=null;
  canvas.addEventListener('pointerdown',e=>{
    const p=activePage();if(!p||state.cropMode||e.button!==0)return;
    const L=state.contentBounds;
    const beforeCenter=L?{
      x:(L.x+L.w/2)/840*A4.wMM,
      y:(L.y+L.h/2)/1188*A4.hMM
    }:{x:A4.wMM/2,y:A4.hMM/2};
    drag={
      x:e.clientX,y:e.clientY,startX:p.transform.xMM,startY:p.transform.yMM,
      center:beforeCenter,moved:false
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag)return;
    const p=activePage();if(!p)return;
    const r=paper.getBoundingClientRect();
    const dx=(e.clientX-drag.x)/Math.max(1,r.width)*A4.wMM;
    const dy=(e.clientY-drag.y)/Math.max(1,r.height)*A4.hMM;
    let newX=drag.startX+dx,newY=drag.startY+dy;
    const centerX=drag.center.x+dx,centerY=drag.center.y+dy;
    const snapX=Math.abs(centerX-A4.wMM/2)<3;
    const snapY=Math.abs(centerY-A4.hMM/2)<3;
    if(snapX)newX+=A4.wMM/2-centerX;
    if(snapY)newY+=A4.hMM/2-centerY;
    p.transform.xMM=newX;p.transform.yMM=newY;
    drag.moved=true;
    showSnapGuides(snapX,snapY);
    renderActive();
  });
  const finish=()=>{
    if(!drag)return;
    const edited=drag.moved;drag=null;
    showSnapGuides(false,false);
    if(edited){recordEdit();renderFilmstrip();if(state.viewMode==='grid')renderGrid();}
  };
  canvas.addEventListener('pointerup',finish);
  canvas.addEventListener('pointercancel',finish);
}
function setupSignatureDrag(){
  const img=$('#nlpdfSignaturePreview'),paper=$('#nlpdfPaper');let d=null;
  img.addEventListener('pointerdown',e=>{if(img.classList.contains('hidden'))return;d={x:e.clientX,y:e.clientY,sx:state.sig.xPct,sy:state.sig.yPct};img.classList.add('dragging');img.setPointerCapture(e.pointerId);e.stopPropagation();e.preventDefault();});
  img.addEventListener('pointermove',e=>{if(!d)return;const r=paper.getBoundingClientRect();state.sig.xPct=clamp(d.sx+(e.clientX-d.x)/r.width,0,1-state.sig.widthPct);state.sig.yPct=clamp(d.sy+(e.clientY-d.y)/r.height,0,Math.max(0,1-state.sig.widthPct*(A4.wMM/A4.hMM)*state.sigAspect));renderSignature(true);if(activePage()?.makeSpace)renderActive();});
  const end=()=>{if(d){d=null;img.classList.remove('dragging');savePrefs();recordEdit();}};
  img.addEventListener('pointerup',end);img.addEventListener('pointercancel',end);
}
function ignoreDeleteKey(e){const t=e.target;if(!t)return false;if(t.isContentEditable||t.tagName==='TEXTAREA')return true;if(t.tagName==='INPUT')return !['range','checkbox','radio','button','submit'].includes((t.type||'').toLowerCase());return false;}

async function build(){
  const docs=$('#workspaceDocuments'),legacy=docs?.querySelector('.document-workspace-grid');if(!docs||!legacy)return;
  docs.classList.add('nlpdf-primary');if(!$('#newLetterPdfWorkspace'))legacy.insertAdjacentHTML('afterend',workspaceMarkup());
  await ensurePdfLibs();await loadAssets();
  const p=prefs();state.safeArea=Boolean(p.safeArea);state.duplicateDetection=p.duplicateDetection!==false;$('#nlpdfSafeArea').checked=state.safeArea;$('#nlpdfDetectDuplicates').checked=state.duplicateDetection;$('#nlpdfSigScope').value='all';$('#nlpdfSigSize').value=Math.round(state.sig.widthPct*100);$('#nlpdfSigSizeValue').textContent=Math.round(state.sig.widthPct*100)+'%';

  $('#nlpdfAddNewFile').addEventListener('click',()=>$('#nlpdfFileInput').click());
  $('#nlpdfAddFiles').addEventListener('click',()=>$('#nlpdfFileInput').click());$('#nlpdfFileInput').addEventListener('change',e=>{addFiles(e.target.files);e.target.value='';});
  $$('[data-asset-import]').forEach(b=>b.addEventListener('click',()=>{state.pendingAsset=b.dataset.assetImport;const i=$('#nlpdfAssetInput');i.accept=state.pendingAsset==='signature'?'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp':'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp';i.click();}));
  $$('[data-asset-remove]').forEach(b=>b.addEventListener('click',()=>removeAsset(b.dataset.assetRemove).catch(err=>toast(err.message))));
  $('#nlpdfAssetInput').addEventListener('change',async e=>{const f=e.target.files?.[0];try{if(f&&state.pendingAsset)await importAsset(state.pendingAsset,f);}catch(err){console.error(err);toast(err.message||'Could not save asset.');}finally{e.target.value='';state.pendingAsset='';}});
  ['nlpdfUseFront','nlpdfUseBack'].forEach(id=>$('#'+id).addEventListener('change',()=>{savePrefs();renderFilmstrip();renderGrid();recordEdit();}));
  ['nlpdfUseSignature','nlpdfSigScope'].forEach(id=>$('#'+id).addEventListener('change',()=>{if(id==='nlpdfSigScope'&&$('#nlpdfSigScope').value==='page')state.signaturePageId=state.activeId||state.pages[0]?.id||'';savePrefs();renderActive();recordEdit();}));
  $('#nlpdfSigSize').addEventListener('input',e=>{state.sig.widthPct=Number(e.target.value)/100;$('#nlpdfSigSizeValue').textContent=e.target.value+'%';state.sig.xPct=clamp(state.sig.xPct,0,1-state.sig.widthPct);savePrefs();renderSignature(Boolean($('#nlpdfUseSignature')?.checked&&(!activePage()||signatureApplies(activePage()))));if(activePage()?.makeSpace)renderActive();});


  $('#nlpdfRotateRight').addEventListener('click',()=>rotateSelected(90));$('#nlpdfDuplicate').addEventListener('click',duplicateSelected);$('#nlpdfDelete').addEventListener('click',deleteSelected);$('#nlpdfClearAll').addEventListener('click',clearAllDocuments);
  $('#nlpdfApplyCrop').addEventListener('click',applyCrop);
  $('#nlpdfCancelCrop').addEventListener('click',cancelCrop);

  $('#nlpdfContentScale').addEventListener('change',recordEdit);
  $('#nlpdfSigSize').addEventListener('change',recordEdit);
  $('#nlpdfContentScale').addEventListener('input',e=>{
    const pg=activePage();if(!pg||state.cropMode)return;
    pg.transform.scale=Number(e.target.value)/100;
    $('#nlpdfContentScaleValue').textContent=e.target.value+'%';
    renderActive();
  });
  $('#nlpdfCenterContent').addEventListener('click',centerContent);

  $('#nlpdfSafeArea').addEventListener('change',e=>{
    state.safeArea=e.target.checked;savePrefs();renderAll();recordEdit();
  });
  $('#nlpdfDetectDuplicates').addEventListener('change',e=>{
    state.duplicateDetection=e.target.checked;state.duplicateOnly=false;savePrefs();
    if(!state.duplicateDetection){state.duplicateGroups=new Map();state.duplicatePageHashes=new Map();updateDuplicateControls();renderFilmstrip();renderGrid();}
    else scanDuplicates().catch(console.error);
  });
  $('#nlpdfWhichDuplicate').addEventListener('click',toggleDuplicateOnly);
  $('#nlpdfApplySpace').addEventListener('click',()=>applySpace(false));
  $('#nlpdfClearSpace').addEventListener('click',()=>applySpace(true));
  $('#nlpdfZoomOut').addEventListener('click',()=>setZoom(state.zoom-.1));
  $('#nlpdfZoomIn').addEventListener('click',()=>setZoom(state.zoom+.1));
  $('#nlpdfZoomFit').addEventListener('click',()=>setZoom(1));
  setupCropInteraction();setupCropEmptyClickApply();setupToolRail();setupResizeDrag();
  $('#nlpdfUndo').addEventListener('click',()=>undoEdit().catch(console.error));
  $('#nlpdfRedo').addEventListener('click',()=>redoEdit().catch(console.error));

  $('#nlpdfSingleView').addEventListener('click',()=>setView('single'));$('#nlpdfGridView').addEventListener('click',()=>setView('grid'));

  setupDrop($('#nlpdfStage'));setupDrop($('#nlpdfGridStage'));setupPageContainer($('#nlpdfFilmstrip'));setupPageContainer($('#nlpdfGrid'));setupContentDrag();setupSignatureDrag();setupBackgroundZoom();
  if(window.ResizeObserver)new ResizeObserver(()=>fitPaper()).observe($('#nlpdfStage'));
  window.addEventListener('resize',fitPaper);
  document.addEventListener('keydown',e=>{
    const visible=$('#workspaceDocuments');
    if(!visible||visible.classList.contains('hidden')||getComputedStyle(visible).display==='none')return;
    if(ignoreDeleteKey(e))return;
    const cmd=e.ctrlKey||e.metaKey;
    if(cmd&&!e.altKey&&e.key.toLowerCase()==='z'){
      e.preventDefault();(e.shiftKey?redoEdit():undoEdit()).catch(console.error);return;
    }
    if(cmd&&!e.altKey&&e.key.toLowerCase()==='y'){
      e.preventDefault();redoEdit().catch(console.error);return;
    }
    if(e.key==='Escape'){
      if(state.cropMode)cancelCrop();
      else state.closeToolFlyout?.();
      return;
    }
    if(!cmd&&!e.altKey&&!e.shiftKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&state.pages.length&&!state.cropMode&&!$('#nlpdfExportModal').classList.contains('open')){
      const index=state.pages.findIndex(p=>p.id===state.activeId);
      const delta=(e.key==='ArrowLeft'||e.key==='ArrowUp')?-1:1;
      const next=Math.max(0,Math.min(state.pages.length-1,(index<0?0:index)+delta));
      if(next!==index){
        e.preventDefault();
        selectPage(state.pages[next].id);
        requestAnimationFrame(()=>{
          const container=state.viewMode==='grid'?'#nlpdfGrid':'#nlpdfFilmstrip';
          const target=$(container)?.querySelector('[data-page-id="'+CSS.escape(state.pages[next].id)+'"]');
          target?.scrollIntoView({block:'nearest',inline:'nearest'});
        });
      }
      return;
    }
    if((e.key==='Backspace'||e.key==='Delete')&&state.selected.size){
      e.preventDefault();deleteSelected();
    }
  });
  $('#nlpdfCreate').addEventListener('click',openExport);
  $$('[data-nlpdf-close]').forEach(x=>x.addEventListener('click',closeExport));$('#nlpdfChooseDestination').addEventListener('click',chooseDestination);$('#nlpdfConfirmExport').addEventListener('click',confirmExport);
  $('#nlpdfEditLetter').addEventListener('click',requestLetterEdit);
  $('#nlpdfCancelLetterEdit').addEventListener('click',closeLetterEditor);$('#nlpdfCreateEditedLetter').addEventListener('click',createEditedLetter);
  ['nlpdfExportNumber','nlpdfExportName'].forEach(id=>$('#'+id).addEventListener('input',()=>{if(id==='nlpdfExportName')$('#nlpdfExportPdfName').dataset.auto='1';syncExportPreview();}));
  $('#nlpdfExportPdfName').addEventListener('input',e=>{e.target.dataset.auto='0';syncExportPreview();});$$('input[name="nlpdfOutput"]').forEach(x=>x.addEventListener('change',syncExportPreview));

  renderAssets();await updateAssetInfo();await renderAll();updateControls();fitPaper();resetHistory();updateDuplicateControls();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>build().catch(console.error),{once:true});else build().catch(console.error);
})();