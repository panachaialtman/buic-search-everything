(() => {
  'use strict';

  const BREATHING_KEY = 'bu-reference-breathing-enabled-v1';
  const GRADIENT_KEY = 'bu-reference-gradient-enabled-v1';

  function readSetting(key, fallback = true) {
    try {
      const value = localStorage.getItem(key);
      if (value === '0') return false;
      if (value === '1') return true;
    } catch (_) {}
    return fallback;
  }

  function writeSetting(key, enabled) {
    try { localStorage.setItem(key, enabled ? '1' : '0'); } catch (_) {}
  }

  function applyEffectSettings() {
    const breathing = readSetting(BREATHING_KEY, true);
    const gradient = readSetting(GRADIENT_KEY, true);
    document.documentElement.setAttribute('data-reference-breathing', breathing ? 'on' : 'off');
    document.documentElement.setAttribute('data-reference-gradient', gradient ? 'on' : 'off');

    const breathingInput = document.querySelector('#themeBreathingToggle');
    const gradientInput = document.querySelector('#themeGradientToggle');
    if (breathingInput) breathingInput.checked = breathing;
    if (gradientInput) gradientInput.checked = gradient;
  }

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

  function ensureThemeEffectControls() {
    const menu = document.querySelector('#themeMenu');
    if (!menu || menu.querySelector('#themeEffectSettings')) return;

    const section = document.createElement('div');
    section.className = 'theme-effect-settings';
    section.id = 'themeEffectSettings';
    section.innerHTML = `
      <div class="theme-effect-title">Visual effects</div>
      <label class="theme-effect-row" for="themeBreathingToggle">
        <span><strong>Breathing</strong><small>Animated background movement</small></span>
        <span class="theme-effect-switch"><input id="themeBreathingToggle" type="checkbox"><i aria-hidden="true"></i></span>
      </label>
      <label class="theme-effect-row" for="themeGradientToggle">
        <span><strong>Gradient</strong><small>Background colour layers</small></span>
        <span class="theme-effect-switch"><input id="themeGradientToggle" type="checkbox"><i aria-hidden="true"></i></span>
      </label>`;
    menu.appendChild(section);

    section.querySelector('#themeBreathingToggle').addEventListener('change', e => {
      writeSetting(BREATHING_KEY, e.target.checked);
      applyEffectSettings();
    });
    section.querySelector('#themeGradientToggle').addEventListener('change', e => {
      writeSetting(GRADIENT_KEY, e.target.checked);
      applyEffectSettings();
    });

    applyEffectSettings();
  }

  function start() {
    applyEffectSettings();
    ensureBreathingLayer();
    ensureThemeEffectControls();
  }

  applyEffectSettings();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once:true});
  } else {
    start();
  }
})();
