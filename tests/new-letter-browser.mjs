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
    window.__studentMemoryRememberCalls=0;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const url=typeof input==='string'?input:input?.url||'';
      if(url==='https://buic-central-hub.vercel.app/api/staff/session'){
        return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      if(url==='https://buic-central-hub.vercel.app/api/staff/students/remember'){
        window.__studentMemoryRememberCalls++;
        return new Response(JSON.stringify({student:{student_id:'QA',full_name:'QA'}}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      return nativeFetch(input,init);
    };
    sessionStorage.setItem('buic-student-memory-staff-token-v1','qa-test-token');
  });
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('[data-workspace="documents"]').click();
  await page.locator('#nlpdfAddFiles').waitFor({state:'visible',timeout:60000});
  await page.waitForTimeout(1500);
  await run('Student DB selection populates reusable New Letter identity without saving',async()=>{
    const rememberBefore=await page.evaluate(()=>window.__studentMemoryRememberCalls||0);
    await page.evaluate(()=>{
      window.dispatchEvent(new CustomEvent('buic-student-memory-selected',{detail:{
        student:{student_id:'1690888888',full_name:'Remembered QA',nationality_en:'Myanmar',nationality_th:'เมียนมา',country_en:'Myanmar',country_th:'เมียนมา',extra_data:{recipientLocation:'Yangon, Myanmar'}},
        passport:{passport_number:'MEM12345'},
        academic:{faculty_en:'BU International',major_en:'Business Administration',extra_data:{semester:'Second',academicYear:'2026'}}
      }}));
    });
    await page.locator('#nlpdfCreate').click();
    assert.equal(await page.locator('#nlpdfExportName').inputValue(),'Remembered QA');
    assert.equal(await page.locator('#nlpdfExportPassport').inputValue(),'MEM12345');
    assert.equal(await page.locator('#nlpdfExportStudentId').inputValue(),'1690888888');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>window.__studentMemoryRememberCalls||0),rememberBefore,'selecting/typing a student must not persist central memory');
    await page.locator('[data-nlpdf-close]').last().click();
  });

  await run('Editor starts without JavaScript runtime errors',async()=>{
    assert.deepEqual(errors,[]);
    assert.equal(await count(),0);
    assert.equal(await visible('#nlpdfCreate'),true);
    assert.equal(await page.locator('#nlpdfCreate').isEnabled(),true,'Create Package should be available even before document pages are imported');
    assert.equal(await page.locator('#nlpdfPackageManagerBtn').isVisible(),false,'Package dates should only appear inside Letter Edit');
    assert.equal(await visible('#nlpdfFilmstripWrap'),true);
  });
  await run('Crop starts immediately while Make Space keeps its flyout',async()=>{
    assert.equal(await page.locator('[data-tool="safe"]').count(),0);
    assert.equal(await page.getByText('Whole workspace accepts drag & drop',{exact:true}).count(),0);
    assert.equal(await page.getByText('Drag page content to move',{exact:true}).count(),0);
    assert.equal(await page.locator('[data-tool="crop"]').isDisabled(),true);
    await page.locator('[data-tool="space"]').click();
    assert.equal(await visible('#nlpdfToolFlyout'),true);
    assert.equal(await visible('#nlpdfSpacePanel'),true);
    await page.locator('#nlpdfToolFlyoutClose').click();
    assert.equal(await visible('#nlpdfToolFlyout'),false);
    assert.equal(await visible('#nlpdfSafePanel'),true);
  });
  await run('Embassy reference uses P.R. China and active Thimphu honorary consulate',async()=>{
    const result=await page.evaluate(()=>{
      const d=window.REFERENCE_SNAPSHOT;
      const h=d.Embassy[0],ix=Object.fromEntries(h.map((v,i)=>[v,i]));
      const rows=d.Embassy.slice(1);
      const china=rows.filter(r=>r[ix['Country / Territory EN']]==='China');
      const thimphu=rows.find(r=>r[0]==='E102');
      return {
        china:china.map(r=>r[ix['Current Display Name EN']]||r[ix['Display Name EN']]),
        thimphu:{
          active:thimphu?.[ix.Active],
          display:thimphu?.[ix['Current Display Name EN']]||thimphu?.[ix['Display Name EN']],
          address:thimphu?.[ix['Current Address EN']]||thimphu?.[ix['Address EN']],
          thai:thimphu?.[ix['Current Official Name TH']]||thimphu?.[ix['Official Name TH']]
        }
      };
    });
    assert(result.china.length>=9);
    assert(result.china.every(v=>/P\.R\. China$/.test(v)),JSON.stringify(result.china));
    assert.equal(result.thimphu.active,'YES');
    assert.equal(result.thimphu.display,'Royal Thai Honorary Consulate General in Thimphu, Bhutan');
    assert.match(result.thimphu.address,/Singye Office Building/);
    assert.equal(result.thimphu.thai,'สถานกงสุลกิตติมศักดิ์ ณ กรุงทิมพู ราชอาณาจักรภูฏาน');
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
  await run('Footer has one Create Package action and header has Add new file',async()=>{
    assert.deepEqual(await page.locator('.nlpdf-footer-actions > button').evaluateAll(nodes=>nodes.map(n=>n.id)),['nlpdfCreate']);
    assert.equal(await page.locator('#nlpdfCreateFolderOnly').count(),0);
    assert.equal(await page.locator('#nlpdfAddNewFile').isVisible(),true);
    assert.match(await text('#nlpdfAddNewFile'),/Add new file/);
    assert.match(await text('#nlpdfCreate'),/Create Package/);
  });
  await run('Add Files imports two images and exact duplicates warn without deleting',async()=>{
    await page.locator('#nlpdfAddFiles').click();
    await page.locator('#nlpdfFileInput').setInputFiles([
      {name:'photo-a.png',mimeType:'image/png',buffer:png},
      {name:'photo-b.png',mimeType:'image/png',buffer:png}
    ]);
    await awaitCount(2);
    assert.equal(await count(),2);
    assert.equal(await visible('#nlpdfTransformLayer'),true);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').count(),2);
    await page.waitForFunction(()=>document.querySelectorAll('#nlpdfFilmstrip .duplicate-warning').length===2,{timeout:15000});
    assert.equal(await page.locator('#nlpdfWhichDuplicate').isVisible(),true);
    await page.locator('#nlpdfWhichDuplicate').click();
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').count(),2);
    await page.locator('#nlpdfFilmstrip .nlpdf-dup-dismiss').first().click();
    await page.waitForFunction(()=>document.querySelectorAll('#nlpdfFilmstrip .duplicate-warning').length===0);
    assert.equal(await count(),2,'duplicate warning must never delete pages');
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
  await run('Crop icon enters crop mode; controls are bottom-center; empty click accepts',async()=>{
    await page.locator('[data-tool="crop"]').click();
    assert.equal(await visible('#nlpdfCropLayer'),true);
    assert.equal(await visible('#nlpdfToolFlyout'),false);
    assert.equal(await visible('#nlpdfApplyCrop'),true);
    assert.equal(await visible('#nlpdfCancelCrop'),true);
    const stage=await page.locator('#nlpdfStage').boundingBox();
    const apply=await page.locator('#nlpdfApplyCrop').boundingBox();
    const cancel=await page.locator('#nlpdfCancelCrop').boundingBox();
    assert(stage&&apply&&cancel);
    assert(apply.x<cancel.x,'Accept crop must be left of Cancel');
    assert(Math.abs((apply.x+cancel.x+cancel.width-stage.x*2-stage.width)/2)<90,'crop controls should be centered');
    assert(cancel.y+cancel.height<=stage.y+stage.height+3&&cancel.y>stage.y+stage.height-90,'crop controls should sit at canvas bottom');
    const grip=page.locator('#nlpdfCropRegion [data-crop-handle="nw"]');
    const r=await grip.boundingBox();assert(r);
    await page.mouse.move(r.x+6,r.y+6);await page.mouse.down();
    await page.mouse.move(r.x+28,r.y+25,{steps:5});await page.mouse.up();
    await page.mouse.click(stage.x+stage.width-12,stage.y+stage.height*.5);
    await page.waitForFunction(()=>document.querySelector('#nlpdfCropLayer')?.classList.contains('hidden'));
    assert.equal(await visible('#nlpdfApplyCrop'),false);
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#nlpdfRedo').isDisabled(),false);
    await page.locator('[data-tool="crop"]').click();
    assert.equal(await visible('#nlpdfCropLayer'),true);
    await page.locator('#nlpdfCancelCrop').click();
    assert.equal(await visible('#nlpdfCropLayer'),false);
  });
  await run('Crop area rotates with the page and reopens in the rotated coordinates',async()=>{
    await page.locator('[data-tool="crop"]').click();
    const grip=page.locator('#nlpdfCropRegion [data-crop-handle="nw"]'),g=await grip.boundingBox();assert(g);
    await page.mouse.move(g.x+5,g.y+5);await page.mouse.down();await page.mouse.move(g.x+45,g.y+31,{steps:6});await page.mouse.up();
    const before=await page.locator('#nlpdfCropRegion').evaluate(el=>{const left=parseFloat(el.style.left),top=parseFloat(el.style.top),width=parseFloat(el.style.width),height=parseFloat(el.style.height);return{left,top,right:100-left-width,bottom:100-top-height};});
    assert(before.left>1&&before.top>1,'test crop must be asymmetric before rotation');
    await page.locator('#nlpdfApplyCrop').click();await page.locator('#nlpdfRotateRight').click();await page.locator('[data-tool="crop"]').click();
    const after=await page.locator('#nlpdfCropRegion').evaluate(el=>{const left=parseFloat(el.style.left),top=parseFloat(el.style.top),width=parseFloat(el.style.width),height=parseFloat(el.style.height);return{left,top,right:100-left-width,bottom:100-top-height};});
    const near=(a,b)=>Math.abs(a-b)<0.25;
    assert(near(after.top,before.left),'90° crop top must come from previous left: '+JSON.stringify({before,after}));
    assert(near(after.right,before.top),'90° crop right must come from previous top: '+JSON.stringify({before,after}));
    assert(near(after.bottom,before.right),'90° crop bottom must come from previous right: '+JSON.stringify({before,after}));
    assert(near(after.left,before.bottom),'90° crop left must come from previous bottom: '+JSON.stringify({before,after}));
    await page.locator('#nlpdfCancelCrop').click();await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');
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
  await run('Clear All removes document pages and linked Content, and Undo restores both',async()=>{
    assert.equal(await count(),5);
    assert.equal(await page.locator('#nlpdfClearAll').isVisible(),true);
    assert.equal(await page.locator('text=Selection').count(),0);
    await page.locator('#nlpdfFilmstrip [data-page-id]').first().click();
    await page.locator('#nlpdfPageContentType').selectOption('passport');
    await page.locator('#nlpdfContentName').fill('Clear All QA');
    await page.locator('#nlpdfContentPassport').fill('CLEAR123');
    await page.locator('#nlpdfContentPassport').press('Tab');
    assert.equal(await page.locator('#nlpdfPageContentType').inputValue(),'passport');
    assert.equal(await page.locator('#nlpdfContentName').inputValue(),'Clear All QA');
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
    assert.equal(await page.locator('#nlpdfPageContentType').inputValue(),'','Content classification must reset after Clear All');
    assert.equal(await page.locator('#nlpdfContentPanel').isVisible(),false,'Content information panel must close after Clear All');
    assert.equal(await page.locator('#nlpdfContentPanelBody').innerHTML(),'','Content form values must be removed after Clear All');
    assert.equal(await page.locator('#nlpdfUseFront').isChecked(),before.front);
    assert.equal(await page.locator('#nlpdfUseBack').isChecked(),before.back);
    assert.equal(await page.locator('#nlpdfUseSignature').isChecked(),before.signature);
    assert.equal(await page.locator('#nlpdfSafeArea').isChecked(),before.safe);
    assert.equal(await page.locator('#nlpdfSigSize').inputValue(),before.sigSize);
    assert.equal(await page.locator('#nlpdfCreate').isDisabled(),false);
    await page.keyboard.press('Control+z');
    await awaitCount(5);
    assert.equal(Number(await text('#nlpdfFileCount')),5);
    assert.equal(await page.locator('#nlpdfPageContentType').inputValue(),'passport','Undo should restore the page Content classification');
    assert.equal(await page.locator('#nlpdfContentName').inputValue(),'Clear All QA','Undo should restore linked Content information');
    assert.equal(await page.locator('#nlpdfContentPassport').inputValue(),'CLEAR123','Undo should restore linked passport information');
  });

  await run('PDF export rotation matches upright editor preview for intrinsically rotated source PDF',async()=>{
    await page.evaluate(async()=>{
      const pdf=await PDFLib.PDFDocument.create();
      const p=pdf.addPage([300,420]);
      p.drawRectangle({x:35,y:315,width:105,height:65,color:PDFLib.rgb(1,0,0)});
      p.drawRectangle({x:160,y:40,width:105,height:65,color:PDFLib.rgb(0,0,1)});
      p.setRotation(PDFLib.degrees(180));
      const bytes=await pdf.save();
      const dt=new DataTransfer();
      dt.items.add(new File([bytes],'intrinsic-180.pdf',{type:'application/pdf'}));
      document.querySelector('#nlpdfStage').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
    });
    await awaitCount(6);
    await page.locator('#nlpdfFilmstrip [data-page-id]').last().click();
    await page.locator('#nlpdfRotateRight').click();
    await page.locator('#nlpdfRotateRight').click();
    await page.waitForTimeout(350);
    const preview=await page.locator('#nlpdfCanvas').evaluate(canvas=>{
      const ctx=canvas.getContext('2d'),d=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let ry=0,rc=0,by=0,bc=0;
      for(let y=0;y<canvas.height;y+=2)for(let x=0;x<canvas.width;x+=2){
        const i=(y*canvas.width+x)*4,r=d[i],g=d[i+1],b=d[i+2];
        if(r>180&&g<100&&b<100){ry+=y;rc++;}
        if(b>180&&r<100&&g<100){by+=y;bc++;}
      }
      return {redY:rc?ry/rc:null,blueY:bc?by/bc:null,rc,bc};
    });
    assert(preview.rc>20&&preview.bc>20&&preview.redY<preview.blueY,JSON.stringify(preview));

    const before=await page.evaluate(()=>window.__mockFiles.length);
    await page.locator('#nlpdfCreate').click();
    await page.locator('#nlpdfExportName').fill('Rotation QA');
    await page.locator('#nlpdfChooseDestination').click();
    await page.locator('#nlpdfConfirmExport').click();
    await page.waitForFunction(()=>document.querySelector('#nlpdfExportProgress')?.dataset.mode==='success',{timeout:60000});
    const exported=await page.evaluate(async before=>{
      const file=window.__mockFiles.slice(before).find(f=>f.name.endsWith('.pdf'));
      if(!file)return null;
      const pdf=await pdfjsLib.getDocument({data:file.bytes.slice()}).promise;
      const pg=await pdf.getPage(pdf.numPages-1); // final document page; no default back yet at this point
      const vp=pg.getViewport({scale:1.2});
      const canvas=document.createElement('canvas');canvas.width=Math.round(vp.width);canvas.height=Math.round(vp.height);
      await pg.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:vp}).promise;
      const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let ry=0,rc=0,by=0,bc=0;
      for(let y=0;y<canvas.height;y+=2)for(let x=0;x<canvas.width;x+=2){
        const i=(y*canvas.width+x)*4,r=d[i],g=d[i+1],b=d[i+2];
        if(r>180&&g<100&&b<100){ry+=y;rc++;}
        if(b>180&&r<100&&g<100){by+=y;bc++;}
      }
      return {redY:rc?ry/rc:null,blueY:bc?by/bc:null,rc,bc,pages:pdf.numPages};
    },before);
    assert(exported&&exported.rc>20&&exported.bc>20&&exported.redY<exported.blueY,JSON.stringify(exported));
    await page.waitForTimeout(1000);
    await page.locator('#nlpdfFilmstrip [data-page-id]').last().click();
    await page.keyboard.press('Backspace');
    await awaitCount(5);
  });

  await run('Navigation out of New Letter and back preserves editor operation',async()=>{
    await page.locator('[data-workspace="reference"]').click();
    await page.locator('[data-workspace="documents"]').click();
    await page.locator('#nlpdfCreate').waitFor({state:'visible'});
    assert.equal(await count(),5);
    await page.locator('#nlpdfSingleView').click();
    assert.equal(await visible('#nlpdfStage'),true);
  });

  await run('Letter selection uses Create 1/2 then Document Type Create 2/2',async()=>{
    await page.locator('#nlpdfCreate').click();
    assert.equal(await page.locator('input[name="nlpdfOutput"]').count(),3);
    assert.equal(await page.locator('#nlpdfEditLetter').count(),0);
    assert.equal((await page.locator('#nlpdfConfirmExport').innerText()).trim(),'Create 1/2');
    await page.locator('input[name="nlpdfOutput"][value="pdf"]').uncheck();
    await page.locator('input[name="nlpdfOutput"][value="folder"]').uncheck();
    await page.locator('input[name="nlpdfOutput"][value="letter"]').check();
    await page.locator('#nlpdfChooseDestination').click();
    const before=await page.evaluate(()=>window.__mockFiles.length);
    await page.evaluate(()=>{const t=document.querySelector('#toast');if(t){t.textContent='';t.classList.remove('show');}});
    await page.locator('#nlpdfConfirmExport').click();
    await page.locator('#nlpdfLetterTypeModal').waitFor({state:'visible',timeout:12000});
    assert.equal(await page.evaluate(before=>window.__mockFiles.length===before,before),true,'Create 1/2 must not write a Word letter before document type is chosen');
    assert.equal((await page.locator('#toast').innerText()).includes('Create 1/2 complete'),false,'Letter-only must not imply an output was already created');
    assert.equal((await page.locator('#nlpdfConfirmLetterType').innerText()).trim(),'Create 2/2');
    await page.locator('#nlpdfExportLetterType').selectOption('exchange');
    await page.locator('#nlpdfConfirmLetterType').click();
    await page.locator('#nlpdfLetterEditor').waitFor({state:'visible',timeout:20000});
    assert.match(await page.locator('#nlpdfLetterStudentType').innerText(),/Exchange Bachelor/);
    await page.locator('#nlpdfLetterStudentType').click();
    await page.locator('#nlpdfLetterTypeModal').waitFor({state:'visible'});
    assert.equal(await page.evaluate(before=>window.__mockFiles.length===before,before),true,'changing document type must not recreate folder/PDF/letter');
    await page.locator('[data-nlpdf-letter-type-close]').last().click();
  });

  await run('Page Content is clickable, expandable, searchable, and shares linked document data',async()=>{
    await page.locator('#nlpdfFilmstrip [data-page-id]').first().click();
    await page.locator('#nlpdfPageContentType').click();
    await page.locator('#nlpdfPageContentType').selectOption('passport');
    assert.equal(await page.locator('#nlpdfPageContentType').inputValue(),'passport');
    assert.equal(await page.locator('#nlpdfContentPanel').isVisible(),true);
    await page.locator('#nlpdfContentName').fill('Content Linked Name');
    await page.locator('#nlpdfContentPassport').fill('PP998877');
    await page.locator('#nlpdfContentLocation').fill('Goes, Netherlands');
    await page.locator('#nlpdfContentNationality').click();
    await page.locator('#nlpdfReferencePicker').waitFor({state:'visible'});
    await page.locator('#nlpdfReferencePickerSearch').fill('Netherlands');
    const countryResult=page.locator('#nlpdfReferencePickerResults [data-reference-result]').first();
    assert.equal(await countryResult.count()>0,true,'country search should return a result');
    await countryResult.click();
    assert.match(await page.locator('#nlpdfContentNationality').innerText(),/Netherlands/i);
    await page.locator('#nlpdfContentPanelToggle').click();
    assert.equal(await page.locator('#nlpdfContentPanel').getAttribute('class').then(v=>v.includes('collapsed')),true);
    await page.locator('#nlpdfContentPanelToggle').click();

    await page.locator('#nlpdfPageContentType').selectOption('bu_application');
    assert.equal(await page.locator('#nlpdfContentName').inputValue(),'Content Linked Name');
    await page.locator('#nlpdfContentStudentId').fill('1666');
    const facultyValue=await page.locator('#nlpdfContentFaculty option').evaluateAll(opts=>opts.find(o=>o.value)?.value||'');
    if(facultyValue){
      await page.locator('#nlpdfContentFaculty').selectOption(facultyValue);
      const programValue=await page.locator('#nlpdfContentProgram option').evaluateAll(opts=>opts.find(o=>o.value)?.value||'');
      if(programValue)await page.locator('#nlpdfContentProgram').selectOption(programValue);
    }
    await page.locator('#nlpdfContentSemester').selectOption('Second');
    await page.locator('#nlpdfContentAcademicYear').selectOption('2026');

    await page.locator('#nlpdfPageContentType').selectOption('visa_application');
    assert.equal(await page.locator('#nlpdfContentName').inputValue(),'Content Linked Name');
    await page.locator('#nlpdfContentEmbassy').click();
    await page.locator('#nlpdfReferencePickerSearch').fill('Yangon');
    const embassyResult=page.locator('#nlpdfReferencePickerResults [data-reference-result]').first();
    if(await embassyResult.count())await embassyResult.click();
  });

  await run('Content selector and metadata panel stay pinned while the A4 stage scrolls',async()=>{
    await page.locator('#nlpdfPageContentType').selectOption('passport');
    await page.locator('#nlpdfZoomFit').click();
    for(let i=0;i<8;i++)await page.locator('#nlpdfZoomIn').click();
    const stage=page.locator('#nlpdfStage');
    const beforeSelector=await page.locator('.nlpdf-page-content-float').boundingBox();
    const beforePanel=await page.locator('#nlpdfContentPanel').boundingBox();
    assert(beforeSelector&&beforePanel);
    const scrolled=await stage.evaluate(el=>{
      el.scrollTop=Math.min(180,Math.max(0,el.scrollHeight-el.clientHeight));
      el.scrollLeft=Math.min(90,Math.max(0,el.scrollWidth-el.clientWidth));
      el.dispatchEvent(new Event('scroll'));
      return {top:el.scrollTop,left:el.scrollLeft};
    });
    assert(scrolled.top>0||scrolled.left>0,'zoomed A4 stage should be scrollable');
    await page.waitForTimeout(80);
    const afterSelector=await page.locator('.nlpdf-page-content-float').boundingBox();
    const afterPanel=await page.locator('#nlpdfContentPanel').boundingBox();
    assert(afterSelector&&afterPanel);
    assert(Math.abs(afterSelector.y-beforeSelector.y)<2,'Content selector should remain pinned vertically');
    assert(Math.abs(afterSelector.x-beforeSelector.x)<2,'Content selector should remain pinned horizontally');
    assert(Math.abs(afterPanel.y-beforePanel.y)<2,'Content panel should remain pinned vertically');
    assert(Math.abs(afterPanel.x-beforePanel.x)<2,'Content panel should remain pinned horizontally');
    await stage.evaluate(el=>{el.scrollTop=0;el.scrollLeft=0;el.dispatchEvent(new Event('scroll'));});
    await page.locator('#nlpdfZoomFit').click();
  });

  await run('Edit Letter uses topic pages, linked Content previews, reusable dates, school memory, and Embassy search',async()=>{
    const before=await page.evaluate(()=>window.__mockFiles.length);
    for(const [index,type] of [[0,'passport'],[1,'receipt'],[2,'bu_application'],[3,'visa_application']]){
      await page.locator('#nlpdfFilmstrip [data-page-id]').nth(index).click();await page.locator('#nlpdfPageContentType').selectOption(type);
    }
    await page.locator('#nlpdfCreate').click();
    await page.locator('#nlpdfExportNumber').fill('0789');await page.locator('#nlpdfExportName').fill('Linked Name');await page.locator('#nlpdfExportPassport').fill('AB1234567');await page.locator('#nlpdfExportStudentId').fill('1690000000');
    await page.locator('input[name="nlpdfOutput"][value="pdf"]').uncheck();await page.locator('input[name="nlpdfOutput"][value="folder"]').uncheck();await page.locator('input[name="nlpdfOutput"][value="letter"]').check();
    await page.locator('#nlpdfChooseDestination').click();await page.locator('#nlpdfConfirmExport').click();await page.locator('#nlpdfLetterTypeModal').waitFor({state:'visible',timeout:12000});
    await page.locator('#nlpdfExportLetterType').selectOption('exchange');await page.locator('#nlpdfConfirmLetterType').click();await page.locator('#nlpdfLetterEditor').waitFor({state:'visible',timeout:20000});
    assert.equal(await page.locator('#nlpdfLetterStepStudent').isVisible(),true);assert.match(await page.locator('#nlpdfLetterContentLabel').innerText(),/Passport/);
    assert.equal(await page.locator('#nlpdfLetterMagnifierWidth').inputValue(),'300');assert.equal(await page.locator('#nlpdfLetterMagnifierHeight').inputValue(),'200');assert.equal(await page.locator('#nlpdfLetterMagnifierZoom').inputValue(),'2');
    await page.locator('#nlpdfLetterContentCanvas').hover({position:{x:180,y:220}});await page.locator('#nlpdfLetterMagnifier').waitFor({state:'visible'});let lens=await page.locator('#nlpdfLetterMagnifier').boundingBox();assert(lens&&Math.abs(lens.width-304)<2&&Math.abs(lens.height-204)<2,'first-use magnifier should be 300×200 plus its border');assert.equal(await page.locator('#nlpdfLetterMagnifier').getAttribute('data-zoom'),'2');
    await page.locator('#nlpdfLetterMagnifierWidth').fill('80');await page.locator('#nlpdfLetterMagnifierHeight').fill('60');await page.locator('#nlpdfLetterMagnifierZoom').fill('4');await page.locator('#nlpdfLetterContentCanvas').hover({position:{x:220,y:260}});lens=await page.locator('#nlpdfLetterMagnifier').boundingBox();assert(lens&&Math.abs(lens.width-84)<2&&Math.abs(lens.height-64)<2,'edited magnifier size should apply on hover');assert.equal(await page.locator('#nlpdfLetterMagnifier').getAttribute('data-zoom'),'4');const savedMagnifier=await page.evaluate(()=>JSON.parse(localStorage.getItem('buic-letter-magnifier-v1')||'null'));assert.deepEqual(savedMagnifier,{width:80,height:60,zoom:4},'edited magnifier values should persist for future visits');
    assert.equal(await page.locator('#nlpdfLetterName').inputValue(),'Linked Name');assert.equal(await page.locator('#nlpdfLetterPassport').inputValue(),'AB1234567');assert.equal(await page.locator('#nlpdfLetterStudentId').inputValue(),'1690000000');assert.equal(await page.locator('#nlpdfLetterDocumentNo').inputValue(),'0789');
    await page.locator('#nlpdfLetterCountry').click();await page.locator('#nlpdfReferencePicker').waitFor({state:'visible'});await page.locator('#nlpdfReferencePickerSearch').fill('Myanmar');const myanmarNationality=page.locator('#nlpdfReferencePickerResults [data-reference-result]').filter({hasText:/Myanmar/i}).first();assert.equal(await myanmarNationality.count()>0,true,'Myanmar country should be selectable');await myanmarNationality.click();
    await page.locator('#nlpdfLetterNext').click();assert.equal(await page.locator('#nlpdfLetterStepAcademic').isVisible(),true);assert.match(await page.locator('#nlpdfLetterContentLabel').innerText(),/Receipt/);assert.equal((await page.locator('#nlpdfLetterContentCounter').innerText()).trim(),'1 / 2');
    await page.locator('#nlpdfLetterContentNext').click();assert.match(await page.locator('#nlpdfLetterContentLabel').innerText(),/BU Application/);
    assert.equal(await page.locator('#nlpdfPackageManagerBtn').isVisible(),true);assert.equal(await page.locator('#nlpdfSchoolManagerBtn').isVisible(),true);
    await page.locator('#nlpdfPackageManagerBtn').click();await page.locator('#nlpdfPackageManager').waitFor({state:'visible'});await page.locator('#nlpdfPkgType').selectOption('exchange');await page.locator('#nlpdfPkgSemester').selectOption('Second');await page.locator('#nlpdfPkgYear').selectOption('2026');await page.locator('#nlpdfPkgStart').fill('2027-01-11');await page.locator('#nlpdfPkgFinish').fill('2027-05-31');await page.locator('#nlpdfPkgOrientationStart').fill('2027-01-04');await page.locator('#nlpdfPkgOrientationEnd').fill('2027-01-08');await page.locator('#nlpdfPkgSave').click();await page.locator('[data-package-close]').last().click();
    await page.locator('#nlpdfLetterSemester').selectOption('Second');await page.locator('#nlpdfLetterAcademicYear').selectOption('2026');assert.equal(await page.locator('#nlpdfLetterStartDate').inputValue(),'2027-01-11');assert.equal(await page.locator('#nlpdfLetterFinishDate').inputValue(),'2027-05-31');await page.locator('#nlpdfLetterFinishDate').fill('2027-06-15');await page.locator('#nlpdfLetterOrientationEnd').fill('2027-01-09');
    await page.locator('#nlpdfSchoolManagerBtn').click();await page.locator('#nlpdfSchoolManager').waitFor({state:'visible'});await page.locator('#nlpdfSchoolName').fill('QA Home University');
    const schoolCountry=await page.locator('#nlpdfSchoolCountry option').evaluateAll(opts=>{const hit=opts.find(o=>/Myanmar/i.test(o.textContent||'')&&o.value);return hit?.value||opts.find(o=>o.value)?.value||'';});if(schoolCountry){await page.locator('#nlpdfSchoolCountry').selectOption(schoolCountry);await page.locator('#nlpdfSchoolSave').click();}await page.locator('[data-school-close]').last().click();
    if(await page.locator('#nlpdfLetterHomeSchoolSection').isVisible()){await page.locator('#nlpdfLetterHomeSchool').fill('QA Home University');await page.locator('#nlpdfLetterHomeSchool').press('Tab');}
    await page.locator('[data-letter-step="2"]').click();assert.match(await page.locator('#nlpdfLetterContentLabel').innerText(),/Visa Application/);await page.locator('#nlpdfLetterEmbassySearch').fill('Taipei');await page.locator('#nlpdfLetterEmbassyResults').waitFor({state:'visible'});const result=page.locator('#nlpdfLetterEmbassyResults [data-embassy-result]').filter({hasText:/Taipei/i}).first();assert.equal(await result.count()>0,true,'Taiwan Trade Office should be searchable');assert.match(await result.innerText(),/Thailand Trade and Economic Office in Taipei, Taiwan \(ROC\)/);await result.click();
    assert.equal(await page.locator('#nlpdfLetterEmbassyAddress').getAttribute('readonly'),null);await page.locator('#nlpdfLetterEmbassyAddress').fill('Custom Embassy Address\nSecond Line');
    await page.locator('[data-letter-step="3"]').click();assert.match(await page.locator('#nlpdfLetterReview').innerText(),/Linked Name/);await page.locator('#nlpdfLetterNext').click();assert.equal(await page.locator('#nlpdfLetterStepFinal').isVisible(),true);assert.equal(await page.locator('#nlpdfLetterFinalDocumentNo').inputValue(),'0789');assert.equal(await page.locator('#nlpdfLetterFinalStudentId').inputValue(),'1690000000');await page.locator('#nlpdfLetterFinalDate').fill('2026-10-08');
    const memoryBeforeCreate=await page.evaluate(()=>window.__studentMemoryRememberCalls||0);
    await page.locator('#nlpdfCreateEditedLetter').click();await page.locator('#nlpdfLetterEditor').waitFor({state:'hidden',timeout:20000});
    assert((await page.evaluate(()=>window.__studentMemoryRememberCalls||0))>memoryBeforeCreate,'final Create Letter must persist shared student memory');
    const out=await page.evaluate(async before=>{const file=window.__mockFiles.slice(before).find(f=>f.name==='Letter_Linked Name_AB1234567_1690000000.docx');if(!file)return null;const zip=await JSZip.loadAsync(file.bytes),xml=await zip.file('word/document.xml').async('string'),doc=new DOMParser().parseFromString(xml,'application/xml'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';const paras=[...doc.getElementsByTagNameNS(ns,'p')].map(p=>[...p.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent||'').join(''));const plain=paras.join('\n');return{finished:file.finished,highlight:/<w:highlight\b[^>]*(?:w:val|val)="yellow"/i.test(xml),name:(xml.match(/Linked Name/g)||[]).length,passport:(xml.match(/AB1234567/g)||[]).length,englishDate:xml.includes('October 8, 2026'),thaiDate:xml.includes('8 ตุลาคม 2569'),studyPeriod:xml.includes('January 11, 2027 to June 15, 2027'),editedOrientation:xml.includes('January 4 - 9, 2027'),customAddress:xml.includes('Custom Embassy Address'),englishSchoolCountry:plain.includes('QA Home University, Myanmar'),thaiSchoolComma:/QA Home University\s*,\s*[\u0E00-\u0E7F]/.test(plain),schoolLines:paras.filter(p=>p.includes('QA Home University')),taiwanMission:plain.includes('Thailand Trade and Economic Office in Taipei, Taiwan (ROC)'),oldTaipeiName:plain.includes('Thailand Trade and Economic Office (Taipei)'),directorCount:paras.filter(p=>p.trim()==='Dear The Director').length,staleConsul:paras.some(p=>/^(?:The Consul|Dear Consul\b)/i.test(p.trim())),thaiDirector:plain.includes('เรียน ผู้อำนวยการใหญ่'),myanmarCitizen:/\bMyanmar\s+Citizen\b/.test(plain),oldMyanmarNationality:plain.includes('Myanmar / Burmese Citizen')};},before);
    assert(out&&out.finished);assert.equal(out.highlight,true);assert(out.name>=1);assert(out.passport>=1);assert.equal(out.englishDate,true);assert.equal(out.thaiDate,true);assert.equal(out.studyPeriod,true);assert.equal(out.editedOrientation,true);assert.equal(out.customAddress,true,'manual Embassy address must be used in final Word output');assert.equal(out.taiwanMission,true,'Taiwan mission must use the full Taipei, Taiwan (ROC) wording');assert.equal(out.oldTaipeiName,false,'old Taiwan mission name must not remain');assert.equal(out.directorCount,1,'Taiwan must contain one Dear The Director addressee');assert.equal(out.staleConsul,false,'Taiwan must not retain The Consul or Dear Consul');assert.equal(out.thaiDirector,true,'Taiwan Thai addressee must be เรียน ผู้อำนวยการใหญ่');assert.equal(out.myanmarCitizen,true,'English nationality should be Myanmar Citizen');assert.equal(out.oldMyanmarNationality,false,'Myanmar / Burmese must not appear as the English nationality');assert.equal(out.englishSchoolCountry,true,'Exchange English school must be followed by comma then country; school lines: '+JSON.stringify(out.schoolLines));assert.equal(out.thaiSchoolComma,false,'Exchange Thai school must not have comma after the school name; school lines: '+JSON.stringify(out.schoolLines));
  });

  await run('Bachelor No IEN maps Xian source data, linked package dates, and Thai addressee exactly',async()=>{
    const before=await page.evaluate(()=>window.__mockFiles.length);
    await page.evaluate(()=>{
      const profiles=JSON.parse(localStorage.getItem('buic-letter-package-dates-v1')||'{}');
      profiles['bachelor_no_ien|second|2026']={type:'bachelor_no_ien',semester:'Second',year:'2026',startDate:'2027-01-11',finishDate:'2030-05-31',orientationStart:'2027-01-04',orientationEnd:'2027-01-08'};
      localStorage.setItem('buic-letter-package-dates-v1',JSON.stringify(profiles));
      localStorage.setItem('buic-letter-last-academic-year-v1','2026');
    });
    await page.locator('#nlpdfCreate').click();
    await page.locator('#nlpdfExportNumber').fill('4766');
    await page.locator('#nlpdfExportName').fill('Thai QA');
    await page.locator('#nlpdfExportPassport').fill('QA998877');
    await page.locator('#nlpdfExportStudentId').fill('1690111111');
    await page.locator('input[name="nlpdfOutput"][value="pdf"]').uncheck();
    await page.locator('input[name="nlpdfOutput"][value="folder"]').uncheck();
    await page.locator('input[name="nlpdfOutput"][value="letter"]').check();
    await page.locator('#nlpdfChooseDestination').click();
    await page.locator('#nlpdfConfirmExport').click();
    await page.locator('#nlpdfLetterTypeModal').waitFor({state:'visible',timeout:12000});
    await page.locator('#nlpdfExportLetterType').selectOption('bachelor_no_ien');
    await page.locator('#nlpdfConfirmLetterType').click();
    await page.locator('#nlpdfLetterEditor').waitFor({state:'visible',timeout:20000});
    await page.locator('[data-letter-step="1"]').click();
    await page.locator('#nlpdfLetterSemester').selectOption('Second');
    await page.locator('#nlpdfLetterAcademicYear').selectOption('2026');
    assert.equal(await page.locator('#nlpdfLetterFinishDate').inputValue(),'2030-05-31');
    await page.locator('[data-letter-step="0"]').click();await page.locator('#nlpdfLetterLocation').fill('QA Student Location');
    await page.locator('[data-letter-step="2"]').click();await page.locator('#nlpdfLetterEmbassySearch').fill('Xian');
    await page.locator('#nlpdfLetterEmbassyResults').waitFor({state:'visible'});
    const xian=page.locator('#nlpdfLetterEmbassyResults [data-embassy-result]').filter({hasText:/Xian/i}).first();
    assert.equal(await xian.count()>0,true,'Xian mission should be searchable');
    await xian.click();
    await page.locator('[data-letter-step="4"]').click();await page.locator('#nlpdfCreateEditedLetter').click();
    await page.locator('#nlpdfLetterEditor').waitFor({state:'hidden',timeout:20000});
    const out=await page.evaluate(async before=>{
      const file=window.__mockFiles.slice(before).find(f=>f.name==='Letter_Thai QA_QA998877_1690111111.docx');
      if(!file)return null;
      const zip=await JSZip.loadAsync(file.bytes);
      const xml=await zip.file('word/document.xml').async('string');
      const doc=new DOMParser().parseFromString(xml,'application/xml');
      const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const rawParas=[...doc.getElementsByTagNameNS(ns,'p')].map(p=>[...p.getElementsByTagNameNS(ns,'t')].map(n=>n.textContent||'').join('').trim());
      const paras=rawParas.filter(Boolean),plain=paras.join('\n');
      return {finished:file.finished,plain,paras,rawParas};
    },before);
    assert(out&&out.finished,'Bachelor No IEN letter should be written');
    assert(out.plain.includes('QA Student Location'),'Student location must replace the line under To:');
    const consul=out.rawParas.findIndex(x=>x==='The Consul');
    assert(consul>=0,'The Consul block should exist');
    const block=out.rawParas.slice(consul+1,consul+6);
    assert.equal(block[0],'Royal Thai Consulate-General in Xian','address block must use Office Name, not Display Name with country suffix');
    assert.equal(block[1],'Room 104, 1st Floor, Building A');
    assert.equal(block[2],'China Railway First International');
    assert.equal(block[3],'No. 9 Yanta North Road, Beilin District');
    assert.equal(block[4],'Xian City, Shaanxi 710000, P.R. China','full final address row must not be truncated');
    assert.equal(out.rawParas[consul+6],'','exactly one blank paragraph must separate the Embassy address from Dear Consul');
    assert.match(out.rawParas[consul+7]||'',/^Dear Consul/,'Dear Consul must follow the single blank paragraph after the Embassy address');
    assert.equal(block.filter(x=>x==='Royal Thai Consulate-General in Xian').length,1,'office name must appear once in the address block');
    assert.equal(block.some(x=>x==='Royal Thai Consulate-General in Xian, P.R. China'),false,'Display Name must not be used as the postal address heading');
    assert.equal(out.plain.includes('P.R. CHINA'),false,'China casing must remain P.R. China');
    assert.equal(out.plain.includes('P.R. China, Myanmar'),false,'stale template country must not remain');
    assert(out.plain.includes('เรียน กงสุล ประจำสถานกงสุลใหญ่ ณ นครซีอาน สาธารณรัฐประชาชนจีน'),'Thai addressee must exactly use the selected Xian Thai mission wording; actual Thai mission lines: '+JSON.stringify(out.rawParas.filter(x=>/(?:เรียน|กงสุล|สถานเอกอัครราชทูต|สถานกงสุล)/.test(x))));
    assert.equal(out.plain.includes('สถานเอกอัครราชทูต ณ กรุงย่างกุ้ง'),false,'old Yangon Thai mission must not remain');
    assert.equal(out.plain.includes('December 31, 2030'),false,'old finishing date must not remain on another page; actual 2030 lines: '+JSON.stringify(out.rawParas.filter(x=>/2030/.test(x))));
    assert((out.plain.match(/May 31, 2030/g)||[]).length>=2,'all linked finishing-date occurrences must use May 31, 2030');
    assert.equal(out.plain.includes('สาขาวิชาสาขาวิชา'),false,'Thai major label must not duplicate');
    assert.match(out.plain,/มหาวิทยาลัยได้รับ\s*Thai QA\s*สัญชาติ/,'Thai student-detail paragraph must remain intact');
    assert.match(out.plain,/หนังสือเดินทางหมายเลข\s*QA998877/,'Thai passport value must remain in the paragraph');
  });


  await run('Export modal shows processing, then success only after write completes',async()=>{
    const before=await page.evaluate(()=>window.__mockFiles.length);
    await page.locator('#nlpdfCreate').click();
    assert.equal(await visible('#nlpdfExportModal'),true);
    await page.locator('input[name="nlpdfOutput"][value="folder"]').uncheck();
    await page.locator('input[name="nlpdfOutput"][value="pdf"]').check();
    await page.locator('input[name="nlpdfOutput"][value="letter"]').uncheck();
    await page.locator('#nlpdfExportName').fill('Test Student');
    await page.locator('#nlpdfChooseDestination').click();
    await page.locator('#nlpdfConfirmExport').click();
    await page.locator('#nlpdfExportProgress').waitFor({state:'visible',timeout:12000});
    assert.match(await text('#nlpdfProgressTitle'),/Creating in progress/);
    const during=await page.evaluate(before=>window.__mockFiles.slice(before).every(f=>!f.finished),before);
    assert.equal(during,true,'must not claim success before writes close');
    await page.waitForFunction(()=>document.querySelector('#nlpdfExportProgress')?.dataset.mode==='success',{timeout:60000});
    const after=await page.evaluate(before=>window.__mockFiles.slice(before).map(f=>({name:f.name,done:f.finished,size:f.bytes?.length||0})),before);
    assert(after.some(f=>f.name.endsWith('.pdf')&&f.done&&f.size>100),'export must save PDF bytes');
    assert.equal(after.every(f=>f.done),true);
    await page.waitForTimeout(1000);
    assert.equal(await visible('#nlpdfExportModal'),false);
  });

  await run('Package export creates folder/PDF once, then letter after Step 2',async()=>{
    const before=await page.evaluate(()=>window.__mockFiles.length);
    await page.locator('#nlpdfCreate').click();
    await page.locator('#nlpdfExportName').fill('QA Student');
    await page.locator('#nlpdfExportPassport').fill('QA1234567');
    await page.locator('#nlpdfExportStudentId').fill('1690999999');
    assert.equal(await page.locator('#nlpdfExportPdfName').inputValue(),'Documents_QA Student_QA1234567_1690999999.pdf');
    await page.locator('#nlpdfExportNumber').fill('9012');
    await page.locator('input[name="nlpdfOutput"][value="folder"]').check();
    await page.locator('input[name="nlpdfOutput"][value="letter"]').check();
    assert.match(await text('#nlpdfFinalFolder'),/9012 QA Student_QA1234567_1690999999/);
    assert.match(await text('#nlpdfFinalLetter'),/Letter_QA Student_QA1234567_1690999999\.docx/);
    await page.locator('#nlpdfConfirmExport').click();
    await page.locator('#nlpdfLetterTypeModal').waitFor({state:'visible',timeout:60000});
    const afterStep1=await page.evaluate(async before=>{
      const data=window.__mockFiles.slice(before),pdf=data.find(f=>f.name.endsWith('.pdf'));
      return {count:data.length,files:data.map(f=>({name:f.name,finished:f.finished,length:f.bytes?.length||0})),pageCount:pdf?await PDFLib.PDFDocument.load(pdf.bytes).then(d=>d.getPageCount()):null};
    },before);
    assert(afterStep1.files.find(x=>x.name==='Documents_QA Student_QA1234567_1690999999.pdf'&&x.finished&&x.length>100));
    assert.equal(afterStep1.files.some(x=>x.name.endsWith('.docx')),false,'Word letter must wait for Step 2/editor');
    assert.equal(afterStep1.pageCount,7,'5 document pages + 1 front + 1 back');
    await page.locator('#nlpdfExportLetterType').selectOption('exchange');
    await page.locator('#nlpdfConfirmLetterType').click();
    await page.locator('#nlpdfLetterEditor').waitFor({state:'visible',timeout:20000});
    await page.locator('#nlpdfLetterStudentType').click();
    await page.locator('#nlpdfLetterTypeModal').waitFor({state:'visible'});
    assert.equal(await page.evaluate(({before,count})=>window.__mockFiles.slice(before).length===count,{before,count:afterStep1.count}),true,'returning to document type must not recreate Step 1 outputs');
    await page.locator('#nlpdfExportLetterType').selectOption('bachelor_no_ien');
    await page.locator('#nlpdfConfirmLetterType').click();
    await page.locator('#nlpdfLetterEditor').waitFor({state:'visible',timeout:20000});
    await page.locator('[data-letter-step="2"]').click();await page.locator('#nlpdfLetterEmbassySearch').fill('Moscow');
    await page.locator('#nlpdfLetterEmbassyResults').waitFor({state:'visible'});
    const moscow=page.locator('#nlpdfLetterEmbassyResults [data-embassy-result]').filter({hasText:/Moscow/i}).first();
    assert.equal(await moscow.count()>0,true,'Moscow embassy should be searchable');
    assert.match(await moscow.innerText(),/Russia/);
    assert.doesNotMatch(await moscow.innerText(),/Russian Federation/);
    await moscow.click();
    await page.locator('[data-letter-step="4"]').click();await page.locator('#nlpdfCreateEditedLetter').click();
    await page.locator('#nlpdfLetterEditor').waitFor({state:'hidden',timeout:20000});
    const out=await page.evaluate(async before=>{
      const data=window.__mockFiles.slice(before),file=data.find(f=>f.name==='Letter_QA Student_QA1234567_1690999999.docx');
      if(!file)return {files:data.map(f=>({name:f.name,finished:f.finished,length:f.bytes?.length||0})),plain:''};
      const zip=await JSZip.loadAsync(file.bytes),xml=await zip.file('word/document.xml').async('string'),doc=new DOMParser().parseFromString(xml,'application/xml'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const plain=[...doc.getElementsByTagNameNS(ns,'p')].map(p=>[...p.getElementsByTagNameNS(ns,'t')].map(n=>n.textContent||'').join('')).join('\n');
      return {files:data.map(f=>({name:f.name,finished:f.finished,length:f.bytes?.length||0})),plain};
    },before);
    assert(out.files.find(x=>x.name==='Letter_QA Student_QA1234567_1690999999.docx'&&x.finished&&x.length>100));
    assert(out.plain.includes('Royal Thai Embassy in Moscow, Russia'),'generated letter should use Russia');
    assert.equal(out.plain.includes('Royal Thai Embassy in Moscow, Russian Federation'),false,'generated letter must not use Russian Federation');
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
