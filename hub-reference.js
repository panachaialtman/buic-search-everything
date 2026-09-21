/* Central Hub reference adapter for BUIC Search Everything.
   Only the allowlisted country/nationality/program worksheets are changed.
   Embassy records, communication templates, private case data and locally
   imported workbooks are never transmitted to the Hub. */
(() => {
  'use strict';
  const BASE = 'https://buic-central-hub.vercel.app';
  const FIELDS_COUNTRIES = {
    countryEnglish: 'Country EN', countryThai: 'Country TH',
    fullCountryEnglish: 'Full Country Name EN', fullCountryThai: 'Full Country Name TH',
    capitalEnglish: 'Capital EN', capitalThai: 'Capital TH',
    nationalityEnglish: 'Nationality EN', nationalityThai: 'Nationality TH',
    isoAlpha2: 'ISO Alpha-2', isoAlpha3: 'ISO Alpha-3'
  };
  const FIELDS_PROGRAMS = {
    facultyEnglish: 'Faculty EN', facultyThai: 'Faculty TH',
    facultyCode: 'Faculty Abbreviation', programEnglish: 'Major EN',
    programThai: 'Major TH', additionalNotes: 'Additional / Notes',
    sourceProgramType: 'Program Type', creditSourceUrl: 'Credits Source URL',
    creditSourceStatus: 'Credits Status'
  };
  let lastVersion = null;
  const normalized = text => String(text ?? '').trim().toLocaleLowerCase('en');

  async function getJson(url, signal) {
    const response = await fetch(url, { mode:'cors', credentials:'omit', cache:'no-store', signal });
    if (!response.ok) throw new Error('Hub returned HTTP ' + response.status);
    return response.json();
  }

  function tableIndex(table, label) {
    if (!Array.isArray(table) || !Array.isArray(table[0])) throw new Error('Missing local ' + label + ' sheet');
    const headers = table[0].map(value => String(value ?? ''));
    const ids = new Map();
    const idColumn = headers.indexOf('Record ID');
    if (idColumn < 0) throw new Error('Missing Record ID in ' + label);
    for (const row of table.slice(1)) {
      if (!Array.isArray(row)) continue;
      const id = String(row[idColumn] ?? '');
      if (id) ids.set(id, row);
    }
    return { headers, ids };
  }
  function updateFields(row, headers, mapping, remote) {
    for (const [key, column] of Object.entries(mapping)) {
      const i = headers.indexOf(column);
      if (i >= 0 && remote[key] !== undefined) row[i] = remote[key] ?? '';
    }
  }
  function insertAliases(table, parentColumn, remoteRows, label) {
    if (!Array.isArray(table) || !Array.isArray(table[0])) throw new Error('Missing alias sheet: ' + label);
    const headers = table[0];
    const parent = headers.indexOf(parentColumn);
    const alias = headers.indexOf('Alias');
    const idCol = headers.indexOf('Alias ID');
    const active = headers.indexOf('Active');
    const language = headers.indexOf('Language');
    if (parent < 0 || alias < 0 || idCol < 0) throw new Error('Invalid alias sheet: ' + label);
    const existing = new Set(table.slice(1).map(row => String(row[parent] ?? '') + '\u0000' + normalized(row[alias])));
    const usedIds = new Set(table.slice(1).map(row => String(row[idCol] ?? '')));
    let added = 0;
    for (const remote of remoteRows) {
      for (const value of (remote.aliases || [])) {
        const text = String(value ?? '').trim();
        const compound = String(remote.recordId) + '\u0000' + normalized(text);
        if (!text || existing.has(compound)) continue;
        const newRow = Array(headers.length).fill('');
        newRow[parent] = remote.recordId;
        newRow[alias] = text;
        let newId;
        do { newId = 'HUB_' + label.replace(/\W/g, '') + '_' + remote.recordId + '_' + (++added); } while (usedIds.has(newId));
        newRow[idCol] = newId;
        usedIds.add(newId);
        if (active >= 0) newRow[active] = 'YES';
        if (language >= 0) newRow[language] = /[\u0e00-\u0e7f]/.test(text) ? 'TH' : 'EN';
        table.push(newRow);
        existing.add(compound);
      }
    }
  }
  function applyRemote(local, countries, nationalities, programs) {
    const sheetCountry = tableIndex(local.Countries, 'Countries');
    const sheetProgram = tableIndex(local.Faculty_Major, 'Faculty_Major');
    const matchSet = (table, remote, label) => {
      const activeIndex = table.headers.indexOf('Active');
      const keys = [...table.ids.entries()].filter(([,row]) =>
        activeIndex < 0 || String(row[activeIndex] ?? 'YES').trim().toUpperCase() !== 'NO'
      ).map(([id]) => id);
      const remoteIds = remote.map(row => row.recordId);
      if (remoteIds.length !== keys.length ||
          new Set(remoteIds).size !== remoteIds.length ||
          keys.some(key => !remoteIds.includes(key))) {
        throw new Error(label + ' record IDs differ from the local master; update the full workbook before enabling this Hub version');
      }
    };
    if (countries.length !== nationalities.length ||
        countries.some((country, i) => country.recordId !== nationalities[i]?.recordId)) {
      throw new Error('Hub country and nationality datasets do not align');
    }
    matchSet(sheetCountry, countries, 'Country');
    matchSet(sheetProgram, programs, 'Program');
    for (const remote of countries) {
      updateFields(sheetCountry.ids.get(remote.recordId), sheetCountry.headers, FIELDS_COUNTRIES, remote);
    }
    for (const remote of programs) {
      const row = sheetProgram.ids.get(remote.recordId);
      updateFields(row, sheetProgram.headers, FIELDS_PROGRAMS, remote);
      const credit = remote.credits?.['2026'];
      if (credit !== null && credit !== undefined &&
          (!Number.isInteger(credit) || credit < 1 || credit > 600)) {
        throw new Error('Invalid 2026 credit value for ' + remote.recordId);
      }
      const creditIndex = sheetProgram.headers.indexOf('Credits Required (2026/2569)');
      if (creditIndex >= 0) row[creditIndex] = credit ?? '';
      // Source-status fields are imported, but unknown credits remain blank.
    }
    insertAliases(local.Country_Aliases, 'Country Record ID', countries, 'Country_Aliases');
    insertAliases(local.Faculty_Aliases, 'Faculty/Major Record ID', programs, 'Faculty_Aliases');
    // Reapply the original website's reviewed corrections after the source fields.
    window.applyBUICReferencePatches?.(local);
    return local;
  }

  async function update(sourceRows, force = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const meta = await getJson(BASE + '/api/v1/meta', controller.signal);
      if (!meta?.available || !Number.isSafeInteger(meta.version)) return { status:'unpublished' };
      if (!force && lastVersion === meta.version) return { status:'unchanged', version:meta.version };
      const responses = await Promise.all(['countries','nationalities','programs'].map(
        name => getJson(BASE + '/api/v1/reference/' + name, controller.signal)
      ));
      for (let i=0; i<responses.length; i++) {
        if (responses[i].version !== meta.version ||
            responses[i].dataset !== ['countries','nationalities','programs'][i] ||
            !Array.isArray(responses[i].records)) {
          throw new Error('Hub reference datasets have different publication versions');
        }
      }
      // Never mutate the active source until all three datasets pass validation.
      const merged = applyRemote(structuredClone(sourceRows), ...responses.map(r => r.records));
      lastVersion = meta.version;
      return { status:'updated', version:meta.version, rows:merged };
    } finally {
      clearTimeout(timeout);
    }
  }

  window.BUICHubReference = Object.freeze({ update, baseUrl: BASE });
})();
