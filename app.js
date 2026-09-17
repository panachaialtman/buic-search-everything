(() => {
  'use strict';

  // Base staff-data sync from Reference_Data abc.xlsx plus reviewed country/nationality corrections.
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

  apply(window.REFERENCE_SNAPSHOT);
  try {
    const key = 'bu-international-workspace-data-v4_6_12';
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && apply(saved)) localStorage.setItem(key, JSON.stringify(saved));
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

  function loadCore() {
    const core = document.createElement('script');
    core.src = 'app-core.js';
    core.async = false;
    core.onload = () => {
      const enhancement = document.createElement('script');
      enhancement.src = 'communication-v2.js';
      enhancement.async = false;
      enhancement.onload = () => {
        const v3 = document.createElement('script');
        v3.src = 'communication-v3.js';
        v3.async = false;
        document.head.appendChild(v3);
      };
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
