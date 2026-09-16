(() => {
  'use strict';

  const RECENT_KEY = 'bu-ic-communication-recent-v2';
  const FAVORITE_KEY = 'bu-ic-communication-favorites-v1';
  const MAX_RECENT = 6;
  const SEARCH_LIMIT = 14;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clean = v => String(v ?? '').trim();
  const norm = v => clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function currentRows() {
    try {
      const saved = JSON.parse(localStorage.getItem('bu-international-workspace-data-v4_6_12') || 'null');
      if (saved && typeof saved === 'object') return saved;
    } catch {}
    return window.REFERENCE_SNAPSHOT || {};
  }

  function objectsFromSheet(name) {
    const table = currentRows()?.[name];
    if (!Array.isArray(table) || !Array.isArray(table[0])) return [];
    const header = table[0].map(clean);
    return table.slice(1).filter(Array.isArray).map(row => Object.fromEntries(header.map((h, i) => [h, row[i]])));
  }

  function getRecords(channel) {
    const sheet = channel === 'chat' ? 'Chat Reply Library' : 'Email Library';
    const idField = channel === 'chat' ? 'Chat ID' : 'Topic ID';
    return objectsFromSheet(sheet)
      .filter(r => clean(r.Active || 'YES').toUpperCase() !== 'NO')
      .map(r => ({
        ...r,
        _channel: channel,
        _id: clean(r[idField]) || clean(r.Topic),
        _category: clean(r.Topic).split('—')[0].trim() || 'Other',
        _option: clean(r.Topic).includes('—') ? clean(r.Topic).split('—').slice(1).join('—').trim() : clean(r.Topic)
      }));
  }

  function currentChannel() {
    return $('.comm-channel.active')?.dataset.channel === 'chat' ? 'chat' : 'email';
  }

  function storageRead(key) {
    try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }

  function storageWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function remember(record) {
    if (!record?._id) return;
    const key = `${record._channel}:${record._id}`;
    const list = storageRead(RECENT_KEY).filter(x => `${x.channel}:${x.id}` !== key);
    list.unshift({ channel: record._channel, id: record._id, topic: clean(record.Topic), ts: Date.now() });
    storageWrite(RECENT_KEY, list.slice(0, MAX_RECENT));
    renderMemory();
  }

  function favoriteKey(record) { return `${record._channel}:${record._id}`; }
  function favorites() { return storageRead(FAVORITE_KEY); }
  function isFavorite(record) { return favorites().some(x => `${x.channel}:${x.id}` === favoriteKey(record)); }
  function toggleFavorite(record) {
    if (!record) return;
    const key = favoriteKey(record);
    const list = favorites();
    const i = list.findIndex(x => `${x.channel}:${x.id}` === key);
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ channel: record._channel, id: record._id, topic: clean(record.Topic) });
    storageWrite(FAVORITE_KEY, list.slice(0, 12));
    renderMemory();
    renderSearch();
  }

  function recordByKey(channel, id) {
    return getRecords(channel).find(r => r._id === id) || null;
  }

  function buttonByAttr(rootSelector, attr, value) {
    const root = $(rootSelector);
    if (!root) return null;
    return $$(`[${attr}]`, root).find(el => el.getAttribute(attr) === value) || null;
  }

  function activateRecord(record) {
    if (!record) return;
    const channelButton = $$('.comm-channel').find(b => b.dataset.channel === record._channel);
    if (channelButton && !channelButton.classList.contains('active')) channelButton.click();

    setTimeout(() => {
      const categoryButton = buttonByAttr('#commCategoryList', 'data-comm-category', record._category);
      if (categoryButton) categoryButton.click();
      setTimeout(() => {
        const topicButton = buttonByAttr('#commTopicList', 'data-comm-id', record._id);
        if (topicButton) {
          topicButton.click();
          remember(record);
          $('#commGlobalSearch').value = '';
          closeSearchResults();
          $('.comm-builder-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 0);
    }, 0);
  }

  function searchRecords(query) {
    const q = norm(query);
    if (!q) return [];
    const words = q.split(' ').filter(Boolean);
    return getRecords(currentChannel())
      .map(r => {
        const hay = norm([r.Topic, r.Context, r['Email Subject'], r['Email Template'], r['Chat Reply Template']].filter(Boolean).join(' '));
        const score = words.reduce((sum, w) => sum + (norm(r.Topic).includes(w) ? 5 : 0) + (norm(r.Context).includes(w) ? 2 : 0) + (hay.includes(w) ? 1 : -8), 0);
        return { r, score, hay };
      })
      .filter(x => words.every(w => x.hay.includes(w)))
      .sort((a, b) => b.score - a.score || xTitle(a.r).localeCompare(xTitle(b.r)))
      .slice(0, SEARCH_LIMIT)
      .map(x => x.r);
  }

  function xTitle(r) { return clean(r._option || r.Topic); }

  function renderSearch() {
    const input = $('#commGlobalSearch');
    const panel = $('#commGlobalResults');
    if (!input || !panel) return;
    const q = clean(input.value);
    if (!q) { closeSearchResults(); return; }
    const rows = searchRecords(q);
    panel.innerHTML = rows.length ? rows.map(r => `
      <div class="comm-global-result" data-search-record="${esc(r._channel)}:${esc(r._id)}">
        <button class="comm-global-result-main" type="button" data-open-record="${esc(r._channel)}:${esc(r._id)}">
          <span class="comm-global-result-category">${esc(r._category)}</span>
          <strong>${esc(xTitle(r))}</strong>
          <small>${esc(clean(r['Email Subject'] || r.Context || ''))}</small>
        </button>
        <button class="comm-favorite-toggle ${isFavorite(r) ? 'active' : ''}" type="button" data-favorite-record="${esc(r._channel)}:${esc(r._id)}" title="${isFavorite(r) ? 'Remove favorite' : 'Add favorite'}" aria-label="${isFavorite(r) ? 'Remove favorite' : 'Add favorite'}">★</button>
      </div>`).join('') : '<div class="comm-global-empty">No template matches this search.</div>';
    panel.classList.remove('hidden');
  }

  function closeSearchResults() { $('#commGlobalResults')?.classList.add('hidden'); }

  function parseKey(key) {
    const i = String(key || '').indexOf(':');
    if (i < 0) return null;
    return recordByKey(key.slice(0, i), key.slice(i + 1));
  }

  function memoryPill(item, kind) {
    const r = recordByKey(item.channel, item.id);
    if (!r) return '';
    return `<button type="button" class="comm-memory-pill" data-open-record="${esc(item.channel)}:${esc(item.id)}" title="${esc(clean(r.Topic))}"><span>${kind === 'favorite' ? '★' : '↻'}</span>${esc(xTitle(r))}</button>`;
  }

  function renderMemory() {
    const recent = $('#commRecentTemplates');
    const fav = $('#commFavoriteTemplates');
    if (!recent || !fav) return;
    const rHtml = storageRead(RECENT_KEY).slice(0, MAX_RECENT).map(x => memoryPill(x, 'recent')).filter(Boolean).join('');
    const fHtml = favorites().slice(0, 6).map(x => memoryPill(x, 'favorite')).filter(Boolean).join('');
    recent.innerHTML = rHtml || '<span class="comm-memory-empty">Your recent templates appear here.</span>';
    fav.innerHTML = fHtml || '<span class="comm-memory-empty">Star useful templates from search.</span>';
  }

  function syncCommandbar() {
    const channel = currentChannel();
    const label = $('#commGlobalSearchLabel');
    const input = $('#commGlobalSearch');
    if (label) label.textContent = channel === 'email' ? 'Find any email template' : 'Find any chat reply';
    if (input) input.placeholder = channel === 'email' ? 'Search all email topics, subjects, or wording…' : 'Search all chat topics or wording…';
    $('#commQuickCopy')?.toggleAttribute('disabled', !$('.comm-topic-item.active'));
  }

  function buildUI() {
    const workspace = $('#workspaceCommunication');
    const layout = workspace?.querySelector('.comm-layout');
    if (!workspace || !layout || $('#commCommandbar')) return;
    layout.insertAdjacentHTML('beforebegin', `
      <section class="comm-commandbar" id="commCommandbar" aria-label="Communication quick tools">
        <div class="comm-global-search-wrap">
          <label id="commGlobalSearchLabel" for="commGlobalSearch">Find any email template</label>
          <div class="comm-global-search-box">
            <span aria-hidden="true">⌕</span>
            <input id="commGlobalSearch" type="search" autocomplete="off" placeholder="Search all email topics, subjects, or wording…" />
            <kbd>Ctrl K</kbd>
          </div>
          <div id="commGlobalResults" class="comm-global-results hidden"></div>
        </div>
        <div class="comm-quick-actions">
          <button id="commQuickNewStudent" class="ghost-btn compact" type="button">New student</button>
          <button id="commQuickCopy" class="primary-btn compact" type="button" disabled>Copy message</button>
        </div>
        <div class="comm-memory-strip">
          <div class="comm-memory-group"><span>Recent</span><div id="commRecentTemplates" class="comm-memory-pills"></div></div>
          <div class="comm-memory-group"><span>Favorites</span><div id="commFavoriteTemplates" class="comm-memory-pills"></div></div>
        </div>
      </section>`);

    $('#commGlobalSearch').addEventListener('input', renderSearch);
    $('#commGlobalSearch').addEventListener('focus', renderSearch);
    $('#commQuickNewStudent').addEventListener('click', () => $('#clearStudentCase')?.click());
    $('#commQuickCopy').addEventListener('click', () => $('#copyCommAll')?.click());

    $('#commCommandbar').addEventListener('click', e => {
      const open = e.target.closest('[data-open-record]');
      if (open) { activateRecord(parseKey(open.getAttribute('data-open-record'))); return; }
      const fav = e.target.closest('[data-favorite-record]');
      if (fav) { e.preventDefault(); e.stopPropagation(); toggleFavorite(parseKey(fav.getAttribute('data-favorite-record'))); }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.comm-global-search-wrap')) closeSearchResults();
    });

    document.addEventListener('keydown', e => {
      const workspaceActive = $('#workspaceCommunication')?.classList.contains('active');
      if (!workspaceActive) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('#commGlobalSearch')?.focus();
        $('#commGlobalSearch')?.select();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.shiftKey) {
        if ($('#commQuickCopy') && !$('#commQuickCopy').disabled) {
          e.preventDefault();
          $('#copyCommAll')?.click();
        }
      }
      if (e.key === 'Escape' && document.activeElement === $('#commGlobalSearch')) {
        $('#commGlobalSearch').value = '';
        closeSearchResults();
      }
    });

    $('#commTopicList')?.addEventListener('click', e => {
      const b = e.target.closest('[data-comm-id]');
      if (!b) return;
      setTimeout(() => {
        const r = recordByKey(currentChannel(), b.getAttribute('data-comm-id'));
        if (r) remember(r);
        syncCommandbar();
      }, 0);
    });

    $$('.comm-channel').forEach(b => b.addEventListener('click', () => setTimeout(() => {
      $('#commGlobalSearch').value = '';
      closeSearchResults();
      syncCommandbar();
      renderMemory();
    }, 0)));

    const observer = new MutationObserver(syncCommandbar);
    observer.observe($('#commTopicList'), { subtree: true, attributes: true, childList: true });
    renderMemory();
    syncCommandbar();
  }

  function start() {
    if ($('#workspaceCommunication') && $('#commTopicList')) buildUI();
    else setTimeout(start, 40);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
