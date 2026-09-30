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
  await run('Floating Crop/Safe Area/Make Space buttons respond',async()=>{
    for(const id of ['crop','safe','space']){
      await page.locator('[data-tool="'+id+'"]').click();
      assert.equal(await visible('#nlpdfToolFlyout'),true,id);
      assert.equal(await visible('#nlpdf'+(id==='crop'?'CropPanel':id==='safe'?'SafePanel':'SpacePanel')),true,id);
    }
    await page.locator('#nlpdfToolFlyoutClose').click();
    assert.equal(await visible('#nlpdfToolFlyout'),false);
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
    await page.evaluate(()=>{
      window.__resizeEvents=[];
      for(const type of ['pointerdown','pointermove','pointerup']){
        document.addEventListener(type,e=>{
          if(window.__resizeEvents.length>35)return;
          window.__resizeEvents.push({
            type,
            target:e.target?.getAttribute?.('data-resize')||e.target?.id||e.target?.tagName,
            x:Math.round(e.clientX),y:Math.round(e.clientY)
          });
        },true);
      }
    });
    const original=Number(await page.locator('#nlpdfContentScale').inputValue());
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
    await page.mouse.move(a.x+a.width/2+25,a.y+a.height/2+26,{steps:7});await page.mouse.up();
    const after=Number(await page.locator('#nlpdfContentScale').inputValue());
    if(after===original){
      console.log('RESIZE DEBUG',JSON.stringify(await page.evaluate(()=>{
        const el=document.querySelector('[data-resize="se"]');
        const root=document.querySelector('#nlpdfTransformLayer');
        const b=el.getBoundingClientRect();
        return {
          events:window.__resizeEvents,
          originalElement:el.outerHTML,
          hitAtHandle:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML?.slice(0,220),
          rootDisplay:getComputedStyle(root).display,
          rootPointerEvents:getComputedStyle(root).pointerEvents,
          handlePointerEvents:getComputedStyle(el).pointerEvents,
          currentScale:document.querySelector('#nlpdfContentScale')?.value
        };
      })));
    }
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
    await page.locator('[data-tool="safe"]').click();
    await page.locator('#nlpdfSafeArea').check();
    assert.equal(await visible('#nlpdfSafeGuide'),true);
    await page.locator('#nlpdfToolFlyoutClose').click();
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
    await page.locator('#nlpdfGrid [data-page-id]').nth(1).click();
    await page.locator('#nlpdfSingleView').click();
    assert.equal(await visible('#nlpdfStage'),true);
    assert.equal(await page.locator('#nlpdfFilmstrip [data-page-id]').count(),3);
  });
  await run('Selected page reorder can be undone',async()=>{
    const first=await page.locator('#nlpdfFilmstrip [data-page-id]').first().getAttribute('data-page-id');
    await page.locator('#nlpdfFilmstrip [data-page-id]').first().click();
    await page.locator('#nlpdfMoveLast').click();
    const last=await page.locator('#nlpdfFilmstrip [data-page-id]').last().getAttribute('data-page-id');
    assert.equal(first,last);
    await page.keyboard.press('Control+z');
    const restored=await page.locator('#nlpdfFilmstrip [data-page-id]').first().getAttribute('data-page-id');
    assert.equal(restored,first);
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
