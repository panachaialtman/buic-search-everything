import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';

await mkdir('test-results',{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+bCrkAAAAASUVORK5CYII=','base64');
const zip=(name,entries)=>({
  name,mimeType:'application/zip',
  buffer:execFileSync('python3',['-c',[
    'import sys,json,zipfile,io,base64',
    'out=io.BytesIO()',
    "with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as archive:",
    ' for name,data in json.load(sys.stdin):',
    '  archive.writestr(name,base64.b64decode(data))',
    'sys.stdout.buffer.write(out.getvalue())'
  ].join('\n')],{input:JSON.stringify(entries.map(([name,bytes])=>[name,Buffer.from(bytes).toString('base64')]))})
});
const pdf=await PDFDocument.create();pdf.addPage().drawText('Synthetic document page 1');pdf.addPage().drawText('Synthetic document page 2');
const pdfBytes=await pdf.save();
const inner=zip('inner.zip',[['not-imported.png',png]]);
const mixed=zip('Student attachments.zip',[
  ['documents/passport.png',png],['documents/receipt.PDF',pdfBytes],
  ['photos/passport.HEIC','synthetic HEIC'],['photos/extra.heif','synthetic HEIF'],
  ['attachments/more.ZIP',inner.buffer],
  ['photos/<img src=x onerror=alert(1)>.heic','synthetic unsafe filename'],
  ['documents/notes.docx','synthetic unsupported document'],
  ['__MACOSX/photos/._passport.HEIC','metadata'],['photos/.DS_Store','metadata'],
  ['photos/._another.HEIC','metadata'],['Thumbs.db','metadata']
]);
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__unexpectedWrites=0;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const url=typeof input==='string'?input:input?.url||'';
      if(url==='https://buic-central-hub.vercel.app/api/staff/session')return new Response(JSON.stringify({ok:true,staff:{id:'qa-zip-import',username:'qa'}}),{status:200,headers:{'Content-Type':'application/json'}});
      if(url.startsWith('https://buic-central-hub.vercel.app/')&&!['GET','HEAD'].includes(String(init.method||input?.method||'GET').toUpperCase())){
        window.__unexpectedWrites++;throw new Error('Unexpected Hub write blocked in isolated test');
      }
      return nativeFetch(input,init);
    };
    sessionStorage.setItem('buic-student-memory-staff-token-v1','qa-test-token');
  });
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#buicWorkspaceAuth').waitFor({state:'hidden',timeout:15000});
  await page.locator('[data-workspace="documents"]').click();
  await page.locator('#nlpdfAddFiles').waitFor({state:'visible',timeout:60000});
  await page.locator('#nlpdfDetectDuplicates').uncheck();
  const count=()=>page.locator('#nlpdfPageCount').innerText();
  const warning=page.getByRole('dialog',{name:'Some files need your attention'});
  const drop=async file=>{
    await page.evaluate(({name,mimeType,base64})=>{
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),transfer=new DataTransfer();
      transfer.items.add(new File([bytes],name,{type:mimeType}));
      for(const type of ['dragenter','dragover','drop'])document.querySelector('#nlpdfStage').dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer}));
    },{name:file.name,mimeType:file.mimeType,base64:file.buffer.toString('base64')});
  };
  await drop(mixed);
  await warning.waitFor({state:'visible',timeout:20000});
  assert.equal(await count(),'3','supported files in folders still import; nested ZIP does not expand');
  assert.equal(await page.locator('#nlpdfFileCount').innerText(),'2');
  assert.match(await page.locator('#nlpdfImportReportSummary').innerText(),/Added 3 pages · 5 files were not added/);
  assert.deepEqual(await page.locator('#nlpdfImportReportFiles strong').allTextContents(),[
    'photos/passport.HEIC','photos/extra.heif','attachments/more.ZIP','photos/<img src=x onerror=alert(1)>.heic','documents/notes.docx'
  ]);
  assert.equal(await page.locator('#nlpdfImportReportFiles img').count(),0,'archive filenames are escaped');
  assert.equal(await page.locator('#nlpdfImportReportFiles small').filter({hasText:'In Student attachments.zip'}).count(),5);
  assert.match(await page.locator('#nlpdfImportReportFiles').innerText(),/convert it to JPG/);
  assert.match(await page.locator('#nlpdfImportReportFiles').innerText(),/extract it and add the documents separately/);
  await page.keyboard.press('Delete');assert.equal(await count(),'3','editor shortcuts must not delete pages under the dialog');
  assert.equal(await warning.isVisible(),true);
  await page.screenshot({path:'test-results/new-letter-zip-warning-desktop.png',fullPage:true});
  await page.keyboard.press('Escape');assert.equal(await warning.isVisible(),false);
  await page.locator('#nlpdfReviewImport').click();assert.equal(await warning.isVisible(),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  const fits=await warning.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight});
  assert.equal(fits,true,'warning fits the mobile viewport');
  await page.screenshot({path:'test-results/new-letter-zip-warning-mobile.png',fullPage:true});
  await warning.getByRole('button',{name:'Got it',exact:true}).click();
  assert.equal(await warning.isVisible(),false);
  await page.locator('#nlpdfReviewImport').click();
  await warning.getByRole('button',{name:'Close import warning'}).click();
  console.log('PASS real ZIP drag-and-drop, full paths, guidance, escaped filenames, review, keyboard, mobile');

  await page.setViewportSize({width:1440,height:1000});
  const clean=zip('Normal attachments.zip',[['folder/image.png',png]]);
  await page.locator('#nlpdfFileInput').setInputFiles(clean);
  await page.waitForFunction(()=>document.querySelector('#nlpdfPageCount').textContent==='4');
  await page.waitForFunction(()=>!document.querySelector('#nlpdfCreate').disabled);
  assert.equal(await warning.isVisible(),false);
  assert.equal(await page.locator('#nlpdfReviewImport').isVisible(),false,'a clean import clears the previous warning');
  console.log('PASS normal ZIP continues without warning');

  const unsupported=zip('Only HEIC and ZIP.zip',[['photo.heic','synthetic'],['inside.zip',inner.buffer]]);
  await drop(unsupported);await warning.waitFor({state:'visible'});
  assert.equal(await count(),'4','unsupported-only ZIP preserves existing pages');
  assert.match(await page.locator('#nlpdfImportReportSummary').innerText(),/Added 0 pages · 2 files were not added/);
  await warning.getByRole('button',{name:'Got it',exact:true}).click();
  console.log('PASS unsupported-only ZIP gives a visible report');

  await page.locator('#nlpdfFileInput').setInputFiles([
    zip('First.zip',[['scan.HEIC','synthetic']]),
    zip('Second.zip',[['inner.ZIP',inner.buffer],['valid.png',png]])
  ]);
  await warning.waitFor({state:'visible'});
  assert.match(await page.locator('#nlpdfImportReportSummary').innerText(),/Added 1 page · 2 files were not added/);
  assert.deepEqual(await page.locator('#nlpdfImportReportFiles small').allTextContents(),['In First.zip','In Second.zip']);
  assert.equal(await count(),'5');
  await warning.getByRole('button',{name:'Got it',exact:true}).click();
  console.log('PASS multiple ZIP selection produces one combined report');

  await page.locator('#nlpdfFileInput').setInputFiles(zip('Damaged attachment.zip',[
    ['bad.pdf','not a PDF'],['good.png',png],['photo.heic','synthetic']
  ]));
  await warning.waitFor({state:'visible'});
  assert.equal(await count(),'6','one unreadable supported entry does not hide or block the other documents');
  assert.match(await page.locator('#nlpdfImportReportSummary').innerText(),/Added 1 page · 2 files were not added/);
  assert.match(await page.locator('#nlpdfImportReportFiles').innerText(),/bad.pdf.*Could not read/s);
  await warning.getByRole('button',{name:'Got it',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__unexpectedWrites),0);
  assert.deepEqual(errors,[]);
  console.log('PASS unreadable file recovery and local-only processing');
}finally{await browser?.close();}
