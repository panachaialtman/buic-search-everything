(() => {
  'use strict';

  const globeIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <path d="M3.9 12h16.2M12 3.75c2.2 2.15 3.35 4.9 3.35 8.25S14.2 18.1 12 20.25C9.8 18.1 8.65 15.35 8.65 12S9.8 5.9 12 3.75Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`;

  const copyIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8"/>
    </svg>`;

  function ensureActionFooter(card) {
    const details = card.querySelector(':scope > .card-collapsible');
    if (!details) return;

    let footer = details.querySelector(':scope > .reference-detail-actions');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'reference-detail-actions';
      details.appendChild(footer);
    }

    const source = card.querySelector(':scope > .card-head .source-link');
    if (source) {
      source.classList.add('reference-source-icon');
      source.innerHTML = globeIcon;
      source.title = 'Open source';
      source.setAttribute('aria-label', 'Open source');
      footer.appendChild(source);
    }

    const copyAll = card.querySelector(':scope > .card-head .copy-all-btn');
    if (copyAll) {
      copyAll.classList.add('reference-copy-all');
      copyAll.innerHTML = `${copyIcon}<span>ALL</span>`;
      copyAll.title = 'Copy all';
      copyAll.setAttribute('aria-label', 'Copy all');
      footer.appendChild(copyAll);
    }

    if (!footer.children.length) footer.remove();
  }

  function normalizeCard(card) {
    if (card.classList.contains('faculty-card') || card.classList.contains('embassy-card')) {
      card.classList.remove('card-span-2');
    }
    ensureActionFooter(card);
  }

  function decorateReferenceCards() {
    const results = document.getElementById('results');
    if (!results) return;
    results.querySelectorAll('.result-card').forEach(normalizeCard);
  }

  function start() {
    const results = document.getElementById('results');
    if (!results) return;

    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        decorateReferenceCards();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(results, { childList:true, subtree:true });
    schedule();

    document.addEventListener('click', event => {
      if (event.target.closest('[data-toggle-card], [data-expand-group], .tab, .degree-option')) schedule();
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
