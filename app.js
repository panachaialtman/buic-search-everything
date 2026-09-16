(() => {
  'use strict';

  // 2026-09-15 data sync from Reference_Data abc.xlsx.
  // Keep the existing V4.6.12 app intact in app-core.js and apply only the staff-edited data delta here.
  const PATCHES = {"Countries":{"idColumn":"Record ID","ops":[{"id":"C180","values":{"Country TH":"คองโก","Full Country Name TH":"คองโก"}},{"id":"C237","values":{"Country TH":"ประเทษสหรัฐอเมริกา","Full Country Name TH":"ประเทศสหรัฐอเมริกา"}}]},"Country_Aliases":{"idColumn":"Alias ID","ops":[{"id":"CA2131","values":{"Alias":"คองโก (ไม่มีสาธารณรัฐ)"}},{"id":"CA2796","values":{"Alias":"ประเทษสหรัฐอเมริกา"}}]},"Embassy":{"idColumn":"Record ID","ops":[{"id":"E057","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานเอกอัครราชทูต ณ กรุงวอชิงตัน ประเทศสหรัฐอเมริกา"}},{"id":"E091","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานกงสุลใหญ่ ณ นครชิคาโก ประเทศสหรัฐอเมริกา"}},{"id":"E092","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานกงสุลใหญ่ ณ นครลอสแอนเจลิส ประเทศสหรัฐอเมริกา"}},{"id":"E093","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานกงสุลใหญ่ ณ นครนิวยอร์ก ประเทศสหรัฐอเมริกา"}},{"id":"E098","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา","Official Name TH":"สถานกงสุลใหญ่ ณ นครแอตแลนตา ประเทศสหรัฐอเมริกา"}},{"id":"E105","values":{"Country / Territory TH":"ประเทศสหรัฐอเมริกา"}}]},"Embassy_Aliases":{"idColumn":"Alias ID","ops":[{"id":"EA0462","values":{"Alias":"สถานเอกอัครราชทูต ณ กรุงวอชิงตัน ประเทศสหรัฐอเมริกา"}},{"id":"EA0464","values":{"Alias":"ประเทศสหรัฐอเมริกา"}},{"id":"EA0747","values":{"Alias":"สถานกงสุลใหญ่ ณ นครชิคาโก ประเทศสหรัฐอเมริกา"}},{"id":"EA0749","values":{"Alias":"ประเทศสหรัฐอเมริกา"}},{"id":"EA0755","values":{"Alias":"สถานกงสุลใหญ่ ณ นครลอสแอนเจลิส ประเทศสหรัฐอเมริกา"}},{"id":"EA0757","values":{"Alias":"ประเทศสหรัฐอเมริกา"}},{"id":"EA0763","values":{"Alias":"สถานกงสุลใหญ่ ณ นครนิวยอร์ก ประเทศสหรัฐอเมริกา"}},{"id":"EA0765","values":{"Alias":"ประเทศสหรัฐอเมริกา"}},{"id":"EA0803","values":{"Alias":"สถานกงสุลใหญ่ ณ นครแอตแลนตา ประเทศสหรัฐอเมริกา"}},{"id":"EA0805","values":{"Alias":"ประเทศสหรัฐอเมริกา"}}]}};

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

  // Communication V2 is layered on top of the stable core so the data sync and
  // original workspace behaviour remain isolated and easy to maintain.
  if (!document.querySelector('link[data-communication-v2]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'communication-v2.css';
    style.setAttribute('data-communication-v2', '');
    document.head.appendChild(style);
  }

  const core = document.createElement('script');
  core.src = 'app-core.js';
  core.async = false;
  core.onload = () => {
    const enhancement = document.createElement('script');
    enhancement.src = 'communication-v2.js';
    enhancement.async = false;
    document.head.appendChild(enhancement);
  };
  document.head.appendChild(core);
})();
