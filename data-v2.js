(() => {
  'use strict';

  const DATA_KEY = 'bu-international-workspace-data-v4_6_12';
  const $ = s => document.querySelector(s);

  function currentRows() {
    try {
      const saved = JSON.parse(localStorage.getItem(DATA_KEY) || 'null');
      if (saved && typeof saved === 'object') return saved;
    } catch (_) {}
    return window.REFERENCE_SNAPSHOT || {};
  }

  function activeSheetCount(sheetName) {
    const table = currentRows()[sheetName];
    if (!Array.isArray(table) || table.length < 2 || !Array.isArray(table[0])) return 0;
    const header = table[0].map(v => String(v ?? '').trim());
    const activeIndex = header.indexOf('Active');
    return table.slice(1).filter(row => {
      if (!Array.isArray(row) || row.every(v => String(v ?? '').trim() === '')) return false;
      if (activeIndex < 0) return true;
      const value = String(row[activeIndex] ?? 'YES').trim().toUpperCase();
      return !value || value === 'YES';
    }).length;
  }

  function ensureSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-export-xlsx]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.XLSX), {once:true});
        existing.addEventListener('error', reject, {once:true});
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.async = true;
      script.dataset.exportXlsx = '';
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => reject(new Error('Could not load Excel export library.'));
      document.head.appendChild(script);
    });
  }

  async function exportCurrentData() {
    const buttons = Array.from(document.querySelectorAll('[data-export-master]'));
    buttons.forEach(b => { b.disabled = true; b.dataset.oldText = b.textContent; b.textContent = 'Preparing…'; });
    try {
      const XLSX = await ensureSheetJS();
      const source = currentRows();
      const book = XLSX.utils.book_new();
      for (const [name, table] of Object.entries(source)) {
        if (!Array.isArray(table) || !table.length || !Array.isArray(table[0])) continue;
        const sheet = XLSX.utils.aoa_to_sheet(table);

        // Staff exports show EVERY column, including internal and (auto) helper
        // columns. Only designated alias/reference-helper SHEETS are hidden.
        // Do not add !cols.hidden here; Excel users need the complete table.

        XLSX.utils.book_append_sheet(book, sheet, String(name).slice(0, 31));
      }

      // Hide only alias/reference-helper SHEETS. Every column in all sheets
      // remains visible, including (auto) helper fields in Faculty_Major.
      book.Workbook = book.Workbook || {};
      book.Workbook.Sheets = book.SheetNames.map(name => ({ Hidden: /aliases/i.test(name) ? 1 : 0 }));

      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(book, `Reference_Data_${stamp}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('Could not export the Excel database. Please refresh the page and try again.');
    } finally {
      buttons.forEach(b => { b.disabled = false; b.textContent = b.dataset.oldText || 'Export data'; delete b.dataset.oldText; });
    }
  }

  function openReferenceBrowse(type) {
    const referenceTab = document.querySelector('.workspace-tab[data-workspace="reference"]');
    if (referenceTab) referenceTab.click();
    requestAnimationFrame(() => {
      const sourceButton = document.querySelector(`#overview [data-browse-type="${type}"]`);
      if (sourceButton) sourceButton.click();
    });
  }

  function referenceSummaryMarkup() {
    const countryCount = activeSheetCount('Countries');
    const facultyCount = activeSheetCount('Faculty_Major');
    const embassyCount = activeSheetCount('Embassy');
    return `
      <section class="data-reference-summary" aria-labelledby="dataReferenceSummaryTitle">
        <div class="data-reference-summary-head">
          <div>
            <span class="data-reference-summary-kicker">REFERENCE COVERAGE</span>
            <h2 id="dataReferenceSummaryTitle">Current searchable records</h2>
            <p>A quick view of the reference data included in the current master database.</p>
          </div>
        </div>
        <div class="data-reference-metrics">
          <button class="data-reference-metric" data-data-browse-type="countries" type="button">
            <strong>${countryCount}</strong>
            <span>Country / territory records</span>
            <small>Browse records →</small>
          </button>
          <button class="data-reference-metric" data-data-browse-type="faculty" type="button">
            <strong>${facultyCount}</strong>
            <span>Faculty / major records</span>
            <small>Browse records →</small>
          </button>
          <button class="data-reference-metric" data-data-browse-type="embassy" type="button">
            <strong>${embassyCount}</strong>
            <span>Embassy / consular records</span>
            <small>Browse records →</small>
          </button>
        </div>
      </section>`;
  }

  function simplifyDataWorkspace() {
    const workspace = $('#workspaceData');
    if (!workspace || workspace.dataset.exportOnly === '1') return;
    workspace.dataset.exportOnly = '1';
    workspace.innerHTML = `
      <div class="workspace-page-heading data-export-heading">
        <div>
          <div class="hero-eyebrow">DATABASE</div>
          <h1>Export the current master database.</h1>
          <p>The deployed website already uses the maintained project data. Use this page only when you need an Excel copy of the current database.</p>
        </div>
      </div>
      <section class="data-export-only-card">
        <div class="data-export-icon" aria-hidden="true">▤</div>
        <div class="data-export-copy">
          <span class="data-export-kicker">CURRENT MASTER DATA</span>
          <h2>Reference_Data.xlsx</h2>
          <p>The export is generated from the same working data currently used by the website, including the latest approved corrections and Communication library changes.</p>
          <div class="data-export-meta"><span>Vercel deployment</span><span>•</span><span>No manual upload required</span><span>•</span><span>Alias sheets hidden by default</span></div>
        </div>
        <button class="primary-btn data-export-btn" data-export-master type="button">Export data</button>
      </section>
      ${referenceSummaryMarkup()}`;
    $('[data-export-master]')?.addEventListener('click', exportCurrentData);
    workspace.querySelectorAll('[data-data-browse-type]').forEach(button => {
      button.addEventListener('click', () => openReferenceBrowse(button.dataset.dataBrowseType));
    });
  }

  function openDatabasePage() {
    const dataTab = document.querySelector('.workspace-tab[data-workspace="data"]');
    if (dataTab) dataTab.click();
    requestAnimationFrame(() => $('#workspaceData')?.scrollIntoView({block:'start'}));
  }

  function replaceTopDataControl() {
    const old = $('#dataStatusBtn');
    if (!old || old.dataset.databaseLauncher === '1') return;
    const btn = old.cloneNode(false);
    btn.id = 'dataStatusBtn';
    btn.dataset.databaseLauncher = '1';
    btn.className = 'ghost-btn data-status-compact data-export-top';
    btn.title = 'Open database export page';
    btn.innerHTML = '<span class="data-export-top-icon">⇩</span><span>Export data</span>';
    old.replaceWith(btn);
    btn.addEventListener('click', openDatabasePage);
  }

  function cleanReferenceSearch() {
    document.querySelector('#overview .review-card')?.remove();
    document.querySelector('#reviewOnly')?.closest('.toggle-label')?.remove();
  }

  function cleanStudentDocuments() {
    document.querySelector('#workspaceDocuments .case-summary-card')?.remove();
  }

  function hideDataHeaderTab() {
    const tab = document.querySelector('.workspace-tab[data-workspace="data"]');
    if (tab) {
      tab.setAttribute('aria-hidden', 'true');
      tab.tabIndex = -1;
    }
  }

  function setupReferenceIdleState() {
    const body = document.body;
    const reference = $('#workspaceReference');
    const searchInput = $('#searchInput');
    const results = $('#resultsSection');
    if (!body || !reference || !searchInput || !results) return;

    const update = () => {
      const isReference = reference.classList.contains('active');
      const hasQuery = Boolean(searchInput.value.trim());
      const hasResults = !results.classList.contains('hidden');
      body.classList.toggle('reference-idle', isReference && !hasQuery && !hasResults);
    };

    searchInput.addEventListener('input', update);
    document.querySelectorAll('.workspace-tab').forEach(tab => tab.addEventListener('click', () => requestAnimationFrame(update)));
    new MutationObserver(update).observe(reference, {attributes:true, attributeFilter:['class']});
    new MutationObserver(update).observe(results, {attributes:true, attributeFilter:['class']});
    update();
  }

  function start() {
    simplifyDataWorkspace();
    replaceTopDataControl();
    cleanReferenceSearch();
    cleanStudentDocuments();
    hideDataHeaderTab();
    setupReferenceIdleState();
    const drawer = $('#dataDrawer');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
