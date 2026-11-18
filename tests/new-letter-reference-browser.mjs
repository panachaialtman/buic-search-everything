import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';

await mkdir('test-results',{recursive:true});
const workbook=JSON.parse(await readFile(new URL('../data/reference-snapshot.json',import.meta.url),'utf8'));
const objects=sheet=>workbook[sheet].slice(1).map(row=>Object.fromEntries(workbook[sheet][0].map((key,index)=>[key,row[index]??''])));
const countries=objects('Countries').filter(row=>row.Active==='YES' && row['Record ID']!=='C032').map(row=>({recordId:row['Record ID'],countryEnglish:row['Country EN'],countryThai:row['Country TH'],fullCountryEnglish:row['Full Country Name EN'],fullCountryThai:row['Full Country Name TH'],nationalityEnglish:row['Nationality EN'],nationalityThai:row['Nationality TH'],aliases:[]}));
const datasets={countries,nationalities:countries.map(row=>({recordId:row.recordId,english:row.countryEnglish,thai:row.countryThai})),programs:[{recordId:'FM001',programEnglish:'Business English',facultyEnglish:'BU International',credits:{}}]};
const source=await readFile(new URL('../new-letter-pdf-v1.js',import.meta.url),'utf8');
const boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>build().catch(console.error),{once:true});else build().catch(console.error);";
assert.equal(source.split(boot).length,2);
const hook=`window.__referenceTest={state,centralReference,openReferencePicker,
  useOldSnapshot(){state.pendingLetter={values:{studentName:'Original draft name'},frozenReferences:{countries:snapshotRows('Countries'),faculty:snapshotRows('Faculty_Major'),embassy:snapshotRows('Embassy')}};}};`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>sessionStorage.setItem('buic-student-memory-staff-token-v1','qa-reference-test-token'));
  await page.route('https://buic-central-hub.vercel.app/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    let payload,status=200;
    if(pathname==='/api/staff/session')payload={ok:true,staff:{id:'qa-reference',username:'qa'}};
    else if(pathname==='/api/v1/meta')payload={available:true,version:17,datasets:{countries:countries.length,nationalities:countries.length,programs:1,embassies:0}};
    else if(datasets[pathname.split('/').pop()]){const dataset=pathname.split('/').pop();payload={version:17,dataset,records:datasets[dataset]};}
    else{status=401;payload={error:'Isolated test has no staff session'};}
    await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(payload)});
  });
  await page.route('**/new-letter-pdf-v1.js*',route=>route.fulfill({contentType:'application/javascript',body:source.replace(boot,hook+boot)}));
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.BUICHubReference?.getAppliedVersion?.()===17 &&
    !window.BUIC_REFERENCE_DATA?.countries.some(row=>row['Record ID']==='C032'));
  await page.waitForSelector('#nlpdfReferencePicker',{state:'attached'});
  await page.locator('#buicWorkspaceAuth').waitFor({state:'hidden'});
  await page.locator('[data-workspace="documents"]').click();
  assert.equal(await page.evaluate(()=>window.BUIC_REFERENCE_DATA.countries.some(row=>row['Record ID']==='C032')),false,'Core must publish only active Hub records');
  // Put an older, still-active C032 into a restored case snapshot. The current
  // published membership must still control which rows may be selected.
  await page.evaluate(()=>window.__referenceTest.useOldSnapshot());
  assert.equal(await page.evaluate(()=>window.__referenceTest.state.pendingLetter.frozenReferences.countries.find(row=>row['Record ID']==='C032').Active),'YES');
  await page.evaluate(()=>window.__referenceTest.openReferencePicker('country','content'));
  await page.locator('#nlpdfReferencePickerSearch').fill('india');
  const results=page.locator('#nlpdfReferencePickerResults [data-reference-result]');
  assert.deepEqual(await results.allTextContents(),['Indian · Indiaอินเดีย · อินเดีย']);
  assert.equal(await results.getAttribute('data-reference-result'),'C102');
  assert.equal(await page.locator('#nlpdfReferencePickerResults [data-reference-result="C032"]').count(),0);
  await page.screenshot({path:'test-results/new-letter-active-hub-country.png',fullPage:false});
  await results.click();
  assert.equal(await page.evaluate(()=>window.__referenceTest.state.linkedData.countryEn),'India');
  assert.equal(await page.evaluate(()=>window.__referenceTest.state.linkedData.nationalityEn),'Indian');
  assert.equal(await page.evaluate(()=>window.__referenceTest.state.pendingLetter.values.studentName),'Original draft name');
  assert.equal(await page.evaluate(()=>window.__referenceTest.state.pendingLetter.frozenReferences.countries.find(row=>row['Record ID']==='C032').Active),'YES','The saved original snapshot remains intact');
  assert.equal(await page.evaluate(()=>window.__referenceTest.centralReference(false).countries.some(row=>row['Record ID']==='C032')),false);
  assert.deepEqual(errors,[]);
  console.log('PASS Hub deletion → active shared catalog → old draft lookup → only Indian · India → correct selected data; original draft unchanged');
}finally{await browser.close();}
