const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PDF = require('pdf-lib');
const combine = require('../pdf-combine.js');
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const markerKey = PDF.PDFName.of('QaMarker');

async function source(label, pages, options = {}) {
  const doc = await PDF.PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([400 + i * 10, 600 + i * 10]);
    page.node.set(markerKey, PDF.PDFString.of(label + (i + 1)));
    page.drawText(label + (i + 1), {x:40,y:500,size:20});
    if (options.form) {
      const field = doc.getForm().createTextField('field-' + i);
      field.setText('Sample ' + (i + 1));
      field.addToPage(page, {x:40,y:400,width:180,height:30});
    }
    if (options.rotated) { page.setRotation(PDF.degrees(90));page.setCropBox(5, 5, 380, 580); }
  }
  return new Uint8Array(await doc.save());
}
async function defaultSources(form = false) {
  return {tm7: await source('T',4),combinettt: await source('C',4),consent: await source('S',2,{form,rotated:true})};
}
const label = page => page.node.lookupMaybe(markerKey, PDF.PDFString)?.decodeText() || '_';

test('default setup detects filename keywords without guessing ambiguous matches', () => {
  const setup = combine.validateSetup(combine.DEFAULT_SETUP);
  assert.equal(combine.matchFilename('batch_Tm-7.pdf', setup), 'tm7');
  assert.equal(combine.matchFilename('Combine TTT 2026.pdf', setup), 'combinettt');
  assert.equal(combine.matchFilename('Consent.pdf', setup), 'consent');
  assert.equal(combine.matchFilename('TM7-Consent.pdf', setup), '');
  setup.autoDetect = false;
  assert.equal(combine.matchFilename('TM7.pdf', setup), '');
});

test('page counts and setup are validated before combining', () => {
  const setup = combine.validateSetup(combine.DEFAULT_SETUP);
  assert.deepEqual(combine.planBatch(setup,{tm7:4,combinettt:4,consent:2}),{people:2,perStudent:6,totalPages:12});
  assert.throws(()=>combine.planBatch(setup,{tm7:3,combinettt:4,consent:2}),/pages per student|page.*per student/i);
  assert.throws(()=>combine.planBatch(setup,{tm7:4,combinettt:2,consent:2}),/student set/i);
  assert.throws(()=>combine.planBatch(setup,{tm7:0,combinettt:4,consent:2}),/at least one page/i);
  const invalid = clone(setup);invalid.steps[1].id = invalid.steps[0].id;
  assert.throws(()=>combine.validateSetup(invalid),/unique ID/i);
  invalid.steps[1].id='new';invalid.steps[1].pages=1.5;
  assert.throws(()=>combine.validateSetup(invalid),/whole number/i);
});

test('default batch interleaves each student and appends correctly sized blank backs', async () => {
  const input = await defaultSources(), before = Object.fromEntries(Object.entries(input).map(([k,v])=>[k,digest(v)]));
  const result = await combine.combineBytes(PDF, combine.DEFAULT_SETUP, input);
  assert.equal(result.people,2);assert.equal(result.totalPages,12);
  const doc = await PDF.PDFDocument.load(result.bytes);
  assert.deepEqual(doc.getPages().map(label),['T1','T2','C1','C2','S1','_','T3','T4','C3','C4','S2','_']);
  for (const [front, back] of [[4,5],[10,11]]) {
    const a=doc.getPage(front),b=doc.getPage(back);
    assert.deepEqual(b.getMediaBox(),a.getMediaBox());assert.deepEqual(b.getCropBox(),a.getCropBox());
    assert.equal(b.getRotation().angle,a.getRotation().angle);
    assert.equal(b.node.Contents(),undefined);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(input).map(([k,v])=>[k,digest(v)])),before);
});

test('custom types, page counts, order, and leading blank pages work', async () => {
  const setup={version:1,autoDetect:true,steps:[
    {id:'blank',kind:'blank',name:'Blank',pages:2},
    {id:'extra',kind:'pdf',name:'Additional PDF',keywords:['extra'],pages:1},
    {id:'tm7',kind:'pdf',name:'TM7',keywords:['TM7'],pages:2}
  ]};
  const result=await combine.combineBytes(PDF,setup,{tm7:await source('T',4),extra:await source('E',2)});
  assert.deepEqual([result.people,result.perStudent,result.totalPages],[2,5,10]);
  const pages=(await PDF.PDFDocument.load(result.bytes)).getPages();
  assert.deepEqual(pages.map(label),['_','_','E1','T1','T2','_','_','E2','T3','T4']);
  assert.deepEqual(pages[0].getMediaBox(),pages[2].getMediaBox());
  assert.deepEqual(pages[5].getMediaBox(),pages[7].getMediaBox());
});

test('fillable PDFs need permission for a print-only copy and retain visible values', async () => {
  const input=await defaultSources(true), original=digest(input.consent);
  assert.equal((await combine.readPdf(PDF,input.consent)).hasFields,true);
  await assert.rejects(()=>combine.combineBytes(PDF,combine.DEFAULT_SETUP,input),/print-only/i);
  const result=await combine.combineBytes(PDF,combine.DEFAULT_SETUP,input,{flattenForms:true});
  const doc=await PDF.PDFDocument.load(result.bytes);
  assert.equal(doc.getForm().getFields().length,0);
  assert.equal(digest(input.consent),original);
  assert.equal(doc.getPageCount(),12);
  assert(doc.getPage(4).node.Contents(),'printed field has page appearance');
  for (const page of doc.getPages()) {
    const annotations=page.node.Annots();
    if (annotations) for (let i=0;i<annotations.size();i++) {
      assert(doc.context.lookupMaybe(annotations.get(i)), 'annotation references must resolve');
    }
  }
});

test('dynamic forms and orphan form widgets are rejected instead of silently dropping data', async () => {
  const xfa=await PDF.PDFDocument.create();xfa.addPage();
  xfa.catalog.set(PDF.PDFName.of('AcroForm'),xfa.context.obj({Fields:[],XFA:'not supported'}));
  await assert.rejects(async()=>combine.readPdf(PDF,new Uint8Array(await xfa.save())),/dynamic form/i);
  const orphan=await PDF.PDFDocument.create(),page=orphan.addPage();
  const widget=orphan.context.register(orphan.context.obj({Type:'Annot',Subtype:'Widget',Rect:[0,0,20,20]}));
  page.node.set(PDF.PDFName.of('Annots'),orphan.context.obj([widget]));
  await assert.rejects(async()=>combine.readPdf(PDF,new Uint8Array(await orphan.save())),/unsupported form/i);
});
