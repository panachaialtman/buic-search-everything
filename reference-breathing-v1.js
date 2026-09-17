(() => {
  'use strict';

  function ensureBreathingLayer() {
    const shell = document.querySelector('.app-shell');
    if (!shell || shell.querySelector(':scope > .reference-ambient-blobs')) return;

    const layer = document.createElement('div');
    layer.className = 'reference-ambient-blobs';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `
      <span class="reference-ambient-blob blob-a"></span>
      <span class="reference-ambient-blob blob-b"></span>
      <span class="reference-ambient-blob blob-c"></span>
      <span class="reference-ambient-blob blob-d"></span>
      <span class="reference-ambient-blob blob-e"></span>`;

    shell.insertBefore(layer, shell.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureBreathingLayer, {once:true});
  } else {
    ensureBreathingLayer();
  }
})();
