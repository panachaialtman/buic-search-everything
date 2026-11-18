'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const pdfSource=fs.readFileSync(path.join(root,'new-letter-pdf-v1.js'),'utf8');
const coreSource=fs.readFileSync(path.join(root,'app-core.js'),'utf8');
const clean=value=>String(value??'').trim();
const oldTerritory={'Record ID':'C032','Country EN':'British Indian Ocean Territory','Nationality EN':'Indian',Active:'YES'};
const india={'Record ID':'C102','Country EN':'India','Country TH':'อินเดีย','Nationality EN':'Indian',Active:'YES'};
const catalog=countries=>({countries,faculty:[],embassy:[]});
function referenceFixture({live,frozen,published=null,snapshot=catalog([])}={}){
  const start=pdfSource.indexOf('function centralReference('),end=pdfSource.indexOf('\n}\n',start)+2;
  assert(start>=0 && end>start);
  const state={pendingLetter:frozen?{frozenReferences:frozen,values:{studentName:'Keep student data'}}:null};
  const sandbox={clean,Set,Boolean,state,window:{BUIC_REFERENCE_DATA:live,BUICHubReference:{getAppliedVersion:()=>published}},snapshotRows:sheet=>snapshot[{Countries:'countries',Faculty_Major:'faculty',Embassy:'embassy'}[sheet]]};
  vm.createContext(sandbox);vm.runInContext(pdfSource.slice(start,end)+';this.references=centralReference;',sandbox);
  return {state,references:sandbox.references};
}
test('Hub retirement marks C032 inactive without mutating the source workbook',async()=>{
  const local={Countries:[['Record ID','Country EN','Country TH','Nationality EN','Nationality TH','Active'],['C032','British Indian Ocean Territory','เขต','Indian','เก่า','YES'],['C102','India','อินเดีย','Indian','อินเดีย','YES']],Faculty_Major:[['Record ID','Major EN','Faculty EN','Active'],['FM001','Program','Faculty','YES']],Country_Aliases:[['Alias ID','Country Record ID','Alias','Active'],['OLD','C032','Indian','YES']],Faculty_Aliases:[['Alias ID','Faculty/Major Record ID','Alias','Active']],Untouched:[['Template'],['Keep this']]};
  const before=structuredClone(local),calls=[];
  const payloads={meta:{available:true,version:17,datasets:{embassies:0}},countries:{dataset:'countries',version:17,records:[{recordId:'C102',countryEnglish:'India',countryThai:'อินเดีย',nationalityEnglish:'Indian',nationalityThai:'อินเดีย'}]},nationalities:{dataset:'nationalities',version:17,records:[{recordId:'C102',english:'India',thai:'อินเดีย'}]},programs:{dataset:'programs',version:17,records:[{recordId:'FM001',programEnglish:'Program',facultyEnglish:'Faculty',credits:{}}]}};
  const sandbox={window:{},structuredClone,AbortController,setTimeout,clearTimeout,localStorage:{setItem(){}},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>structuredClone(payloads[url.split('/').pop()])};}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'hub-reference.js'),'utf8'),sandbox);
  const result=await sandbox.window.BUICHubReference.update(local);
  assert.equal(result.version,17);assert.equal(result.rows.Countries[1][5],'NO');
  assert.equal(result.rows.Countries[2][5],'YES');assert.equal(result.rows.Country_Aliases[1][3],'NO');
  assert.deepEqual(local,before);assert.deepEqual(result.rows.Untouched,local.Untouched);
  assert(calls.every(({options})=>options.credentials==='omit' && !options.body));
});
test('the shared selector catalog excludes inactive records for every reference type',()=>{
  const match=coreSource.match(/  function setRows\(rows,meta,persist=false\)\{[^\n]+\}/);
  assert(match,'Exercise the production catalog publisher');
  const sandbox={window:{dispatchEvent(){}},CustomEvent:class{},buildData:rows=>rows,yes:v=>clean(v).toUpperCase()==='YES',countryCodeCache:new Map(),flagColorCache:new Map(),floatingWindows:new Map()};
  for(const key of ['updateOverview','updateSourceUI','refreshCommunicationData','renderValidationSummary','search','renderFloatingWindows'])sandbox[key]=()=>{};
  vm.createContext(sandbox);vm.runInContext('let sourceRows,data,sourceMeta;'+match[0]+';this.publish=setRows;',sandbox);
  sandbox.publish({countries:[india,{...oldTerritory,Active:'NO'}],faculty:[{Active:'NO'}],embassy:[{Active:'NO'}]},{type:'hub'});
  assert.deepEqual(sandbox.window.BUIC_REFERENCE_DATA.countries.map(row=>row['Record ID']),['C102']);
  assert.equal(sandbox.window.BUIC_REFERENCE_DATA.faculty.length,0);assert.equal(sandbox.window.BUIC_REFERENCE_DATA.embassy.length,0);
});
test('New Letter filters inactive rows in live data and workbook fallback',()=>{
  const records=catalog([{...oldTerritory,Active:'NO'},india]);
  assert.deepEqual(Array.from(referenceFixture({live:records}).references().countries,row=>row['Record ID']),['C102']);
  assert.deepEqual(Array.from(referenceFixture({snapshot:records}).references().countries,row=>row['Record ID']),['C102']);
});
test('inactive rows in a saved draft are never selectable',()=>{
  const frozen=catalog([{...oldTerritory,Active:'NO'},india]);
  assert.deepEqual(Array.from(referenceFixture({frozen}).references().countries,row=>row['Record ID']),['C102']);
});
test('an older draft cannot revive a deleted Hub record still marked active in its snapshot',()=>{
  const frozen=catalog([oldTerritory,india]),before=structuredClone(frozen);
  const fixture=referenceFixture({live:catalog([india]),frozen,published:17});
  assert.deepEqual(Array.from(fixture.references().countries,row=>row['Record ID']),['C102']);
  assert.deepEqual(frozen,before);assert.equal(fixture.state.pendingLetter.values.studentName,'Keep student data');
});
test('new letters can capture the current catalog without inheriting another case snapshot',()=>{
  const fixture=referenceFixture({live:catalog([india]),frozen:catalog([oldTerritory]),published:17});
  assert.deepEqual(Array.from(fixture.references(false).countries,row=>row['Record ID']),['C102']);
  assert.match(pdfSource,/context\.frozenReferences=structuredClone\(context\.frozenReferences\|\|centralReference\(false\)\)/);
});
test('offline drafts keep their original active snapshot without inventing a Hub deletion',()=>{
  const frozen=catalog([india]);
  assert.equal(referenceFixture({frozen}).references().countries[0]['Record ID'],'C102');
});
