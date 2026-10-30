/* Central Hub reference adapter for BUIC Search Everything.
   Only allowlisted country/nationality/program/embassy reference worksheets are changed.
   Communication templates, private case data and locally imported workbooks
   are never transmitted to the Hub. */
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
  const FIELDS_EMBASSIES = {
    officeType: 'Office Type', countryEnglish: 'Country / Territory EN',
    countryThai: 'Country / Territory TH', cityEnglish: 'City EN', cityThai: 'City TH',
    displayNameEnglish: 'Display Name EN', officeNameEnglish: 'Office Name EN',
    addressEnglish: 'Address EN', officialNameThai: 'Official Name TH',
    currentOfficeType: 'Current Office Type', currentCountryEnglish: 'Current Country / Territory EN',
    currentCityEnglish: 'Current City EN', currentDisplayNameEnglish: 'Current Display Name EN',
    currentOfficeNameEnglish: 'Current Office Name EN', currentAddressEnglish: 'Current Address EN',
    currentOfficialNameThai: 'Current Official Name TH', webSourceUrl: 'Web Source URL',
    reconciliationStatus: 'Reconciliation Status', reconciliationNotes: 'Reconciliation Notes'
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
    const expected=new Set(remoteRows.flatMap(r=>(r.aliases||[]).map(a=>
      String(r.recordId)+'\u0000'+normalized(a))));
    for(const row of table.slice(1)){
      const compound=String(row[parent]??'')+'\u0000'+normalized(row[alias]);
      if(active>=0)row[active]=expected.has(compound)?'YES':'NO';
    }
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
  function applyRemote(local, countries, nationalities, programs, embassies = null) {
    // Apply legacy workbook corrections first. Published Hub fields must take precedence.
    window.applyBUICReferencePatches?.(local);
    const sheetCountry = tableIndex(local.Countries, 'Countries');
    const sheetProgram = tableIndex(local.Faculty_Major, 'Faculty_Major');
    const sheetEmbassy = embassies ? tableIndex(local.Embassy, 'Embassy') : null;
    // Validate the complete published release BEFORE updating a cloned workbook.
    const validateDataset=(remote,label,required)=>{
      if(!Array.isArray(remote)||remote.length>6000)throw Error(label+' invalid record count');
      const ids=new Set();
      for(const row of remote){
        if(!row||typeof row!=='object'||!/^[-A-Za-z0-9_]{2,80}$/.test(String(row.recordId||'')))
          throw Error(label+' has an invalid record ID');
        if(ids.has(row.recordId))throw Error(label+' contains duplicate record IDs');
        ids.add(row.recordId);
        for(const key of required)if(typeof row[key]!=='string'||!row[key].trim())
          throw Error(label+' '+row.recordId+' lacks '+key);
        if(row.aliases!==undefined&&(!Array.isArray(row.aliases)||
          row.aliases.some(a=>typeof a!=='string'||a.length>300)))
          throw Error(label+' '+row.recordId+' has invalid aliases');
      }
      return ids;
    };
    const countriesIds=validateDataset(countries,'Countries',['countryEnglish','countryThai']);
    const nationalitiesIds=validateDataset(nationalities,'Nationalities',['english','thai']);
    const programsIds=validateDataset(programs,'Programs',['programEnglish','facultyEnglish']);
    const embassyIds=embassies?validateDataset(embassies,'Embassies',['displayNameEnglish']):null;
    if(countriesIds.size!==nationalitiesIds.size||
       [...countriesIds].some(id=>!nationalitiesIds.has(id)))
      throw Error('Hub Countries and Nationalities IDs differ');
    for(const record of programs){
      const credit=record.credits?.['2026'];
      if(credit!=null&&(!Number.isInteger(credit)||credit<1||credit>600))
        throw Error('Invalid credits for '+record.recordId);
    }
    const syncRecords=(table,remote,ids)=>{
      const idColumn=table.headers.indexOf('Record ID'),active=table.headers.indexOf('Active');
      for(const [id,row] of table.ids){
        if(active>=0)row[active]=ids.has(id)?'YES':'NO';
      }
      for(const record of remote){
        if(table.ids.has(record.recordId))continue;
        const row=Array(table.headers.length).fill('');row[idColumn]=record.recordId;
        if(active>=0)row[active]='YES';
        table.ids.set(record.recordId,row);
        const target=table===sheetCountry?local.Countries:
          table===sheetProgram?local.Faculty_Major:local.Embassy;
        target.push(row);
      }
    };
    syncRecords(sheetCountry,countries,countriesIds);
    syncRecords(sheetProgram,programs,programsIds);
    if(embassies)syncRecords(sheetEmbassy,embassies,embassyIds);
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
    if (embassies) {
      for (const remote of embassies) {
        updateFields(sheetEmbassy.ids.get(remote.recordId), sheetEmbassy.headers, FIELDS_EMBASSIES, remote);
      }
    }
    insertAliases(local.Country_Aliases, 'Country Record ID', countries, 'Country_Aliases');
    insertAliases(local.Faculty_Aliases, 'Faculty/Major Record ID', programs, 'Faculty_Aliases');
    if (embassies) insertAliases(local.Embassy_Aliases, 'Embassy Record ID', embassies, 'Embassy_Aliases');
    return local;
  }

  async function update(sourceRows, force = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const meta = await getJson(BASE + '/api/v1/meta', controller.signal);
      if (!meta?.available || !Number.isSafeInteger(meta.version)) return { status:'unpublished' };
      if (!force && lastVersion === meta.version) return { status:'unchanged', version:meta.version };
      const datasets = ['countries','nationalities','programs'];
      if (Number(meta.datasets?.embassies || 0) > 0) datasets.push('embassies');
      const responses = await Promise.all(datasets.map(
        name => getJson(BASE + '/api/v1/reference/' + name, controller.signal)
      ));
      for (let i=0; i<responses.length; i++) {
        if (responses[i].version !== meta.version ||
            responses[i].dataset !== datasets[i] ||
            !Array.isArray(responses[i].records)) {
          throw new Error('Hub reference datasets have different publication versions');
        }
      }
      // Never mutate the active source until every available dataset passes validation.
      const merged = applyRemote(structuredClone(sourceRows), ...responses.map(r => r.records));
      lastVersion = meta.version;
      try{localStorage.setItem('buic-hub-last-applied-version-v1',String(meta.version));}catch{}
      return { status:'updated', version:meta.version, rows:merged };
    } finally {
      clearTimeout(timeout);
    }
  }

  window.BUICHubReference = Object.freeze({ update, baseUrl: BASE, getAppliedVersion:()=>lastVersion });
})();
