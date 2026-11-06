import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

await mkdir('test-results',{recursive:true});
const marker=PDFName.of('QaMarker');
async function fixture(label,pages,{form=false}={}){
  const doc=await PDFDocument.create();
  for(let i=0;i<pages;i++){
    const page=doc.addPage([400,600]);page.node.set(marker,PDFString.of(label+(i+1)));
    page.drawText(label+(i+1),{x:40,y:500,size:20});
    if(form){const field=doc.getForm().createTextField('field'+i);field.setText('Sample '+(i+1));field.addToPage(page,{x:40,y:400,width:180,height:30});}
  }
  return Buffer.from(await doc.save());
}
const files=async({form=false,mismatch=false}={})=>[
  {name:'Batch_TM7.pdf',mimeType:'application/pdf',buffer:await fixture('T',4)},
  {name:'Batch_CombineTTT.pdf',mimeType:'application/pdf',buffer:await fixture('C',mismatch?2:4)},
  {name:'Batch_Consent.pdf',mimeType:'application/pdf',buffer:await fixture('S',2,{form})}
];
const labels=doc=>doc.getPages().map(p=>p.node.lookupMaybe(marker,PDFString)?.decodeText()||'_');
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__unexpectedWrites=0;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const url=typeof input==='string'?input:input?.url||'';
      if(url==='https://buic-central-hub.vercel.app/api/staff/session')return new Response(JSON.stringify({ok:true,staff:{id:'qa-pdf-combine',username:'qa'}}),{status:200,headers:{'Content-Type':'application/json'}});
      const method=String(init.method||input?.method||'GET').toUpperCase();
      if(url.startsWith('https://buic-central-hub.vercel.app/')&&!['GET','HEAD'].includes(method)){window.__unexpectedWrites++;throw new Error('Unexpected Hub write blocked in isolated test');}
      return nativeFetch(input,init);
    };
    sessionStorage.setItem('buic-student-memory-staff-token-v1','qa-test-token');
  });
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#buicWorkspaceAuth').waitFor({state:'hidden',timeout:15000});
  assert.equal((await page.locator('[data-workspace="combine"]').innerText()).trim(),'PDF Combine');
  await page.locator('[data-workspace="combine"]').click();
  assert.equal(await page.locator('#workspaceCombine').isVisible(),true);
  await page.locator('#pdfcFiles').setInputFiles(await files());
  await page.locator('#pdfcReview').waitFor({state:'visible',timeout:20000});
  assert.match(await page.locator('#pdfcSummary').innerText(),/2 students.*6 pages each.*12 pages total/);
  assert.deepEqual(await page.locator('#pdfcPreviewBody tr').first().locator('th,td').allTextContents(),['1','1–2','1–2','1','1 page']);
  assert.equal(await page.locator('#pdfcGenerate').isDisabled(),true);
  await page.screenshot({path:'test-results/pdf-combine-desktop.png',fullPage:true});
  await page.locator('#pdfcOrderConfirmed').check();
  const firstDownload=page.waitForEvent('download');await page.locator('#pdfcGenerate').click();
  let download=await firstDownload;assert.equal(download.suggestedFilename(),'Combined_Student_Documents.pdf');
  let doc=await PDFDocument.load(await readFile(await download.path()));
  assert.deepEqual(labels(doc),['T1','T2','C1','C2','S1','_','T3','T4','C3','C4','S2','_']);
  console.log('PASS default upload, preview, confirmation, and combined download');

  await page.locator('#pdfcClear').click();await page.locator('#pdfcFiles').setInputFiles(await files({mismatch:true}));
  await page.waitForFunction(()=>document.querySelector('#pdfcStatus').textContent.includes('student set'));
  assert.equal(await page.locator('#pdfcReview').isVisible(),false);
  console.log('PASS mismatched batches are blocked');

  await page.locator('#pdfcClear').click();await page.locator('#pdfcFiles').setInputFiles(await files({form:true}));
  await page.locator('#pdfcReview').waitFor({state:'visible',timeout:20000});
  assert.equal(await page.locator('#pdfcFlattenLabel').isVisible(),true);
  await page.locator('#pdfcOrderConfirmed').check();assert.equal(await page.locator('#pdfcGenerate').isDisabled(),true);
  await page.locator('#pdfcFlattenConfirmed').check();
  const formDownload=page.waitForEvent('download');await page.locator('#pdfcGenerate').click();download=await formDownload;
  doc=await PDFDocument.load(await readFile(await download.path()));assert.equal(doc.getForm().getFields().length,0);assert.equal(doc.getPageCount(),12);
  console.log('PASS fillable fields require print-only confirmation');

  await page.locator('#pdfcClear').click();await page.locator('#pdfcOpenSettings').click();
  await page.locator('[data-setting="name"][data-step-id="tm7"]').waitFor({state:'visible'});
  await page.locator('#pdfcDetect').uncheck();
  await page.locator('[data-setting="name"][data-step-id="tm7"]').fill('First document');
  await page.locator('[data-setting="keywords"][data-step-id="tm7"]').fill('first, form a');
  await page.locator('[data-setting="pages"][data-step-id="tm7"]').fill('1');
  await page.locator('[data-setting-action="up"][data-step-id="combinettt"]').click();
  assert.equal(await page.locator('#pdfcDetect').isChecked(),false,'setting remains off after reordering');
  await page.locator('#pdfcAddType').click();await page.locator('#pdfcAddBlank').click();
  assert.equal(await page.locator('#pdfcDetect').isChecked(),false,'setting remains off after adding items');
  const newType=page.locator('#pdfcSettingsList fieldset').filter({has:page.locator('[data-setting="name"][value="New PDF type"]')});
  // The input property is updated from JavaScript, so find the newly created id directly.
  const customId=await page.locator('[data-setting="name"]').last().getAttribute('data-step-id');
  assert(customId);
  const allNameInputs=page.locator('[data-setting="name"]');
  const count=await allNameInputs.count();
  let typeId;
  for(let i=0;i<count;i++)if(await allNameInputs.nth(i).inputValue()==='New PDF type')typeId=await allNameInputs.nth(i).getAttribute('data-step-id');
  assert(typeId);await page.locator('[data-setting="name"][data-step-id="'+typeId+'"]').fill('Extra');
  await page.locator('[data-setting="keywords"][data-step-id="'+typeId+'"]').fill('extra');
  const setupDownload=page.waitForEvent('download');await page.locator('#pdfcExportSetup').click();download=await setupDownload;
  const exported=JSON.parse((await readFile(await download.path())).toString());assert.equal(exported.autoDetect,false);assert.equal(exported.steps.length,6);
  await page.locator('#pdfcSaveSetup').click();
  assert.deepEqual(await page.locator('#pdfcSequence li strong').allTextContents(),['CombineTTT','First document','Consent','Blank page','Extra','Blank page']);
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#buicWorkspaceAuth').waitFor({state:'hidden',timeout:15000});
  await page.locator('[data-workspace="combine"]').click();
  assert.deepEqual(await page.locator('#pdfcSequence li strong').allTextContents(),['CombineTTT','First document','Consent','Blank page','Extra','Blank page']);
  await page.locator('#pdfcOpenSettings').click();await page.locator('#pdfcResetSetup').click();await page.locator('#pdfcSaveSetup').click();
  await page.locator('#pdfcOpenSettings').click();await page.locator('#pdfcImportFile').setInputFiles({name:'setup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await page.waitForFunction(()=>document.querySelector('#pdfcSettingsStatus').textContent.includes('Setup loaded'));
  await page.locator('#pdfcSaveSetup').click();assert.equal((await page.locator('#pdfcSequence li').count()),6);
  await page.locator('#pdfcOpenSettings').click();await page.locator('#pdfcResetSetup').click();await page.locator('#pdfcSaveSetup').click();
  console.log('PASS editable sequence, settings persistence, export, and import');

  const unnamed=await files();unnamed.forEach((file,i)=>file.name='unknown-'+i+'.pdf');
  await page.locator('#pdfcFiles').setInputFiles(unnamed);
  await page.waitForFunction(()=>document.querySelector('#pdfcStatus').textContent.includes('document type'));
  const selectors=page.locator('#pdfcFileList select');assert.equal(await selectors.count(),3);
  await selectors.nth(0).selectOption('tm7');await selectors.nth(1).selectOption('combinettt');await selectors.nth(2).selectOption('consent');
  await page.locator('#pdfcReview').waitFor({state:'visible'});assert.equal(await page.locator('#pdfcOrderConfirmed').isChecked(),false);
  console.log('PASS manual assignment for unknown filenames');

  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/pdf-combine-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'page should not overflow on mobile');
  assert.equal(await page.evaluate(()=>window.__unexpectedWrites),0);
  assert.deepEqual(errors,[]);
  console.log('PASS mobile layout and browser-local operation');
}finally{await browser?.close();}
