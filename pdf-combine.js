(function (root) {
  'use strict';

  const SETTINGS_KEY = 'buic-pdf-combine-setup-v1';
  const DEFAULT_SETUP = {
    version: 1,
    autoDetect: true,
    steps: [
      { id: 'tm7', kind: 'pdf', name: 'TM7', keywords: ['TM7'], pages: 2 },
      { id: 'combinettt', kind: 'pdf', name: 'CombineTTT', keywords: ['CombineTTT'], pages: 2 },
      { id: 'consent', kind: 'pdf', name: 'Consent', keywords: ['Consent'], pages: 1 },
      { id: 'blank', kind: 'blank', name: 'Blank page', pages: 1 }
    ]
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const textValue = value => typeof value === 'string' ? value.trim() : '';
  const nameKey = value => textValue(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const filesIn = config => config.steps.filter(step => step.kind === 'pdf');
  const pageTotal = config => config.steps.reduce((sum, step) => sum + step.pages, 0);

  function validateSetup(value) {
    if (!value || value.version !== 1 || typeof value.autoDetect !== 'boolean' || !Array.isArray(value.steps))
      throw new Error('This setup file is not supported.');
    if (value.steps.length < 1 || value.steps.length > 100) throw new Error('A setup must contain between 1 and 100 items.');
    const ids = new Set(), names = new Set();
    const steps = value.steps.map(step => {
      if (!step || !['pdf', 'blank'].includes(step.kind)) throw new Error('Each item must be a PDF type or blank pages.');
      const id = textValue(step.id), name = textValue(step.name), pages = Number(step.pages);
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new Error('Each setup item needs a unique ID.');
      ids.add(id);
      if (!name || name.length > 100) throw new Error('Give each item a name of up to 100 characters.');
      if (!Number.isSafeInteger(pages) || pages < 1 || pages > 10000) throw new Error('Pages per student must be a whole number from 1 to 10,000.');
      if (step.kind === 'blank') return { id, kind: 'blank', name, pages };
      const key = name.toLowerCase().replace(/\s+/g, ' ');
      if (names.has(key)) throw new Error('Give each PDF type a different name.');
      names.add(key);
      const raw = Array.isArray(step.keywords) ? step.keywords : typeof step.keywords === 'string' ? step.keywords.split(',') : [];
      const keywords = raw.map(textValue).filter(Boolean);
      if (keywords.length > 30 || keywords.some(word => word.length > 150)) throw new Error('Use up to 30 filename keywords of 150 characters each.');
      return { id, kind: 'pdf', name, keywords, pages };
    });
    if (!steps.some(step => step.kind === 'pdf')) throw new Error('Add at least one PDF type.');
    return { version: 1, autoDetect: value.autoDetect, steps };
  }

  function matchFilename(filename, config) {
    if (!config.autoDetect) return '';
    const candidate = nameKey(filename);
    const matches = filesIn(config).filter(step => step.keywords.some(word => {
      const key = nameKey(word);
      return key && candidate.includes(key);
    }));
    return matches.length === 1 ? matches[0].id : '';
  }

  function planBatch(config, counts) {
    const types = filesIn(config);
    let people = null, first = null;
    for (const type of types) {
      const count = counts[type.id];
      if (!Number.isSafeInteger(count) || count < 1) throw new Error(type.name + ' needs a PDF with at least one page.');
      if (count % type.pages !== 0)
        throw new Error(type.name + ' has ' + count + ' pages. Its setup needs ' + type.pages + ' page' + (type.pages === 1 ? '' : 's') + ' per student.');
      const current = count / type.pages;
      if (people === null) { people = current; first = type.name; }
      else if (people !== current)
        throw new Error(first + ' contains ' + people + ' student set' + (people === 1 ? '' : 's') + ', but ' + type.name + ' contains ' + current + '. Check the PDF order and page counts.');
    }
    const perStudent = pageTotal(config), totalPages = perStudent * people;
    if (!Number.isSafeInteger(totalPages)) throw new Error('The combined document is too large to calculate safely.');
    return { people, perStudent, totalPages };
  }

  async function readPdf(PDF, bytes) {
    let doc;
    try { doc = await PDF.PDFDocument.load(bytes.slice(), { updateMetadata: false, throwOnInvalidObject: true }); }
    catch (error) {
      if (/encrypt|password/i.test(String(error?.message || error))) throw new Error('This PDF is password-protected. Use an unlocked copy.');
      throw new Error('This file could not be read as a PDF.');
    }
    const N = PDF.PDFName, D = PDF.PDFDict, A = PDF.PDFArray;
    let acro, rawFields, fields = [], needAppearances = false;
    try {
      acro = doc.catalog.lookupMaybe(N.of('AcroForm'), D);
      if (acro?.has(N.of('XFA'))) throw new Error('This PDF uses a dynamic form. Save a printable PDF copy and try again.');
      rawFields = acro?.lookupMaybe(N.of('Fields'), A);
      if (rawFields?.size()) {
        fields = doc.getForm().getFields();
        if (!fields.length) throw new Error('This PDF contains unsupported form fields. Save a printable PDF copy and try again.');
        const flag = acro.lookupMaybe(N.of('NeedAppearances'), PDF.PDFBool);
        needAppearances = Boolean(flag?.asBoolean());
      }
      const knownWidgets = new Set();
      for (const field of fields) {
        if (field instanceof PDF.PDFSignature) {
          const value = field.acroField.V();
          if (value && value !== PDF.PDFNull) throw new Error('This PDF has a digital signature that cannot remain valid after combining. Use an unsigned print copy.');
        }
        for (const widget of field.acroField.getWidgets()) knownWidgets.add(widget.dict);
      }
      for (const page of doc.getPages()) {
        const annotations = page.node.Annots();
        if (!annotations) continue;
        for (let i = 0; i < annotations.size(); i++) {
          const annotation = doc.context.lookupMaybe(annotations.get(i), D);
          if (!annotation) throw new Error('This PDF contains an unsupported annotation. Save a printable PDF copy and try again.');
          const subtype = annotation.lookupMaybe(N.of('Subtype'), N);
          if (subtype?.toString() === '/Widget' && !knownWidgets.has(annotation))
            throw new Error('This PDF has unsupported form fields. Save a printable PDF copy and try again.');
        }
      }
    } catch (error) {
      if (/dynamic form|unsupported form|unsupported annotation|digital signature/i.test(String(error?.message))) throw error;
      throw new Error('This PDF has form data that could not be read safely. Save a printable PDF copy and try again.');
    }
    return { doc, pageCount: doc.getPageCount(), hasFields: fields.length > 0, fields, needAppearances };
  }

  async function flattenForPrint(PDF, analysis) {
    if (!analysis.hasFields) return;
    try {
      const form = analysis.doc.getForm();
      // pdf-lib can leave a deleted child widget in a page's Annots array
      // after flattening. Remember only the form widgets so they can be
      // removed without disturbing links or other page annotations.
      const widgets = new Set(analysis.fields.flatMap(field => field.acroField.getWidgets().map(widget => widget.dict)));
      const widgetRefs = new Map();
      for (const page of analysis.doc.getPages()) {
        const annotations = page.node.Annots(), refs = new Set();
        if (annotations) for (let i = 0; i < annotations.size(); i++) {
          const ref = annotations.get(i);
          if (widgets.has(analysis.doc.context.lookupMaybe(ref, PDF.PDFDict))) refs.add(ref);
        }
        if (refs.size) widgetRefs.set(page, refs);
      }
      const needsUpdate = analysis.needAppearances || analysis.fields.some(field => field.needsAppearancesUpdate());
      if (needsUpdate) {
        const font = await analysis.doc.embedFont(PDF.StandardFonts.Helvetica);
        for (const field of analysis.fields) {
          if (!analysis.needAppearances && !field.needsAppearancesUpdate()) continue;
          if (typeof field.defaultUpdateAppearances !== 'function') throw new Error('Unsupported field appearance');
          field.defaultUpdateAppearances(font);
        }
      }
      form.flatten({ updateFieldAppearances: false });
      for (const [page, refs] of widgetRefs) {
        const annotations = page.node.Annots();
        if (annotations) for (let i = annotations.size() - 1; i >= 0; i--) if (refs.has(annotations.get(i))) annotations.remove(i);
      }
    } catch {
      throw new Error('A fillable PDF could not be prepared for printing. Save it as a printable PDF and try again.');
    }
  }

  function blankLike(PDF, output, reference) {
    const media = reference.getMediaBox(), crop = reference.getCropBox();
    const blank = output.addPage([media.width, media.height]);
    blank.setMediaBox(media.x, media.y, media.width, media.height);
    blank.setCropBox(crop.x, crop.y, crop.width, crop.height);
    blank.setRotation(PDF.degrees(reference.getRotation().angle));
    return blank;
  }

  async function combineBytes(PDF, rawSetup, sourceBytes, options = {}) {
    const config = validateSetup(rawSetup), steps = filesIn(config), analyses = new Map(), counts = {};
    const progress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i], bytes = sourceBytes[step.id];
      if (!(bytes instanceof Uint8Array)) throw new Error('Choose a PDF for ' + step.name + '.');
      progress('Checking ' + step.name + '…', i, steps.length + 2);
      const info = await readPdf(PDF, bytes);
      analyses.set(step.id, info); counts[step.id] = info.pageCount;
    }
    const plan = planBatch(config, counts);
    if ([...analyses.values()].some(item => item.hasFields) && !options.flattenForms)
      throw new Error('Confirm the print-only copy of fillable fields before combining.');
    for (const info of analyses.values()) if (info.hasFields) await flattenForPrint(PDF, info);
    progress('Copying source pages…', steps.length, steps.length + 2);
    const output = await PDF.PDFDocument.create(), copied = new Map();
    for (const step of steps) {
      const src = analyses.get(step.id).doc;
      copied.set(step.id, await output.copyPages(src, src.getPageIndices()));
    }
    const firstType = steps[0];
    for (let student = 0; student < plan.people; student++) {
      let last = null;
      for (const step of config.steps) {
        if (step.kind === 'pdf') {
          const pages = copied.get(step.id);
          for (let offset = 0; offset < step.pages; offset++) {
            last = pages[student * step.pages + offset];output.addPage(last);
          }
        } else {
          for (let offset = 0; offset < step.pages; offset++) {
            const reference = last || copied.get(firstType.id)[student * firstType.pages];
            last = blankLike(PDF, output, reference);
          }
        }
      }
      if (student % 15 === 0) {
        progress('Arranging student ' + (student + 1) + ' of ' + plan.people + '…', steps.length + 1, steps.length + 2);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    output.setTitle('Combined student documents');
    output.setCreator('BU International Center Workspace');
    progress('Preparing download…', steps.length + 2, steps.length + 2);
    const bytes = await output.save({ addDefaultPage: false, updateFieldAppearances: false });
    return { bytes, ...plan };
  }

  const api = { DEFAULT_SETUP, validateSetup, matchFilename, planBatch, readPdf, combineBytes, blankLike };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.BUICPdfCombine = api;

  function initialize() {
    const $ = id => root.document.getElementById(id);
    const pane = $('workspaceCombine');if (!pane) return;
    const elements = {
      choose: $('pdfcChoose'), files: $('pdfcFiles'), drop: $('pdfcDrop'), list: $('pdfcFileList'), clear: $('pdfcClear'),
      status: $('pdfcStatus'), sequence: $('pdfcSequence'), perStudent: $('pdfcPagesPerStudent'), settings: $('pdfcSettings'),
      openSettings: $('pdfcOpenSettings'), detect: $('pdfcDetect'), settingsList: $('pdfcSettingsList'), addType: $('pdfcAddType'),
      addBlank: $('pdfcAddBlank'), reset: $('pdfcResetSetup'), save: $('pdfcSaveSetup'), cancel: $('pdfcCancelSetup'),
      exportSetup: $('pdfcExportSetup'), importSetup: $('pdfcImportSetup'), importFile: $('pdfcImportFile'), settingsStatus: $('pdfcSettingsStatus'),
      review: $('pdfcReview'), summary: $('pdfcSummary'), duplex: $('pdfcDuplexNote'), previewHead: $('pdfcPreviewHead'),
      previewBody: $('pdfcPreviewBody'), previewNote: $('pdfcPreviewNote'), orderLabel: $('pdfcOrderLabel'), order: $('pdfcOrderConfirmed'),
      flattenLabel: $('pdfcFlattenLabel'), flatten: $('pdfcFlattenConfirmed'), filename: $('pdfcFilename'), generate: $('pdfcGenerate'),
      progress: $('pdfcProgress'), progressText: $('pdfcProgressText'), progressBar: $('pdfcProgressBar')
    };
    let setup = clone(DEFAULT_SETUP), warning = '';
    try { const saved = root.localStorage.getItem(SETTINGS_KEY);if (saved) setup = validateSetup(JSON.parse(saved)); }
    catch { warning = 'The saved setup could not be loaded. The default setup is shown.'; }
    const state = { setup, draft: null, entries: [], busy: false, counter: 0, library: null };
    const make = (tag, className, content) => { const e = root.document.createElement(tag);if (className) e.className = className;if (content !== undefined) e.textContent = content;return e; };
    const setStatus = (message, type = '') => { elements.status.textContent = message;elements.status.className = 'pdfc-status' + (type ? ' is-' + type : ''); };
    const setSettingsStatus = (message, type = '') => { elements.settingsStatus.textContent = message;elements.settingsStatus.className = 'pdfc-status' + (type ? ' is-' + type : ''); };
    const describePages = pages => pages + ' page' + (pages === 1 ? '' : 's');

    function pdfLibrary() {
      if (root.PDFLib?.PDFDocument) return Promise.resolve(root.PDFLib);
      if (!state.library) state.library = new Promise((resolve, reject) => {
        const script = root.document.createElement('script');script.src = 'vendor/pdf-lib-1.17.1.min.js';
        script.onload = () => root.PDFLib?.PDFDocument ? resolve(root.PDFLib) : reject(new Error('The PDF tool could not be loaded.'));
        script.onerror = () => { script.remove();reject(new Error('The PDF tool could not be loaded. Check the connection and try again.')); };
        root.document.head.appendChild(script);
      }).catch(error => { state.library = null;throw error; });
      return state.library;
    }

    function renderSequence() {
      elements.sequence.replaceChildren();
      for (const step of state.setup.steps) {
        const li = make('li'), name = make('strong', '', step.name), count = make('span', '', describePages(step.pages));
        li.append(name, count);elements.sequence.appendChild(li);
      }
      elements.perStudent.textContent = pageTotal(state.setup) + ' pages per student';
      const typeCount = filesIn(state.setup).length;
      elements.choose.textContent = 'Choose PDF files';
      elements.choose.setAttribute('aria-label', 'Choose ' + typeCount + ' PDF file' + (typeCount === 1 ? '' : 's'));
      elements.clear.disabled = !state.entries.length || state.busy;
    }

    function renderFiles() {
      elements.list.replaceChildren();const types = filesIn(state.setup);
      for (const entry of state.entries) {
        const row = make('div', 'pdfc-file'), info = make('div'), name = make('span', 'pdfc-file-name', entry.file.name);
        const meta = make('span', 'pdfc-file-meta', entry.status === 'reading' ? 'Checking PDF…' : entry.error ? entry.error : describePages(entry.pageCount) + (entry.hasFields ? ' · fillable fields' : ''));
        info.append(name, meta);
        const label = make('label'), caption = make('span', '', 'Document type'), select = make('select');select.dataset.fileRole = entry.id;
        const empty = make('option', '', 'Choose type');empty.value = '';select.appendChild(empty);
        for (const type of types) { const option = make('option', '', type.name);option.value = type.id;select.appendChild(option); }
        select.value = entry.role;select.disabled = state.busy;select.setAttribute('aria-label', 'Document type for ' + entry.file.name);label.append(caption, select);
        const remove = make('button', 'pdfc-file-remove', '×');remove.type = 'button';remove.dataset.removeFile = entry.id;remove.disabled = state.busy;remove.setAttribute('aria-label', 'Remove ' + entry.file.name);
        row.append(info, label, remove);elements.list.appendChild(row);
      }
    }

    function mapping() {
      const types = filesIn(state.setup);
      if (state.entries.length !== types.length) return { error: 'Choose ' + types.length + ' PDF file' + (types.length === 1 ? '' : 's') + ' for this setup.' };
      if (state.entries.some(item => item.status === 'reading')) return { loading: true };
      const failed = state.entries.find(item => item.error);if (failed) return { error: failed.file.name + ': ' + failed.error };
      if (state.entries.some(item => !item.role)) return { error: 'Choose the document type for each PDF.' };
      const byRole = new Map();
      for (const entry of state.entries) {
        if (byRole.has(entry.role)) return { error: 'Assign one different PDF to each document type.' };
        byRole.set(entry.role, entry);
      }
      if (types.some(type => !byRole.has(type.id))) return { error: 'Choose one PDF for each document type.' };
      const counts = Object.fromEntries(types.map(type => [type.id, byRole.get(type.id).pageCount]));
      try { return { plan: planBatch(state.setup, counts), byRole }; }
      catch (error) { return { error: error.message }; }
    }

    function renderPreview(plan) {
      const head = make('tr');head.appendChild(make('th', '', 'Student'));
      for (const step of state.setup.steps) head.appendChild(make('th', '', step.name));
      elements.previewHead.replaceChildren(head);elements.previewBody.replaceChildren();
      const fragment = root.document.createDocumentFragment(), shown = Math.min(plan.people, 200);
      for (let i = 0; i < shown; i++) {
        const row = make('tr');row.appendChild(make('th', '', String(i + 1)));
        for (const step of state.setup.steps) {
          const start = i * step.pages + 1, end = start + step.pages - 1;
          row.appendChild(make('td', '', step.kind === 'blank' ? describePages(step.pages) : start === end ? String(start) : start + '–' + end));
        }
        fragment.appendChild(row);
      }
      elements.previewBody.appendChild(fragment);
      elements.previewNote.textContent = (plan.people > shown ? 'Showing the first ' + shown + ' students. ' : '') + 'Page numbers refer to the original PDFs.';
      elements.duplex.hidden = !(plan.people > 1 && plan.perStudent % 2);
      elements.duplex.textContent = elements.duplex.hidden ? '' : 'Each student has an odd number of pages. With double-sided printing, the next student will start on the back of the previous student’s last page.';
    }

    function refreshReview(preserveMessage = false) {
      const result = mapping(), valid = Boolean(result.plan), typeCount = filesIn(state.setup).length;
      elements.review.hidden = !valid;
      if (valid) {
        const { plan, byRole } = result;
        elements.summary.textContent = plan.people + ' student' + (plan.people === 1 ? '' : 's') + ' · ' + plan.perStudent + ' pages each · ' + plan.totalPages + ' pages total';
        renderPreview(plan);elements.orderLabel.hidden = typeCount < 2;
        elements.flattenLabel.hidden = ![...byRole.values()].some(entry => entry.hasFields);
        if (elements.flattenLabel.hidden) elements.flatten.checked = false;
        if (!preserveMessage) setStatus('Files are ready to review.', 'success');
      } else if (!preserveMessage) setStatus(result.loading ? 'Checking PDF files…' : result.error || 'Add your PDF files.', result.error && state.entries.length ? 'error' : '');
      elements.generate.disabled = state.busy || !valid || (!elements.orderLabel.hidden && !elements.order.checked) || (!elements.flattenLabel.hidden && !elements.flatten.checked);
      return result;
    }

    function setBusy(busy) {
      state.busy = busy;elements.choose.disabled = busy;elements.clear.disabled = busy || !state.entries.length;
      elements.order.disabled = busy;elements.flatten.disabled = busy;elements.filename.disabled = busy;
      elements.settings.querySelectorAll('input,button,select').forEach(item => { item.disabled = busy; });
      elements.openSettings.disabled = busy;elements.settings.querySelector('summary').setAttribute('aria-disabled', String(busy));
      renderFiles();refreshReview(true);
    }

    async function addFiles(fileList) {
      if (state.busy) return;
      const incoming = Array.from(fileList || []), expected = filesIn(state.setup).length;
      if (!incoming.length) return;
      if (state.entries.length + incoming.length > expected) { setStatus('This setup needs ' + expected + ' PDF file' + (expected === 1 ? '' : 's') + '. Remove an extra file or change the setup.', 'error');return; }
      const added = incoming.map(file => ({ id: 'file-' + (++state.counter), file, role: matchFilename(file.name, state.setup), source: 'auto', status: 'reading', bytes: null, error: '', pageCount: 0, hasFields: false }));
      state.entries.push(...added);elements.order.checked = false;elements.flatten.checked = false;elements.progress.hidden = true;renderSequence();renderFiles();refreshReview();
      await Promise.all(added.map(async entry => {
        try {
          if (!/\.pdf$/i.test(entry.file.name) && entry.file.type !== 'application/pdf') throw new Error('Choose a PDF file.');
          const PDF = await pdfLibrary(), bytes = new Uint8Array(await entry.file.arrayBuffer()), info = await readPdf(PDF, bytes);
          if (!state.entries.includes(entry)) return;
          entry.bytes = bytes;entry.pageCount = info.pageCount;entry.hasFields = info.hasFields;entry.status = 'ready';
        } catch (error) {
          if (!state.entries.includes(entry)) return;
          entry.error = error?.message || 'Could not open this PDF.';entry.status = 'error';
        }
        renderFiles();refreshReview();
      }));
    }

    function renderSettings() {
      const draft = state.draft;elements.detect.checked = draft.autoDetect;elements.settingsList.replaceChildren();
      draft.steps.forEach((step, index) => {
        const fieldset = make('fieldset', 'pdfc-setting'), legend = make('legend', '', (step.kind === 'pdf' ? 'PDF type ' : 'Blank pages ') + (index + 1));fieldset.appendChild(legend);
        const grid = make('div', 'pdfc-setting-grid');
        function setting(labelText, key, value, kind = 'text') {
          const label = make('label'), caption = make('span', '', labelText), input = make('input');input.type = kind;input.value = value;input.dataset.setting = key;input.dataset.stepId = step.id;
          if (kind === 'number') { input.min = '1';input.max = '10000';input.step = '1'; }
          label.append(caption, input);grid.appendChild(label);
        }
        setting('Name', 'name', step.name);
        if (step.kind === 'pdf') setting('Filename keywords (comma-separated)', 'keywords', Array.isArray(step.keywords) ? step.keywords.join(', ') : step.keywords || '');
        setting('Pages per student', 'pages', step.pages, 'number');
        const actions = make('div', 'pdfc-setting-actions');
        for (const [action, label, symbol, disabled] of [['up', 'Move ' + step.name + ' up', '↑', index === 0], ['down', 'Move ' + step.name + ' down', '↓', index === draft.steps.length - 1], ['remove', 'Remove ' + step.name, '×', false]]) {
          const button = make('button', 'pdfc-setting-move', symbol);button.type = 'button';button.dataset.settingAction = action;button.dataset.stepId = step.id;button.setAttribute('aria-label', label);button.disabled = disabled;actions.appendChild(button);
        }
        grid.appendChild(actions);fieldset.appendChild(grid);elements.settingsList.appendChild(fieldset);
      });
    }

    function draftSetup() {
      return validateSetup({ version: 1, autoDetect: elements.detect.checked, steps: state.draft.steps });
    }
    function addSetting(kind) {
      if (state.draft.steps.length >= 100) { setSettingsStatus('A setup can contain up to 100 items.', 'error');return; }
      const id = 'custom-' + Date.now().toString(36) + '-' + (++state.counter).toString(36);
      state.draft.steps.push(kind === 'pdf' ? { id, kind, name: 'New PDF type', keywords: [], pages: 1 } : { id, kind, name: 'Blank page', pages: 1 });
      renderSettings();setSettingsStatus('');
    }
    function saveSetup() {
      try {
        const next = draftSetup();state.setup = next;
        const ids = new Set(filesIn(next).map(step => step.id));
        for (const entry of state.entries) {
          if (entry.source !== 'manual' || !ids.has(entry.role)) { entry.role = matchFilename(entry.file.name, next);entry.source = 'auto'; }
        }
        elements.order.checked = false;elements.flatten.checked = false;elements.progress.hidden = true;
        let saved = true;try { root.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { saved = false; }
        elements.settings.open = false;renderSequence();renderFiles();refreshReview();
        if (!saved) setStatus('Setup changed for this tab, but could not be saved in this browser.', 'error');
      } catch (error) { setSettingsStatus(error.message || 'Check the setup.', 'error'); }
    }

    function download(data, name, type) {
      const url = URL.createObjectURL(new Blob([data], { type })), anchor = make('a');anchor.href = url;anchor.download = name;
      root.document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    async function generate() {
      const current = refreshReview();
      if (state.busy || !current.plan || elements.generate.disabled) return;
      const setupSnapshot = clone(state.setup), files = Object.fromEntries([...current.byRole].map(([id, entry]) => [id, entry.bytes]));
      let filename = textValue(elements.filename.value).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'Combined_Student_Documents.pdf';
      if (!/\.pdf$/i.test(filename)) filename += '.pdf';
      const flattenForms = elements.flatten.checked;setBusy(true);elements.progress.hidden = false;
      try {
        const PDF = await pdfLibrary();
        const result = await combineBytes(PDF, setupSnapshot, files, { flattenForms, onProgress(message, done, total) {
          elements.progressText.textContent = message;elements.progressBar.value = total ? Math.round(done / total * 100) : 0;
        } });
        download(result.bytes, filename, 'application/pdf');
        elements.progressText.textContent = 'Combined ' + result.people + ' student' + (result.people === 1 ? '' : 's') + ' into ' + result.totalPages + ' pages.';
        setStatus('Combined PDF ready to download.', 'success');
      } catch (error) {
        elements.progressText.textContent = error.message || 'The PDFs could not be combined.';setStatus(error.message || 'The PDFs could not be combined.', 'error');
      } finally { setBusy(false); }
    }

    elements.choose.addEventListener('click', () => elements.files.click());
    elements.files.addEventListener('change', event => { void addFiles(event.target.files);event.target.value = ''; });
    for (const eventName of ['dragenter', 'dragover']) elements.drop.addEventListener(eventName, event => { event.preventDefault();if (!state.busy) elements.drop.classList.add('is-dragging'); });
    elements.drop.addEventListener('dragleave', event => { if (!elements.drop.contains(event.relatedTarget)) elements.drop.classList.remove('is-dragging'); });
    elements.drop.addEventListener('drop', event => { event.preventDefault();elements.drop.classList.remove('is-dragging');void addFiles(event.dataTransfer?.files); });
    elements.clear.addEventListener('click', () => { if (state.busy) return;state.entries = [];elements.order.checked = false;elements.flatten.checked = false;elements.progress.hidden = true;renderSequence();renderFiles();refreshReview(); });
    elements.list.addEventListener('change', event => {
      const select = event.target.closest('select[data-file-role]');if (!select || state.busy) return;const entry = state.entries.find(item => item.id === select.dataset.fileRole);if (!entry) return;
      entry.role = select.value;entry.source = 'manual';elements.order.checked = false;elements.flatten.checked = false;refreshReview();
    });
    elements.list.addEventListener('click', event => {
      const button = event.target.closest('button[data-remove-file]');if (!button || state.busy) return;
      state.entries = state.entries.filter(item => item.id !== button.dataset.removeFile);elements.order.checked = false;elements.flatten.checked = false;elements.progress.hidden = true;renderSequence();renderFiles();refreshReview();
    });
    elements.openSettings.addEventListener('click', () => { if (state.busy) return;elements.settings.open = true;elements.settings.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    elements.settings.addEventListener('toggle', () => { if (elements.settings.open) { state.draft = clone(state.setup);renderSettings();setSettingsStatus(''); } });
    elements.settings.querySelector('summary').addEventListener('click', event => { if (state.busy) event.preventDefault(); });
    elements.detect.addEventListener('change', () => { if (state.draft) state.draft.autoDetect = elements.detect.checked; });
    elements.settingsList.addEventListener('input', event => {
      const input = event.target.closest('[data-setting]');if (!input || !state.draft) return;const step = state.draft.steps.find(item => item.id === input.dataset.stepId);if (!step) return;
      step[input.dataset.setting] = input.dataset.setting === 'keywords' ? input.value.split(',') : input.value;
    });
    elements.settingsList.addEventListener('click', event => {
      const button = event.target.closest('[data-setting-action]');if (!button || !state.draft) return;const index = state.draft.steps.findIndex(item => item.id === button.dataset.stepId);if (index < 0) return;
      const action = button.dataset.settingAction;if (action === 'remove') state.draft.steps.splice(index, 1);
      else { const target = index + (action === 'up' ? -1 : 1);if (target < 0 || target >= state.draft.steps.length) return;[state.draft.steps[index], state.draft.steps[target]] = [state.draft.steps[target], state.draft.steps[index]]; }
      renderSettings();setSettingsStatus('');
    });
    elements.addType.addEventListener('click', () => addSetting('pdf'));elements.addBlank.addEventListener('click', () => addSetting('blank'));
    elements.reset.addEventListener('click', () => { state.draft = clone(DEFAULT_SETUP);renderSettings();setSettingsStatus('Default setup loaded. Save setup to apply it.'); });
    elements.save.addEventListener('click', saveSetup);elements.cancel.addEventListener('click', () => { elements.settings.open = false; });
    elements.exportSetup.addEventListener('click', () => { try { download(JSON.stringify(draftSetup(), null, 2), 'PDF_Combine_Setup.json', 'application/json');setSettingsStatus('Setup downloaded.'); } catch (error) { setSettingsStatus(error.message, 'error'); } });
    elements.importSetup.addEventListener('click', () => elements.importFile.click());
    elements.importFile.addEventListener('change', async event => {
      const file = event.target.files?.[0];event.target.value = '';if (!file) return;
      try { if (file.size > 1024 * 1024) throw new Error('The setup file is too large.');state.draft = validateSetup(JSON.parse(await file.text()));renderSettings();setSettingsStatus('Setup loaded. Save setup to apply it.'); }
      catch (error) { setSettingsStatus(error.message || 'Could not read the setup file.', 'error'); }
    });
    elements.order.addEventListener('change', () => refreshReview(true));elements.flatten.addEventListener('change', () => refreshReview(true));elements.generate.addEventListener('click', () => void generate());
    renderSequence();renderFiles();refreshReview();if (warning) setStatus(warning, 'error');
  }

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', initialize, { once: true });else initialize();
})(typeof window === 'undefined' ? null : window);
