(() => {
  'use strict';

  // Base staff-data sync from Reference_Data.xlsx plus reviewed country/nationality and faculty-name cleanup.
  const PATCHES = {
    "Countries": {
      "idColumn": "Record ID",
      "ops": [
        {"id":"C083","values":{"Nationality TH":"เยอรมนี"}},
        {"id":"C099","values":{"Nationality TH":"ฮ่องกง"}},
        {"id":"C129","values":{"Nationality TH":"มาเก๊า"}},
        {"id":"C154","values":{"Nationality TH":"เนเธอร์แลนด์"}},
        {"id":"C180","values":{"Country TH":"คองโก","Full Country Name TH":"คองโก"}},
        {"id":"C236","values":{"Nationality TH":"อังกฤษ"}},
        {"id":"C237","values":{"Country TH":"ประเทศสหรัฐอเมริกา","Full Country Name TH":"ประเทศสหรัฐอเมริกา","Nationality TH":"อเมริกา"}}
      ]
    },
    "Country_Aliases": {
      "idColumn": "Alias ID",
      "ops": [
        {"id":"CA0984","values":{"Alias":"เยอรมนี"}},
        {"id":"CA1154","values":{"Alias":"ฮ่องกง"}},
        {"id":"CA1519","values":{"Alias":"มาเก๊า"}},
        {"id":"CA1815","values":{"Alias":"เนเธอร์แลนด์"}},
        {"id":"CA2131","values":{"Alias":"คองโก (ไม่มีสาธารณรัฐ)"}},
        {"id":"CA2785","values":{"Alias":"อังกฤษ"}},
        {"id":"CA2796","values":{"Alias":"ประเทศสหรัฐอเมริกา"}},
        {"id":"CA2801","values":{"Alias":"อเมริกา"}}
      ]
    },
    "Faculty_Major": {
      "idColumn": "Record ID",
      "ops": [
        {"id":"FM001","values":{"(auto) Faculty EN Copy":"BU International"}},
        {"id":"FM002","values":{"(auto) Faculty EN Copy":"BU International"}},
        {"id":"FM003","values":{"(auto) Faculty EN Copy":"BU International"}},
        {"id":"FM004","values":{"(auto) Faculty EN Copy":"BU International"}},
        {"id":"FM005","values":{"(auto) Faculty EN Copy":"BU International"}},
        {"id":"FM006","values":{"(auto) Faculty EN Copy":"BU International"}},
        {"id":"FM007","values":{"(auto) Faculty EN Copy":"BU International"}},
        {"id":"FM033","values":{"Faculty EN":"BU International","(auto) Faculty EN Copy":"BU International","Reconciliation Notes":"Faculty name normalized to BU International to match the staff master naming; previous expanded wording remains available only as a search alias."}},
        {"id":"FM034","values":{"Faculty EN":"BU International","(auto) Faculty EN Copy":"BU International","Reconciliation Notes":"Faculty name normalized to BU International to match the staff master naming; previous expanded wording remains available only as a search alias."}},
        {"id":"FM035","values":{"(auto) Faculty EN Copy":"BU International"}}
      ]
    },
    "Embassy": {
      "idColumn": "Record ID",
      "ops": [
        {"id":"E057","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานเอกอัครราชทูต ณ กรุงวอชิงตัน ประเทศสหรัฐอเมริกา"}},
        {"id":"E091","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานกงสุลใหญ่ ณ นครชิคาโก ประเทศสหรัฐอเมริกา"}},
        {"id":"E092","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานกงสุลใหญ่ ณ นครลอสแอนเจลิส ประเทศสหรัฐอเมริกา"}},
        {"id":"E093","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานกงสุลใหญ่ ณ นครนิวยอร์ก ประเทศสหรัฐอเมริกา"}},
        {"id":"E098","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานกงสุลใหญ่ ณ นครแอตแลนตา ประเทศสหรัฐอเมริกา"}},
        {"id":"E105","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา"}}
      ]
    },
    "Embassy_Aliases": {
      "idColumn": "Alias ID",
      "ops": [
        {"id":"EA0462","values":{"Alias":"สถานเอกอัครราชทูต ณ กรุงวอชิงตัน ประเทศสหรัฐอเมริกา"}},
        {"id":"EA0464","values":{"Alias":"ประเทศสหรัฐอเมริกา"}},
        {"id":"EA0747","values":{"Alias":"สถานกงสุลใหญ่ ณ นครชิคาโก ประเทศสหรัฐอเมริกา"}},
        {"id":"EA0749","values":{"Alias":"ประเทศสหรัฐอเมริกา"}},
        {"id":"EA0755","values":{"Alias":"สถานกงสุลใหญ่ ณ นครลอสแอนเจลิส ประเทศสหรัฐอเมริกา"}},
        {"id":"EA0757","values":{"Alias":"ประเทศสหรัฐอเมริกา"}},
        {"id":"EA0763","values":{"Alias":"สถานกงสุลใหญ่ ณ นครนิวยอร์ก ประเทศสหรัฐอเมริกา"}},
        {"id":"EA0765","values":{"Alias":"ประเทศสหรัฐอเมริกา"}},
        {"id":"EA0803","values":{"Alias":"สถานกงสุลใหญ่ ณ นครแอตแลนตา ประเทศสหรัฐอเมริกา"}},
        {"id":"EA0805","values":{"Alias":"ประเทศสหรัฐอเมริกา"}}
      ]
    }
  };

  function normalizeFacultyNames(rows) {
    const table = rows && rows['Faculty_Major'];
    if (!Array.isArray(table) || !Array.isArray(table[0])) return false;
    const header = table[0];
    const col = Object.fromEntries(header.map((name, i) => [String(name ?? ''), i]));
    const facultyIndex = col['Faculty EN'];
    const autoIndex = col['(auto) Faculty EN Copy'];
    const legacyAutoIndex = col['Faculty EN Copy'];
    if (facultyIndex === undefined) return false;

    const canonical = value => {
      const v = String(value ?? '').trim();
      if (!v) return v;
      if (v === 'Bangkok University International College') return 'BU International';
      if (v === 'Bangkok University Chinese International') return 'BU Chinese International';
      if (/^School of\s+/i.test(v)) return v.replace(/^School of\s+/i, '');
      return v;
    };

    let changed = false;
    for (const row of table.slice(1)) {
      if (!Array.isArray(row)) continue;
      const nextFaculty = canonical(row[facultyIndex]);
      if (row[facultyIndex] !== nextFaculty) {
        row[facultyIndex] = nextFaculty;
        changed = true;
      }
      for (const i of [autoIndex, legacyAutoIndex]) {
        if (i === undefined) continue;
        const nextAuto = canonical(row[i]);
        if (row[i] !== nextAuto) {
          row[i] = nextAuto;
          changed = true;
        }
      }
    }
    return changed;
  }

  function apply(rows) {
    if (!rows || typeof rows !== 'object') return false;
    let changed = false;
    for (const [sheet, spec] of Object.entries(PATCHES)) {
      const table = rows[sheet];
      if (!Array.isArray(table) || !Array.isArray(table[0])) continue;
      const header = table[0];
      const col = Object.fromEntries(header.map((name, i) => [String(name ?? ''), i]));
      const idIndex = col[spec.idColumn];
      if (idIndex === undefined) continue;
      for (const op of spec.ops) {
        const row = table.slice(1).find(r => Array.isArray(r) && String(r[idIndex] ?? '') === op.id);
        if (!row) continue;
        for (const [field, value] of Object.entries(op.values || {})) {
          const i = col[field];
          if (i === undefined) continue;
          if (row[i] !== value) { row[i] = value; changed = true; }
        }
      }
    }
    return changed;
  }

  window.applyBUICReferencePatches = rows => { apply(rows); normalizeFacultyNames(rows); };
  window.applyBUICReferencePatches(window.REFERENCE_SNAPSHOT);
  try {
    const key = 'bu-international-workspace-data-v4_6_12';
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved) { const changed = apply(saved) || normalizeFacultyNames(saved); if (changed) localStorage.setItem(key, JSON.stringify(saved)); }
  } catch (_) {}

  for (const [version, href] of [
    ['v2','communication-v2.css'],
    ['v3','communication-v3.css'],
    ['v4','communication-v4.css']
  ]) {
    if (!document.querySelector(`link[data-communication-${version}]`)) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = href;
      style.setAttribute(`data-communication-${version}`, '');
      document.head.appendChild(style);
    }
  }
  if (!document.querySelector('link[data-data-v2]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'data-v2.css';
    style.setAttribute('data-data-v2', '');
    document.head.appendChild(style);
  }
  if (!document.querySelector('link[data-reference-layout-v6]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'reference-layout-v6.css';
    style.setAttribute('data-reference-layout-v6', '');
    document.head.appendChild(style);
  }
  if (!document.querySelector('script[data-reference-layout-v6]')) {
    const layout = document.createElement('script');
    layout.src = 'reference-layout-v6.js';
    layout.async = false;
    layout.setAttribute('data-reference-layout-v6', '');
    document.head.appendChild(layout);
  }
  if (!document.querySelector('link[data-reference-breathing-v1]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'reference-breathing-v1.css';
    style.setAttribute('data-reference-breathing-v1', '');
    document.head.appendChild(style);
  }
  if (!document.querySelector('script[data-reference-breathing-v1]')) {
    const breathing = document.createElement('script');
    breathing.src = 'reference-breathing-v1.js';
    breathing.async = false;
    breathing.setAttribute('data-reference-breathing-v1', '');
    document.head.appendChild(breathing);
  }

  function loadDataV2() {
    const script = document.createElement('script');
    script.src = 'data-v2.js';
    script.async = false;
    document.head.appendChild(script);
  }

  function loadCore() {
    const core = document.createElement('script');
    core.src = 'app-core.js?v=20260921-searchfix';
    core.async = false;
    core.onload = () => {
      const enhancement = document.createElement('script');
      enhancement.src = 'communication-v2.js';
      enhancement.async = false;
      enhancement.onload = () => {
        const v3 = document.createElement('script');
        v3.src = 'communication-v3.js';
        v3.async = false;
        v3.onload = loadDataV2;
        v3.onerror = loadDataV2;
        document.head.appendChild(v3);
      };
      enhancement.onerror = loadDataV2;
      document.head.appendChild(enhancement);
    };
    document.head.appendChild(core);
  }

  const review = document.createElement('script');
  review.src = 'communication-v4.js';
  review.async = false;
  review.onload = loadCore;
  review.onerror = loadCore;
  document.head.appendChild(review);
})();
