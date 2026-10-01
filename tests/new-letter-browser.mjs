import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('test-results',{recursive:true});
const tests=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+bCrkAAAAASUVORK5CYII=','base64');
let browser,page;
const run=async(name,fn)=>{try{await fn();tests.push({name,result:'PASS'});console.log('PASS '+name);}catch(err){tests.push({name,result:'FAIL',message:String(err.stack||err)});console.error('FAIL '+name+' '+(err.stack||err));throw err;}};
const text=async selector=>page.locator(selector).innerText();
const count=async()=>Number(await text('#nlpdfPageCount'));
const visible=async selector=>page.locator(selector).isVisible();
const awaitCount=async n=>page.waitForFunction(n=>Number(document.querySelector('#nlpdfPageCount')?.textContent||-1)===n,n,{timeout:15000});
const asset=async(which,fileName)=>{
  await page.locator('[data-asset-import="'+which+'"]').click();
  await page.locator('#nlpdfAssetInput').setInputFiles({name:fileName,mimeType:'image/png',buffer:png});
  await page.waitForFunction(which=>{
    const target=document.querySelector('#nlpdfAssetName_'+which);
    return Boolean(target&&target.textContent&&!target.textContent.includes('Not set'));
  },which);
};
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')console.error('BROWSER CONSOLE:',e.text().slice(0,800));});
  await page.addInitScript(()=>{
    window.__mockFiles=[];
    window.__mockDirectory={
      name:'QA destination',
      async getFileHandle(name,{create}={}) {
        if(!create)throw new DOMException('Not found','NotFoundError');
        const record={name,bytes:undefined,started:false,finished:false};
        window.__mockFiles.push(record);
        return { async createWritable(){return {
          async write(data){
            record.started=true;
            await new Promise(r=>setTimeout(r,800));
            record.bytes=new Uint8Array(await data.arrayBuffer());
          },
          async close(){
            await new Promise(r=>setTimeout(r,400));
            record.finished=true;
          }
        };}};
      },
      async getDirectoryHandle(name,{create}={}){
        if(!create)throw new DOMException('Not found','NotFoundError');
        return {...window.__mockDirectory,name};
      }
    };
    window.showDirectoryPicker=async()=>window.__mockDirectory;
  });
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('[data-workspace="documents"]').click();
  await page.locator('#nlpdfAddFiles').waitFor({state:'visible',timeout:60000});
  await page.waitForTimeout(1500);
  await run('Editor starts without JavaScript runtime errors',async()=>{
    assert.deepEqual(errors,[]);
    assert.equal(await count(),0);
    assert.equal(await visible('#nlpdfCreate'),true);
    assert.equal(await visible('#nlpdfFilmstripWrap'),true);
  });
  await run('Crop and Make Space work without duplicate Safe Area dock button',async()=>{
    assert.equal(await page.locator('[data-tool="safe"]').count(),0);
    for(const id of ['crop','space']){
      await page.locator('[data-tool="'+id+'"]').click();
      assert.equal(await visible('#nlpdfToolFlyout'),true,id);
      assert.equal(await visible('#nlpdf'+(id==='crop'?'CropPanel':'SpacePanel')),true,id);
    }
    await page.locator('#nlpdfToolFlyoutClose').click();
    assert.equal(await visible('#nlpdfToolFlyout'),false);
    assert.equal(await visible('#nlpdfSafePanel'),true);
  });
  await run('Only four website themes; first-visit default persists',async()=>{
    const choices=await page.locator('[data-theme-choice]').evaluateAll(nodes=>nodes.map(n=>n.dataset.themeChoice));
    assert.deepEqual(choices,['light','dark','graphite','red-blue']);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'red-blue');
    await page.locator('#themeToggle').click();
    await page.locator('[data-theme-choice="graphite"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'graphite');
    await page.locator('#themeToggle').click();
    await page.locator('[data-theme-choice="red-blue"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'red-blue');
  });
  await run('Page ordering controls are absent and floating plus is available',async()=>{
    assert.equal(await page.locator('#nlpdfMoveFirst,#nlpdfMoveUp,#nlpdfMoveDown,#nlpdfMoveLast').count(),0);
    assert.equal(await page.locator('#nlpdfAddFiles').isVisible(),true);
    assert.equal(await page.locator('#nlpdfResetSignature,#nlpdfResetTransform,#nlpdfResetCrop').count(),0);
  });
  await run('Signature scope and Position row are gone; signatures default to all pages',async()=>{
    assert.equal(await page.locator('#nlpdfSigScope').isVisible(),false);
    assert.equal(await page.locator('#nlpdfSigScope').inputValue(),'all');
    assert.equal(await page.locator('#nlpdfSigHint').count(),0);
    assert.equal(await page.locator('#nlpdfSigSize').isVisible(),true);
    assert.equal(await page.locator('.nlpdf-signature-controls .nlpdf-field').count(),0);
  });
  await run('Create Folder and Create PDF are adjacent in the fixed footer',async()=>{
    assert.deepEqual(await page.locator('.nlpdf-footer-actions > button').evaluateAll(nodes=>nodes.map(n=>n.id)),['nlpdfCreateFolderOnly','nlpdfCreate']);
    assert.equal(await page.locator('.nlpdf-side-head #nlpdfCreateFolderOnly').count(),0);
    const folder=await page.locator('#nlpdfCreateFolderOnly').boundingBox();
    const pdf=await page.locator('#nlpdfCreate').boundingBox();
    const footer=await page.locator('.nlpdf-footer').boundingBox();
    assert(folder&&pdf&&footer);
    assert(pdf.x>folder.x+folder.width-3);
    assert(folder.y>=footer.y-2&&pdf.y>=footer.y-2);
    assert(folder.y+folder.height<=footer.y+footer.height+2);
    assert(pdf.y+pdf.height<=footer.y+footer.height+2);
  });
  await run('Footer Create Folder opens the existing folder setup',async()=>{
    await page.locator('#nlpdfCreateFolderOnly').click();
    assert.equal(await page.locator('#letterModal').getAttribute('aria-hidden'),'false');
    await page.locator('#letterModal button[data-close-letter]').first().click();
    assert.equal(await page.locator('#letterModal').getAttribute('aria-hidden'),'true');
  });
  await run('Add Files button imports two images and updates page count',async()=>{
    await page.locator('#nlpdfAddFiles').click();
    await page.locator('#nlpdfFileInput').setInputFiles([
      {name:'photo-a.png',mimeType:'image/png',buffer:png},
      {name:'photo-b.png',mimeType:'image/png',buffer:png}
    ]);
    await awaitCount(2);
    assert.equal(await count(),2);
    assert.equal(await visible('#nlpdfTransformLayer'),true);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').count(),2);
  });
  await run('Whole A4 stage drag-and-drop imports an additional file',async()=>{
    await page.evaluate(async encoded=>{
      const data=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      const dt=new DataTransfer();
      dt.items.add(new File([data],'dropped-photo.png',{type:'image/png'}));
      const target=document.querySelector('#nlpdfStage');
      for(const type of ['dragenter','dragover','drop']){
        target.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));
      }
    },png.toString('base64'));
    await awaitCount(3);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').count(),3);
  });
  await run('Rotate and Ctrl+Z/Ctrl+Y work without missing controls',async()=>{
    await page.locator('#nlpdfRotateRight').click();
    const canvas=page.locator('#nlpdfCanvas');
    assert.equal(await canvas.isVisible(),true);
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#nlpdfRedo').isDisabled(),false);
    await page.keyboard.press('Control+y');
    assert.equal(await page.locator('#nlpdfUndo').isDisabled(),false);
  });
  await run('Page content can be dragged and resized with handles',async()=>{
    const canvas=page.locator('#nlpdfCanvas');
    const r=await canvas.boundingBox();assert(r);
    await page.mouse.move(r.x+r.width*.48,r.y+r.height*.45);
    await page.mouse.down();await page.mouse.move(r.x+r.width*.53,r.y+r.height*.47,{steps:5});await page.mouse.up();
    const se=page.locator('[data-resize="se"]');
    assert.equal(await se.isVisible(),true);
    const a=await se.boundingBox();assert(a);
    const original=Number(await page.locator('#nlpdfContentScale').inputValue());
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
    await page.mouse.move(a.x+a.width/2+25,a.y+a.height/2+26,{steps:7});await page.mouse.up();
    const after=Number(await page.locator('#nlpdfContentScale').inputValue());
    assert(after!==original,'resize handle should alter page scale');
    await page.keyboard.press('Control+z');
    assert.equal(Number(await page.locator('#nlpdfContentScale').inputValue()),original);
  });
  await run('Crop keeps its current rotation, Apply and Undo work',async()=>{
    await page.locator('[data-tool="crop"]').click();
    await page.locator('#nlpdfStartCrop').click();
    assert.equal(await visible('#nlpdfCropLayer'),true);
    assert.equal(await visible('#nlpdfApplyCrop'),true);
    const grip=page.locator('#nlpdfCropRegion [data-crop-handle="nw"]');
    const r=await grip.boundingBox();assert(r);
    await page.mouse.move(r.x+6,r.y+6);await page.mouse.down();
    await page.mouse.move(r.x+28,r.y+25,{steps:5});await page.mouse.up();
    await page.locator('#nlpdfApplyCrop').click();
    assert.equal(await visible('#nlpdfCropLayer'),false);
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#nlpdfRedo').isDisabled(),false);
  });
  await run('Safe Area toggle and Make Space respond',async()=>{
    await page.locator('#nlpdfSafeArea').check();
    assert.equal(await visible('#nlpdfSafeGuide'),true);
    const bar=await page.locator('.nlpdf-toolbar').boundingBox();
    const safe=await page.locator('#nlpdfSafePanel').boundingBox();
    assert(bar&&safe&&safe.y>=bar.y-2&&safe.y+safe.height<=bar.y+bar.height+2,'Safe Area must appear in top toolbar');
    await asset('signature','signature-qa.png');
    assert.equal(await page.locator('#nlpdfUseSignature').isChecked(),true);
    await page.locator('[data-tool="space"]').click();
    await page.locator('#nlpdfApplySpace').click();
    await page.locator('#nlpdfClearSpace').click();
    assert.equal(await page.locator('#nlpdfUseSignature').isChecked(),true);
  });
  await run('Default Front and Back render as stacks, signature remains separate',async()=>{
    await page.locator('#nlpdfToolFlyoutClose').click();
    await asset('front','front-default.png');
    await asset('back','back-default.png');
    await page.waitForFunction(()=>document.querySelectorAll('#nlpdfFilmstrip [data-stack]').length===2);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-stack]').count(),2);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').count(),3);
  });
  await run('Single and Grid views both allow selecting documents',async()=>{
    await page.locator('#nlpdfGridView').click();
    assert.equal(await visible('#nlpdfGridStage'),true);
    assert.equal(await page.locator('#nlpdfGrid [data-page-id]').count(),3);
    await page.locator('#nlpdfGrid [data-page-id]').nth(1).dblclick();
    assert.equal(await visible('#nlpdfStage'),true);
    assert.equal(await page.locator('#nlpdfSingleView').getAttribute('class')?.then(c=>c.includes('active')),true);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').count(),3);
  });
  await run('Arrow keys move between pages without reordering',async()=>{
    await page.locator('#nlpdfFilmstrip [data-page-id]').first().click();
    const first=await page.locator('#nlpdfFilmstrip [data-page-id]').first().getAttribute('data-page-id');
    const second=await page.locator('#nlpdfFilmstrip [data-page-id]').nth(1).getAttribute('data-page-id');
    await page.keyboard.press('ArrowRight');
    assert.match(await text('#nlpdfSelectionLabel'),/active page 2/);
    await page.keyboard.press('ArrowLeft');
    assert.match(await text('#nlpdfSelectionLabel'),/active page 1/);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').first().getAttribute('data-page-id'),first);
    assert.notEqual(first,second);
  });

  await run('Right-side preview rail can reorder by dragging and undo',async()=>{
    const first=await page.locator('#nlpdfFilmstrip [data-page-id]').first().getAttribute('data-page-id');
    const last=await page.locator('#nlpdfFilmstrip [data-page-id]').last().getAttribute('data-page-id');
    assert.notEqual(first,last);
    await page.waitForTimeout(250);
    await page.locator('#nlpdfFilmstrip').evaluate(el=>el.scrollTop=0);
    await page.locator('#nlpdfFilmstrip [data-page-id]').first().click();
    await page.locator('#nlpdfFilmstrip [data-page-id]').first().dragTo(page.locator('#nlpdfFilmstrip [data-page-id]').nth(1));
    await page.waitForTimeout(180);
    const after=await page.locator('#nlpdfFilmstrip [data-page-id]').first().getAttribute('data-page-id');
    assert.notEqual(after,first,'dragging should reorder the page rail');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').first().getAttribute('data-page-id'),first);
  });
  await run('ZIP import extracts supported images and ignores other files',async()=>{
    const {execFileSync}=await import('node:child_process');
    const z=`import zipfile,base64,os
with zipfile.ZipFile('test-results/synthetic-attachments.zip','w') as z:
 z.writestr('evidence/image.png',base64.b64decode(os.environ['PNG_B64']))
 z.writestr('ignore-me.txt','not a document')`;
    execFileSync('python3',['-c',z],{env:{...process.env,PNG_B64:png.toString('base64')}});
    await page.locator('#nlpdfFileInput').setInputFiles('test-results/synthetic-attachments.zip');
    await awaitCount(4);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').count(),4);
  });
  await run('Real PDF import keeps page count and editable preview',async()=>{
    await page.evaluate(async()=>{
      const pdf=await PDFLib.PDFDocument.create();
      const p=pdf.addPage([595.28,841.89]);
      p.drawText('Synthetic PDF import regression test',{x:80,y:700,size:22});
      const bytes=await pdf.save();
      const dt=new DataTransfer();
      dt.items.add(new File([bytes],'synthetic.pdf',{type:'application/pdf'}));
      document.querySelector('#nlpdfStage').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
    });
    await awaitCount(5);
    await page.locator('#nlpdfFilmstrip [data-page-id]').last().click();
    await page.waitForTimeout(250);
    assert.equal(await visible('#nlpdfCanvas'),true);
  });
  await run('Multi-select, Backspace deletion and Undo restore selected pages',async()=>{
    await page.locator('#nlpdfFilmstrip [data-page-id]').first().click();
    await page.locator('#nlpdfFilmstrip [data-page-id]').nth(2).click({modifiers:['Shift']});
    assert.match(await text('#nlpdfSelectionLabel'),/3 selected/);
    await page.keyboard.press('Backspace');
    await awaitCount(2);
    await page.keyboard.press('Control+z');
    await awaitCount(5);
  });
  await run('A4-only zoom, fixed footer and right rail remain visible in short windows',async()=>{
    const before=await page.locator('#nlpdfPaper').evaluate(el=>el.getBoundingClientRect().width);
    await page.locator('#nlpdfZoomIn').click();
    const after=await page.locator('#nlpdfPaper').evaluate(el=>el.getBoundingClientRect().width);
    assert(after>before);
    await page.locator('#nlpdfZoomFit').click();
    await page.setViewportSize({width:1440,height:630});
    await page.waitForTimeout(250);
    const bounds=await page.evaluate(()=>{
      const selectors=['#nlpdfFooter','#nlpdfFilmstripWrap','#nlpdfCreate'];
      const f=document.querySelector('.nlpdf-footer').getBoundingClientRect();
      const rail=document.querySelector('#nlpdfFilmstripWrap').getBoundingClientRect();
      const canvas=document.querySelector('#nlpdfStage').getBoundingClientRect();
      return {f:{top:f.top,bottom:f.bottom},rail:{top:rail.top,bottom:rail.bottom},canvas:{top:canvas.top,bottom:canvas.bottom},h:window.innerHeight};
    });
    assert(bounds.f.bottom<=bounds.h+2&&bounds.f.top>=0,'footer stays within viewport');
    assert(bounds.rail.bottom<=bounds.f.top+2,'page rail stops above footer');
    assert(bounds.canvas.bottom<=bounds.f.top+2,'canvas stops above footer');
    await page.setViewportSize({width:1440,height:900});
  });
  await run('Mirrored empty-stage horizontal drags zoom and unzoom paper',async()=>{
    await page.locator('#nlpdfSingleView').click();
    await page.locator('#nlpdfZoomFit').click();
    const leftBefore=await page.locator('#nlpdfPaper').evaluate(el=>el.getBoundingClientRect().width);
    const paper=await page.locator('#nlpdfPaper').boundingBox();const stage=await page.locator('#nlpdfStage').boundingBox();
    assert(paper&&stage);
    const y=paper.y+paper.height*.5;
    const xLeft=Math.max(stage.x+18,paper.x-26);
    await page.mouse.move(xLeft,y);await page.mouse.down();await page.mouse.move(xLeft-95,y,{steps:7});await page.mouse.up();
    const leftAfter=await page.locator('#nlpdfPaper').evaluate(el=>el.getBoundingClientRect().width);
    assert(leftAfter>leftBefore,'left-side drag left must zoom in');
    await page.locator('#nlpdfZoomFit').click();
    const restored=await page.locator('#nlpdfPaper').boundingBox();assert(restored);
    const xRight=Math.min(stage.x+stage.width-18,restored.x+restored.width+25);
    await page.mouse.move(xRight,y);await page.mouse.down();await page.mouse.move(xRight+90,y,{steps:7});await page.mouse.up();
    const rightAfter=await page.locator('#nlpdfPaper').evaluate(el=>el.getBoundingClientRect().width);
    assert(rightAfter>leftBefore,'right-side drag right must zoom in');
    await page.locator('#nlpdfZoomFit').click();
  });
  await run('Default asset enable/disable can be undone',async()=>{
    const front=page.locator('#nlpdfUseFront');
    assert.equal(await front.isChecked(),true);
    await front.uncheck();
    assert.equal(await front.isChecked(),false);
    await page.keyboard.press('Control+z');
    assert.equal(await front.isChecked(),true);
  });
  await run('Clear All removes only imported document pages and Undo restores them',async()=>{
    assert.equal(await count(),5);
    assert.equal(await page.locator('#nlpdfClearAll').isVisible(),true);
    assert.equal(await page.locator('text=Selection').count(),0);
    const before={
      front:await page.locator('#nlpdfUseFront').isChecked(),
      back:await page.locator('#nlpdfUseBack').isChecked(),
      signature:await page.locator('#nlpdfUseSignature').isChecked(),
      safe:await page.locator('#nlpdfSafeArea').isChecked(),
      sigSize:await page.locator('#nlpdfSigSize').inputValue()
    };
    await page.locator('#nlpdfClearAll').click();
    await awaitCount(0);
    assert.equal(Number(await text('#nlpdfFileCount')),0);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').count(),0);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-stack]').count(),2);
    assert.equal(await page.locator('#nlpdfUseFront').isChecked(),before.front);
    assert.equal(await page.locator('#nlpdfUseBack').isChecked(),before.back);
    assert.equal(await page.locator('#nlpdfUseSignature').isChecked(),before.signature);
    assert.equal(await page.locator('#nlpdfSafeArea').isChecked(),before.safe);
    assert.equal(await page.locator('#nlpdfSigSize').inputValue(),before.sigSize);
    assert.equal(await page.locator('#nlpdfCreate').isDisabled(),true);
    await page.keyboard.press('Control+z');
    await awaitCount(5);
    assert.equal(Number(await text('#nlpdfFileCount')),5);
  });

  await run('Navigation out of New Letter and back preserves editor operation',async()=>{
    await page.locator('[data-workspace="reference"]').click();
    await page.locator('[data-workspace="documents"]').click();
    await page.locator('#nlpdfCreate').waitFor({state:'visible'});
    assert.equal(await count(),5);
    await page.locator('#nlpdfSingleView').click();
    assert.equal(await visible('#nlpdfStage'),true);
  });

  await run('Export modal shows processing, then success only after write completes',async()=>{
    await page.locator('#nlpdfCreate').click();
    assert.equal(await visible('#nlpdfExportModal'),true);
    await page.locator('#nlpdfExportName').fill('Test Student');
    await page.locator('#nlpdfChooseDestination').click();
    await page.locator('#nlpdfConfirmExport').click();
    await page.locator('#nlpdfExportProgress').waitFor({state:'visible',timeout:12000});
    assert.match(await text('#nlpdfProgressTitle'),/Creating in progress/);
    const during=await page.evaluate(()=>window.__mockFiles.every(f=>!f.finished));
    assert.equal(during,true,'must not claim success before writes close');
    await page.waitForFunction(()=>document.querySelector('#nlpdfExportProgress')?.dataset.mode==='success',{timeout:60000});
    const after=await page.evaluate(()=>window.__mockFiles.map(f=>({name:f.name,done:f.finished,size:f.bytes?.length||0})));
    assert(after.some(f=>f.name.endsWith('.pdf')&&f.done&&f.size>100),'export must save PDF bytes');
    assert.equal(after.every(f=>f.done),true);
    await page.waitForTimeout(1000);
    assert.equal(await visible('#nlpdfExportModal'),false);
  });

  await run('Package export creates folder and Word/PDF with correct page count',async()=>{
    const before=await page.evaluate(()=>window.__mockFiles.length);
    await page.locator('#nlpdfCreate').click();
    await page.locator('#nlpdfExportName').fill('QA Student');
    await page.locator('#nlpdfExportNumber').fill('9012');
    await page.locator('input[name="nlpdfOutputMode"][value="package"]').check();
    assert.match(await text('#nlpdfFinalFolder'),/9012 QA Student/);
    assert.match(await text('#nlpdfFinalLetter'),/Letter_QA Student\.docx/);
    await page.locator('#nlpdfConfirmExport').click();
    await page.waitForFunction(()=>document.querySelector('#nlpdfExportProgress')?.dataset.mode==='success',{timeout:60000});
    const out=await page.evaluate(async before=>{
      const data=window.__mockFiles.slice(before);
      const pdf=data.find(f=>f.name.endsWith('.pdf'));
      return {
        files:data.map(f=>({name:f.name,finished:f.finished,length:f.bytes?.length||0})),
        pageCount:pdf?await PDFLib.PDFDocument.load(pdf.bytes).then(d=>d.getPageCount()):null
      };
    },before);
    assert(out.files.find(x=>x.name==='Letter_QA Student.docx'&&x.finished&&x.length>100));
    assert(out.files.find(x=>x.name==='Documents_QA Student.pdf'&&x.finished&&x.length>100));
    assert.equal(out.pageCount,7,'5 document pages + 1 front + 1 back');
    await page.waitForTimeout(1000);
    assert.equal(await visible('#nlpdfExportModal'),false);
  });

  await run('Current Letter fills the viewport, exposes reserved topics, and keeps fallback in Settings',async()=>{
    assert.equal((await page.locator('[data-workspace="extend"]').innerText()).trim(),'Current Letter');
    assert.equal((await page.locator('.brand-subtitle').innerText()).includes('Extend Letter'),false);
    await page.locator('[data-workspace="extend"]').click();
    await page.locator('#workspaceExtend').waitFor({state:'visible',timeout:10000});
    const bounds=await page.evaluate(()=>{
      const header=document.querySelector('.topbar').getBoundingClientRect();
      const pane=document.querySelector('#workspaceExtend').getBoundingClientRect();
      const frame=document.querySelector('#workspaceExtend .extend-letter-frame').getBoundingClientRect();
      return {headerBottom:header.bottom,top:pane.top,bottom:pane.bottom,width:pane.width,frameHeight:frame.height,height:innerHeight,viewportWidth:innerWidth};
    });
    assert(bounds.top>=bounds.headerBottom-2&&bounds.top<=bounds.headerBottom+2);
    assert(bounds.bottom<=bounds.height+2&&bounds.bottom>=bounds.height-2);
    assert(bounds.width>=bounds.viewportWidth-2);
    assert(bounds.frameHeight>=bounds.height-bounds.headerBottom-2);
    assert.equal(await page.locator('.extend-letter-fallback').count(),0);
    const visa=page.frameLocator('#workspaceExtend .extend-letter-frame');
    await visa.locator('[data-view="settings"]').waitFor({state:'visible',timeout:30000});
    for(const [key,title] of [['cancel','Cancel'],['graduated','Graduated'],['criminal_record','Criminal Record']]){
      const nav=visa.locator('[data-view="placeholder"][data-placeholder="'+key+'"]');
      await nav.click();
      assert.equal((await visa.locator('#pageTitle').innerText()).trim(),title);
      assert.equal((await visa.locator('#placeholderView').innerText()).trim(),'');
      assert.equal(await visa.locator('#placeholderView').getAttribute('class').then(v=>v.includes('active')),true);
      assert.equal(await visa.locator('#draftsBtn').isVisible(),false);
      assert.equal(await visa.locator('#addStudentBtn').isVisible(),false);
    }
    await visa.locator('[data-view="workspace"][data-case-category="normal"]').click();
    assert.equal(await visa.locator('#addStudentBtn').isVisible(),true);
    await visa.locator('[data-view="settings"]').click();
    await visa.locator('#settingsPanel_general').waitFor({state:'visible',timeout:12000});
    await visa.locator('#embeddedStandaloneSettingsCard').waitFor({state:'visible',timeout:12000});
    const link=visa.locator('#embeddedStandaloneSettingsCard .standalone-settings-link');
    assert.equal(await link.getAttribute('href'),'/new-student-local/');
    assert.equal(await link.getAttribute('target'),'_blank');
    await page.locator('[data-workspace="documents"]').click();
    assert.equal(await page.locator('#nlpdfAddFiles').isVisible(),true);
  });
  await run('No browser runtime errors occurred during editor operations',async()=>{
    assert.deepEqual(errors,[]);
  });
  await page.screenshot({path:'test-results/new-letter-desktop.png',fullPage:true});
  console.log('BROWSER QA:',JSON.stringify(tests));
}catch(err){
  if(page)await page.screenshot({path:'test-results/new-letter-failure.png',fullPage:true}).catch(()=>{});
  console.error('BROWSER QA FAILED:',JSON.stringify(tests,null,2));
  process.exitCode=1;
}finally{if(browser)await browser.close();}
