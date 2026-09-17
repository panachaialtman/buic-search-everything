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
        XLSX.utils.book_append_sheet(book, sheet, String(name).slice(0, 31));
      }
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(book, `Reference_Data_${stamp}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('Could not export the Excel database. Please refresh the page and try again.');
    } finally {
      buttons.forEach(b => { b.disabled = false; b.textContent = b.dataset.oldText || 'Export data'; delete b.dataset.oldText; });
    }
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
          <p>The Vercel deployment already uses the maintained project data. Manual Excel upload/import is no longer part of the workflow.</p>
        </div>
      </div>
      <section class="data-export-only-card">
        <div class="data-export-icon" aria-hidden="true">▤</div>
        <div class="data-export-copy">
          <span class="data-export-kicker">CURRENT MASTER DATA</span>
          <h2>Reference_Data.xlsx</h2>
          <p>The export is generated from the same working data currently used by the website, including the latest approved corrections and Communication library changes.</p>
          <div class="data-export-meta"><span>Vercel deployment</span><span>•</span><span>No manual upload required</span><span>•</span><span>Excel kept in sync with chat changes</span></div>
        </div>
        <button class="primary-btn data-export-btn" data-export-master type="button">Export data</button>
      </section>`;
    $('[data-export-master]')?.addEventListener('click', exportCurrentData);
  }

  function replaceTopDataControl() {
    const old = $('#dataStatusBtn');
    if (!old || old.dataset.exportOnly === '1') return;
    const btn = old.cloneNode(false);
    btn.id = 'dataStatusBtn';
    btn.dataset.exportOnly = '1';
    btn.dataset.exportMaster = '';
    btn.className = 'ghost-btn data-status-compact data-export-top';
    btn.title = 'Export current Excel database';
    btn.innerHTML = '<span class="data-export-top-icon">⇩</span><span>Export data</span>';
    old.replaceWith(btn);
    btn.addEventListener('click', exportCurrentData);
  }

  function start() {
    simplifyDataWorkspace();
    replaceTopDataControl();
    const drawer = $('#dataDrawer');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
