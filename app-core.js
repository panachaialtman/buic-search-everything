(() => {
  'use strict';

  const TARGET_SHEETS = ['Countries','Country_Aliases','Faculty_Major','Faculty_Aliases','Embassy','Embassy_Aliases','Data_Status','Settings','Communication Overview','Email Library','Chat Reply Library','Document Options','Website Selector Map'];
  const STORAGE_KEY = 'bu-international-workspace-data-v4_6_12';
  const STORAGE_META_KEY = 'bu-international-workspace-meta-v4_6_12';
  const IMPORT_HISTORY_KEY = 'bu-international-workspace-import-history-v4_6_12';
  const IMPORT_HISTORY_LIMIT = 2;
  const RECENT_KEY = 'bu-reference-search-recent-v3';
  const LEGACY_RECENT_KEY = 'bu-reference-search-recent-v2';
  const THEME_KEY = 'bu-international-workspace-theme-v4_1';
  const SIGNATURES_KEY = 'bu-ic-signature-library-v1';
  const SIGNATURE_DEFAULTS_KEY = 'bu-ic-signature-defaults-v1';
  const RECENT_LIMIT = 30;
  const PREVIEW_ALL = 5;
  const PREVIEW_TAB = 12;
  const REQUIRED_COLUMNS = {
    Countries:['Record ID','Country EN','Country TH','Active'],
    Faculty_Major:['Record ID','Faculty EN','Faculty TH','Major EN','Major TH','Degree Level','Active'],
    Embassy:['Record ID','Display Name EN','Official Name TH','Active'],
    Country_Aliases:['Country Record ID','Alias','Active'],
    Faculty_Aliases:['Faculty/Major Record ID','Alias','Active'],
    Embassy_Aliases:['Embassy Record ID','Alias','Active'],
    'Email Library':['Topic ID','Topic','Email Template','Active'],
    'Chat Reply Library':['Chat ID','Topic','Chat Reply Template','Active'],
    'Document Options':['Document ID','Document Option','Active']
  };

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const yes = v => String(v ?? '').trim().toUpperCase() === 'YES';
  const clean = v => String(v ?? '').trim();
  const normalize = v => clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’'`]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const tokens = v => normalize(v).split(' ').filter(Boolean);
  // V4.6.8: Faculty EN / Major EN are the user-editable source of truth.
  // Hidden (auto) fallback columns are internal only. Old header names remain supported for imported legacy workbooks.
  const autoFacultyENCopy = r => clean(r['(auto) Faculty EN Copy'] || r['Faculty EN Copy']);
  const autoMajorENCopy = r => clean(r['(auto) Major EN Copy'] || r['Major EN Copy']);
  const facultyENValue = r => {
    const primary=clean(r['Faculty EN']);
    return primary ? primary.replace(/^School of\s+/i,'') : autoFacultyENCopy(r);
  };
  const majorENValue = r => {
    const primary=clean(r['Major EN']);
    return primary ? primary.replace(/^Master of\s+/i,'') : autoMajorENCopy(r);
  };

  let sourceRows = null;
  let data = null;
  let activeTab = 'all';
  let query = '';
  let showInactive = false;
  let reviewOnly = false;
  let degreeFilter = 'all';
  let sourceMeta = { type:'bundled', title:'Bundled data', detail:'Current V4.6.12 workbook snapshot included with this website.' };
  let toastTimer;
  let recentTimer;
  let lastQuery = '';
  let lastGroups = {};
  let destinationHandle = null;
  let activeWorkspace = 'reference';
  let commChannel = 'email';
  let selectedCommId = '';
  let selectedCommCategory = '';
  let browseMode = false;
  let commDraftDirty = false;
  let commSubjectDirty = false;
  let lastValidationReport = {errors:[],warnings:[],label:'Bundled V4.6.12 workbook loaded.'};
  let suggestionItems = [];
  let suggestionIndex = -1;
  let commFieldValues = {};
  let commSelectedDocs = new Set();
  let signatures = [];
  let signatureDefaults = { email:'', chat:'none' };
  let signatureEditorId = '';
  const expandedGroups = new Set();
  const expandedCards = new Set();
  const flagColorCache = new Map();
  const countryCodeCache = new Map();
  const recordLookup = new Map();
  const floatingWindows = new Map();
  let windowZCounter = 3000;
  let dragState = null;

  const FLAG_ACCENTS = {"AD":"248,217,95","AE":"237,85,101","AF":"87,168,99","AG":"237,85,101","AI":"1,36,126","AL":"237,85,101","AM":"255,207,83","AN":"1,36,126","AO":"207,16,41","AQ":"55,123,209","AR":"137,187,227","AS":"32,33,97","AT":"237,85,101","AU":"71,88,169","AW":"65,135,222","AX":"34,93,154","AZ":"70,87,169","BA":"71,88,169","BB":"71,88,169","BD":"87,168,99","BE":"237,85,101","BF":"237,85,101","BG":"237,85,101","BH":"237,85,101","BI":"82,193,98","BJ":"87,168,99","BL":"46,93,162","BM":"205,16,40","BN":"255,207,83","BO":"237,85,101","BQ":"39,95,150","BR":"82,193,98","BS":"59,175,218","BT":"247,215,96","BV":"237,25,34","BW":"59,175,218","BY":"237,85,101","BZ":"71,88,169","CA":"237,85,101","CC":"1,127,0","CD":"70,88,169","CF":"248,216,96","CG":"237,85,101","CH":"237,85,101","CI":"252,171,87","CK":"1,15,90","CL":"237,85,101","CM":"237,85,101","CN":"237,85,101","CO":"248,189,64","CR":"71,88,169","CU":"70,87,169","CV":"71,88,169","CW":"36,79,146","CX":"1,30,174","CY":"237,85,101","CZ":"237,85,101","DE":"248,190,64","DJ":"82,193,98","DK":"237,85,101","DM":"82,193,98","DO":"237,85,101","DZ":"88,168,99","EC":"243,214,96","EE":"59,175,218","EG":"237,85,101","EH":"203,3,6","ER":"237,85,101","ES":"255,207,83","ET":"82,193,98","FI":"70,87,169","FJ":"71,88,169","FK":"1,36,125","FM":"59,175,218","FO":"239,41,52","FR":"237,85,101","GA":"70,87,169","GB":"40,63,116","GD":"249,219,96","GE":"237,85,101","GF":"254,223,7","GH":"237,85,101","GI":"219,1,10","GL":"207,16,41","GM":"237,85,101","GN":"247,215,96","GP":"255,39,55","GQ":"237,85,101","GR":"66,132,217","GS":"1,36,126","GT":"138,187,228","GU":"2,122,192","GW":"247,215,96","GY":"82,193,98","HK":"221,40,15","HM":"59,90,162","HN":"59,175,218","HR":"237,85,101","HT":"71,88,169","HU":"237,85,101","ID":"237,85,101","IE":"252,110,81","IL":"70,88,169","IN":"252,110,81","IO":"1,2,102","IQ":"237,85,101","IR":"237,87,102","IS":"71,88,169","IT":"237,85,101","JM":"82,193,98","JO":"87,168,99","JP":"237,85,101","KE":"237,85,101","KG":"237,85,101","KH":"71,88,169","KI":"237,85,101","KM":"71,88,169","KN":"237,85,101","KP":"237,87,102","KR":"237,86,101","KW":"87,168,99","KY":"2,33,114","KZ":"59,175,218","LA":"237,85,101","LB":"237,85,101","LC":"59,175,218","LI":"237,85,101","LK":"237,85,101","LR":"236,62,80","LS":"71,88,169","LT":"247,188,65","LU":"59,175,218","LV":"179,42,56","LY":"237,85,101","MA":"237,85,101","MC":"237,85,101","MD":"72,137,221","ME":"237,85,101","MF":"46,93,162","MG":"237,85,101","MH":"71,88,169","MK":"237,85,101","ML":"248,216,96","MM":"247,215,96","MN":"237,85,101","MO":"2,120,94","MP":"59,90,162","MQ":"32,63,140","MR":"87,168,99","MS":"1,2,101","MT":"237,85,101","MU":"249,218,95","MV":"237,85,101","MW":"87,168,99","MX":"237,85,101","MY":"236,62,80","MZ":"247,215,96","NA":"70,88,169","NC":"17,135,0","NE":"252,110,81","NF":"17,135,0","NG":"87,168,99","NI":"73,137,220","NL":"73,137,220","NO":"237,85,101","NP":"237,86,102","NR":"71,88,169","NU":"252,209,24","NZ":"71,88,169","OM":"237,85,101","PA":"237,86,101","PE":"237,85,101","PF":"207,16,41","PG":"237,85,101","PH":"71,88,169","PK":"87,168,99","PL":"237,85,101","PM":"8,150,202","PN":"1,36,126","PR":"247,3,3","PS":"35,126,72","PT":"237,85,101","PW":"59,175,218","PY":"73,137,220","QA":"165,68,118","RE":"50,102,255","RO":"237,85,101","RS":"237,85,101","RU":"237,85,101","RW":"59,175,218","SA":"88,168,99","SB":"87,168,99","SC":"237,85,101","SD":"237,85,101","SE":"72,137,221","SG":"237,85,101","SH":"1,2,102","SI":"237,85,101","SJ":"239,41,52","SK":"237,85,101","SL":"73,137,220","SM":"59,175,218","SN":"237,85,101","SO":"74,137,220","SR":"87,168,99","SS":"87,168,99","ST":"87,168,99","SV":"73,137,220","SX":"200,42,59","SY":"237,85,101","SZ":"70,87,169","TC":"1,2,102","TD":"237,85,101","TF":"1,38,90","TG":"254,207,83","TH":"70,87,169","TJ":"237,85,101","TK":"1,36,126","TL":"237,85,101","TM":"87,168,99","TN":"237,85,101","TO":"237,85,101","TP":"219,32,30","TR":"237,85,101","TT":"237,85,101","TV":"59,175,218","TW":"237,85,101","TY":"221,40,15","TZ":"72,137,221","UA":"247,215,95","UG":"249,193,62","UK":"71,88,169","UM":"1,48,153","US":"237,85,101","UY":"71,88,169","UZ":"82,193,98","VA":"254,223,7","VC":"255,207,83","VE":"247,215,96","VG":"1,2,100","VI":"223,221,16","VN":"237,85,101","VU":"237,85,101","WF":"239,41,52","WS":"237,85,101","XK":"38,92,166","YE":"237,85,101","ZA":"237,85,101","ZM":"82,193,98","ZR":"70,183,45","ZW":"82,193,98"};

  function flagMarkup(iso2) {
    const code=clean(iso2).toLowerCase();
    if(!/^[a-z]{2}$/.test(code)) return `<span class="country-flag flag-fallback" aria-hidden="true">◇</span>`;
    return `<span class="flag flag-${esc(code)} country-flag" aria-hidden="true"></span>`;
  }

  function fallbackFlagRgb(iso2) {
    const palette=['64,105,153','156,64,64','57,120,85','174,112,53','87,77,145','39,124,145','145,74,116'];
    const code=clean(iso2).toUpperCase();
    const h=[...code].reduce((n,c)=>n*31+c.charCodeAt(0),7);
    return palette[Math.abs(h)%palette.length];
  }

  function flagAccentRgb(iso2) {
    const code=clean(iso2).toUpperCase();
    if(flagColorCache.has(code)) return flagColorCache.get(code);
    const result=FLAG_ACCENTS[code]||fallbackFlagRgb(code);
    flagColorCache.set(code,result);
    return result;
  }

  function shouldWideCountry(r) {
    const en=clean(r['Full Country Name EN']); const th=clean(r['Full Country Name TH']);
    const capital=clean(r['Capital EN']); const people=clean(r['People EN']);
    return en.length>48 || th.length>44 || capital.length>45 || people.length>46;
  }

  function shouldWideFaculty(r) {
    const faculty=facultyENValue(r);
    const major=majorENValue(r);
    const majorTh=clean(r['Major TH']);
    const notes=clean(r['Additional / Notes']);
    return major.length>48 || majorTh.length>44 || (faculty.length+major.length)>92 || notes.length>82;
  }

  function shouldWideEmbassy(r, display, output2, thai) {
    const review=yes(r['AI Review Required'])?clean(r['Reconciliation Notes']||r['Notes']||r['Reconciliation Status']):'';
    return clean(display).length>39 || clean(output2).length>88 || clean(thai).length>62 || review.length>105;
  }

  function resolveCountryCode(name) {
    const key=normalize(name);if(!key)return'';if(countryCodeCache.has(key))return countryCodeCache.get(key);
    const overrides={
      'czech republic':'CZ','czechia':'CZ','south korea':'KR','korea':'KR','laos':'LA','lao pdr':'LA','russia':'RU',
      'taiwan':'TW','hong kong':'HK','turkiye':'TR','turkey':'TR','brunei darussalam':'BN','brunei':'BN',
      'united states':'US','united states of america':'US','united kingdom':'GB','uae':'AE'
    };
    if(overrides[key]){countryCodeCache.set(key,overrides[key]);return overrides[key];}
    const hit=(data?.countries||[]).find(r=>[r['Country EN'],r['Full Country Name EN'],r['Country TH'],r['Full Country Name TH']].some(v=>normalize(v)===key));
    const code=clean(hit?.['ISO Alpha-2']).toUpperCase();countryCodeCache.set(key,code);return code;
  }

  function rowsToObjects(rows) {
    if (!Array.isArray(rows) || rows.length < 1) return [];
    const headers = rows[0].map(h => clean(h));
    return rows.slice(1).filter(r => r.some(v => clean(v) !== '')).map(r => {
      const o = {};
      headers.forEach((h,i) => { if (h) o[h] = r[i] ?? ''; });
      return o;
    });
  }

  function buildData(rowsBySheet) {
    const countries = rowsToObjects(rowsBySheet.Countries || []);
    const countryAliases = rowsToObjects(rowsBySheet.Country_Aliases || []);
    const faculty = rowsToObjects(rowsBySheet.Faculty_Major || []);
    const facultyAliases = rowsToObjects(rowsBySheet.Faculty_Aliases || []);
    const embassy = rowsToObjects(rowsBySheet.Embassy || []);
    const embassyAliases = rowsToObjects(rowsBySheet.Embassy_Aliases || []);
    const status = rowsToObjects(rowsBySheet.Data_Status || []);
    const settings = rowsToObjects(rowsBySheet.Settings || []);
    const emailLibrary = rowsToObjects(rowsBySheet['Email Library'] || []);
    const chatLibrary = rowsToObjects(rowsBySheet['Chat Reply Library'] || []);
    const documentOptions = rowsToObjects(rowsBySheet['Document Options'] || []);
    const selectorMap = rowsToObjects(rowsBySheet['Website Selector Map'] || []);

    const aliasMap = (aliases, idKey) => {
      const m = new Map();
      aliases.forEach(a => {
        if (!yes(a.Active ?? 'YES')) return;
        const id = clean(a[idKey]);
        const alias = clean(a.Alias);
        if (!id || !alias) return;
        if (!m.has(id)) m.set(id, []);
        m.get(id).push(alias);
      });
      return m;
    };
    const ca = aliasMap(countryAliases, 'Country Record ID');
    const fa = aliasMap(facultyAliases, 'Faculty/Major Record ID');
    const ea = aliasMap(embassyAliases, 'Embassy Record ID');

    const addSearch = (records, amap, fields) => records.map(r => {
      const aliases = amap.get(clean(r['Record ID'])) || [];
      const fieldValues = fields.map(f=>clean(r[f])).filter(Boolean);
      const joined = [...fieldValues, ...aliases].join(' | ');
      return { ...r, _aliases: aliases, _fields: fieldValues, _search: normalize(joined), _tokens: tokens(joined) };
    });

    return {
      countries: addSearch(countries, ca, ['Country EN','Country TH','Full Country Name EN','Full Country Name TH','Capital EN','Capital TH','Nationality EN','Nationality TH','People EN','People TH','ISO Alpha-2','ISO Alpha-3','Entity Type']),
      faculty: addSearch(faculty, fa, ['Faculty EN','(auto) Faculty EN Copy','Faculty EN Copy','Faculty TH','Faculty Abbreviation','Major EN','(auto) Major EN Copy','Major EN Copy','Major TH','Additional / Notes','Program Type','Degree Level','Credits Required (2026/2569)']),
      embassy: addSearch(embassy, ea, ['Office Type','Country / Territory EN','Country / Territory TH','City EN','City TH','Display Name EN','Office Name EN','Address EN','Official Name TH','Current Office Type','Current Country / Territory EN','Current City EN','Current Display Name EN','Current Office Name EN','Current Address EN','Current Official Name TH']),
      status, settings, emailLibrary, chatLibrary, documentOptions, selectorMap
    };
  }

  function scoreRecord(record, q) {
    const nq = normalize(q);
    if (!nq || !record._search) return 0;
    let score = 0;

    for (const v of record._fields || []) {
      const nv = normalize(v);
      if (nv === nq) score = Math.max(score, 1040);
      else if (nv.startsWith(nq)) score = Math.max(score, 900 - Math.min(120,nv.length-nq.length));
      else if (nv.includes(nq)) score = Math.max(score, 735 - Math.min(120,nv.length-nq.length));
    }
    for (const a of record._aliases || []) {
      const na = normalize(a);
      if (na === nq) score = Math.max(score, 1000);
      else if (na.startsWith(nq)) score = Math.max(score, 865 - Math.min(130,na.length-nq.length));
      else if (na.includes(nq)) score = Math.max(score, 705 - Math.min(120,na.length-nq.length));
    }
    if (record._search.startsWith(nq)) score = Math.max(score, 790);
    if (record._search.includes(nq)) score = Math.max(score, 650);

    const qt = tokens(q);
    if (qt.length) {
      let matched=0, prefix=0;
      qt.forEach(t => {
        if (record._tokens.some(h=>h===t)) { matched++; prefix+=2; }
        else if (record._tokens.some(h=>h.startsWith(t))) { matched++; prefix+=1; }
        else if (record._search.includes(t)) matched++;
      });
      if (matched) score = Math.max(score, 300 + (matched/qt.length)*260 + prefix*8);
      if (matched === qt.length) score += 40;
    }

    if (score < 650 && qt.length===1 && nq.length>=4 && /^[a-z0-9 ]+$/.test(nq)) {
      const candidates = record._tokens.filter(t=>/^[a-z0-9]+$/.test(t) && Math.abs(t.length-nq.length)<=2);
      let best=99;
      for (const c of candidates.slice(0,60)) best=Math.min(best,levenshtein(nq,c));
      const limit=nq.length<=6?1:2;
      if (best<=limit) score=Math.max(score,530-best*50);
    }
    return score;
  }

  function levenshtein(a,b) {
    if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;
    const prev=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){let left=i,diag=i-1;for(let j=1;j<=b.length;j++){const up=prev[j];const cur=Math.min(up+1,left+1,diag+(a[i-1]===b[j-1]?0:1));prev[j]=cur;diag=up;left=cur;}}
    return prev[b.length];
  }

  function recordRequiresReview(r,type) {
    if (type==='country') return yes(r['AI Added']) && !yes(r.Verified);
    if (type==='faculty') return yes(r['AI Review Required']) || (yes(r['AI Added']) && !yes(r.Verified));
    if (type==='embassy') return yes(r['AI Review Required']) || (yes(r['AI Added']) && !yes(r.Verified));
    return false;
  }

  function facultyDegreeMatches(r) {
    if (degreeFilter==='all') return true;
    const level=normalize(r['Degree Level']);
    if (degreeFilter==='bachelor') return level.includes('bachelor');
    if (degreeFilter==='master') return level.includes('master');
    if (degreeFilter==='doctor') return level.includes('doctor');
    return true;
  }

  function getMatches(records,q,type) {
    return records
      .filter(r=>showInactive || yes(r.Active ?? 'YES'))
      .filter(r=>type!=='faculty' || activeTab!=='faculty' || facultyDegreeMatches(r))
      .filter(r=>!reviewOnly || recordRequiresReview(r,type))
      .map(r=>({r,s:scoreRecord(r,q)}))
      .filter(x=>x.s>0)
      .sort((a,b)=>b.s-a.s || String(a.r['Record ID']).localeCompare(String(b.r['Record ID'])))
      .map(x=>x.r);
  }

  function suggestionTypeLabel(type){return ({countries:'Country & Nationality',faculty:'Faculty & Major',embassy:'Thai Embassy'})[type]||type;}
  function suggestionForRecord(type,r){
    if(type==='countries') return {type,title:clean(r['Country EN']||r['Full Country Name EN']),sub:[r['Nationality EN'],r['Capital EN']].filter(Boolean).join(' · ')};
    if(type==='faculty') return {type,title:clean(majorENValue(r)||r['Major TH']||facultyENValue(r)),sub:clean(facultyENValue(r)||r['Faculty TH'])};
    const country=currentOr(r,'Current Country / Territory EN','Country / Territory EN'), city=currentOr(r,'Current City EN','City EN');
    return {type,title:clean(currentOr(r,'Current Display Name EN','Display Name EN')||currentOr(r,'Current Office Name EN','Office Name EN')),sub:[city,country].filter(Boolean).join(' · ')};
  }
  function buildSearchSuggestions(value){
    const q=clean(value);if(!q||!data)return[];
    const sets=[];
    if(activeTab==='all'||activeTab==='countries')sets.push(['countries',data.countries]);
    if(activeTab==='all'||activeTab==='faculty')sets.push(['faculty',data.faculty.filter(r=>activeTab!=='faculty'||facultyDegreeMatches(r))]);
    if(activeTab==='all'||activeTab==='embassy')sets.push(['embassy',data.embassy]);
    const scored=[];for(const [type,records] of sets){for(const r of records){if(!showInactive&&!yes(r.Active??'YES'))continue;if(reviewOnly&&!recordRequiresReview(r,type==='countries'?'country':type))continue;const s=scoreRecord(r,q);if(s>0){const item=suggestionForRecord(type,r);if(item.title)scored.push({...item,score:s});}}}
    const seen=new Set();return scored.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)).filter(x=>{const k=`${x.type}:${normalize(x.title)}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,8);
  }
  function renderSearchSuggestions(){
    const box=$('#searchSuggestions');if(!box)return;
    suggestionItems=buildSearchSuggestions($('#searchInput').value);suggestionIndex=Math.min(suggestionIndex,suggestionItems.length-1);
    if(!suggestionItems.length){box.classList.add('hidden');box.innerHTML='';suggestionIndex=-1;return;}
    box.innerHTML=suggestionItems.map((x,i)=>`<button type="button" class="search-suggestion ${i===suggestionIndex?'active':''}" data-suggestion-index="${i}" role="option"><span class="suggestion-main"><strong>${esc(x.title)}</strong><small>${esc(x.sub||'')}</small></span><span class="suggestion-type">${esc(suggestionTypeLabel(x.type))}</span></button>`).join('');box.classList.remove('hidden');
  }
  function closeSearchSuggestions(){const box=$('#searchSuggestions');if(box){box.classList.add('hidden');}suggestionIndex=-1;}
  function chooseSearchSuggestion(index){const item=suggestionItems[index];if(!item)return;closeSearchSuggestions();runQuery(item.title);}

  function runQuery(value) {
    browseMode=false;
    closeSearchSuggestions();
    $('#searchInput').value=value;
    search();
    rememberQuery(value);
    $('#searchInput').focus();
  }

  function browseRecords(records,type) {
    return records
      .filter(r=>showInactive || yes(r.Active ?? 'YES'))
      .filter(r=>type!=='faculty' || facultyDegreeMatches(r))
      .filter(r=>!reviewOnly || recordRequiresReview(r,type==='countries'?'country':type));
  }

  function browseType(type) {
    browseMode=true;
    reviewOnly=type==='review';
    if($('#reviewOnly'))$('#reviewOnly').checked=reviewOnly;
    const tab=type==='review'?'all':type;
    $('#searchInput').value='';
    changeTab(['countries','faculty','embassy'].includes(tab)?tab:'all');
    browseMode=true;
    search();
  }

  function search() {
    query=$('#searchInput').value.trim();
    if(query) browseMode=false;
    $('#clearSearch').classList.toggle('visible',!!query||browseMode);
    document.body.classList.toggle('is-searching',!!query && activeWorkspace==='reference');

    if (query!==lastQuery) { expandedGroups.clear(); expandedCards.clear(); lastQuery=query; }

    if(!query && !browseMode){
      $('#overview').classList.remove('hidden');$('#starter').classList.toggle('hidden',getRecent().length===0);$('#resultsSection').classList.add('hidden');
      updateTabCounts({countries:0,faculty:0,embassy:0},false);return;
    }

    $('#overview').classList.add('hidden');$('#starter').classList.add('hidden');$('#resultsSection').classList.remove('hidden');

    if(!query && browseMode){
      const allGroups={
        countries:browseRecords(data.countries,'countries'),
        faculty:browseRecords(data.faculty,'faculty'),
        embassy:browseRecords(data.embassy,'embassy')
      };
      updateTabCounts(allGroups,true);
      const groups={};
      if(activeTab==='all'||activeTab==='countries') groups.countries=allGroups.countries;
      if(activeTab==='all'||activeTab==='faculty') groups.faculty=allGroups.faculty;
      if(activeTab==='all'||activeTab==='embassy') groups.embassy=allGroups.embassy;
      lastGroups=groups;
      const total=Object.values(groups).reduce((n,a)=>n+a.length,0);
      $('#resultTitle').textContent=reviewOnly?'Records flagged for review':activeTab==='countries'?'Country & Nationality':activeTab==='faculty'?'Faculty & Major':activeTab==='embassy'?'Thai Embassy & Consular Offices':'All reference records';
      const degreeNote=activeTab==='faculty'&&degreeFilter!=='all'?` · ${degreeFilter==='bachelor'?'Bachelor':degreeFilter==='master'?'Master':'Doctor'} only`:'';
      $('#resultMeta').textContent=`${total} record${total===1?'':'s'} · browse mode${degreeNote}${reviewOnly?' · source review required':''}`;
      renderResults(groups);
      return;
    }

    const allGroups={
      countries:getMatches(data.countries,query,'country'),
      faculty:getMatches(data.faculty,query,'faculty'),
      embassy:getMatches(data.embassy,query,'embassy')
    };
    updateTabCounts(allGroups,true);

    const groups={};
    if(activeTab==='all'||activeTab==='countries') groups.countries=allGroups.countries;
    if(activeTab==='all'||activeTab==='faculty') groups.faculty=allGroups.faculty;
    if(activeTab==='all'||activeTab==='embassy') groups.embassy=allGroups.embassy;
    lastGroups=groups;

    const total=Object.values(groups).reduce((n,a)=>n+a.length,0);
    $('#resultTitle').textContent=total?`Results for “${query}”`:`No result for “${query}”`;
    const degreeNote=activeTab==='faculty'&&degreeFilter!=='all'?` · ${degreeFilter==='bachelor'?'Bachelor':degreeFilter==='master'?'Master':'Doctor'} only`:'';
    $('#resultMeta').textContent=total?`${total} matching record${total===1?'':'s'} · strongest matches first${degreeNote}`:'Try another spelling, nationality, city, abbreviation, or Thai name.';
    renderResults(groups);

    clearTimeout(recentTimer);
    if(total && query.length>=2) recentTimer=setTimeout(()=>rememberQuery(query),900);
  }

  function updateTabCounts(groups,visible) {
    const counts={countries:groups.countries?.length||0,faculty:groups.faculty?.length||0,embassy:groups.embassy?.length||0};
    counts.all=counts.countries+counts.faculty+counts.embassy;
    Object.entries(counts).forEach(([key,n])=>{
      const el=$(`[data-tab-count="${key}"]`); if(!el)return;
      el.textContent=n; el.classList.toggle('visible',visible && n>0);
    });
  }

  function renderResults(groups) {
    recordLookup.clear();
    const parts=[];
    if(groups.countries?.length) parts.push(renderGroup('countries','Country & Nationality',groups.countries,renderCountry));
    if(groups.faculty?.length) parts.push(renderGroup('faculty','Faculty & Major',groups.faculty,renderFaculty));
    if(groups.embassy?.length) parts.push(renderGroup('embassy','Thai Embassy & Consular Offices',groups.embassy,renderEmbassy));
    $('#results').innerHTML=parts.length?parts.join(''):`<div class="empty-state"><div class="empty-icon">⌕</div><strong>No matching record</strong><p>Try a shorter term, another language, or a related location.</p></div>`;
  }

  function renderGroup(key,title,records,renderer) {
    const limit=activeTab==='all'?PREVIEW_ALL:PREVIEW_TAB;
    const expanded=expandedGroups.has(key);
    const shown=expanded?records:records.slice(0,limit);
    const remaining=Math.max(0,records.length-shown.length);
    const actionLabel=expanded?'Show fewer':`Show ${remaining} more`;
    const action=records.length>limit?`<button class="group-action" type="button" data-expand-group="${key}">${actionLabel}</button>`:'';
    const bottomAction=records.length>limit?`<div class="group-more-bottom"><span></span><button class="group-action group-action-bottom" type="button" data-expand-group="${key}">${actionLabel}</button><span></span></div>`:'';
    const cards=renderArrangedCards(key,shown,renderer);
    return `<section class="result-group"><div class="group-header"><div class="group-title-wrap"><h3>${esc(title)}</h3><span class="group-count">${records.length} match${records.length===1?'':'es'}</span></div>${action}</div>${cards}${bottomAction}</section>`;
  }

  function renderArrangedCards(key,records,renderer) {
    if(key==='faculty') return renderFacultyArrangement(records,renderer);
    if(key==='embassy') return renderEmbassyArrangement(records,renderer);
    return `<div class="card-list card-list-${key}">${records.map(renderer).join('')}</div>`;
  }

  function renderFacultyArrangement(records,renderer) {
    return `<div class="ranked-grid ranked-grid-faculty">${records.map(renderer).join('')}</div>`;
  }

  function renderEmbassyArrangement(records,renderer) {
    return `<div class="ranked-grid ranked-grid-embassy">${records.map(renderer).join('')}</div>`;
  }

  function cardKey(type, r) {
    const candidates = [
      r.ID, r['Record ID'], r['Source Record ID'], r['Source Record Key'],
      r['Country EN'], r['Full Country Name EN'],
      autoMajorENCopy(r), r['Major EN'], r['Major TH'],
      r['Current Display Name EN'], r['Display Name EN'], r['Current Office Name EN'], r['Office Name EN']
    ].map(clean).filter(Boolean);
    return `${type}:${candidates.join('|')}`;
  }

  function toggleButton(key, expanded) {
    return `<button class="card-expand-btn" type="button" data-toggle-card="${esc(key)}" aria-expanded="${expanded}" aria-label="${expanded ? 'Collapse details' : 'Expand details'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  }

  function statusDot(kind,label) {
    return `<span class="status-indicator status-${kind}" title="${esc(label)}" aria-label="${esc(label)}" role="img"></span>`;
  }

  // V4.6.5 field-level provenance indicator. The red dot is specifically an
  // AI-content marker, not a generic source/audit warning. Source-backed, legacy,
  // intake-specific, user-sourced, or merely not-yet-certified wording does not
  // receive an AI dot unless the field status explicitly identifies generated,
  // translated, inferred, or synthetic content.
  function sourceStatusIsAIContent(status) {
    const s=normalize(status);
    if(!s)return false;
    return s.includes('ai') || s.includes('machine translat') || s.includes('model generated') ||
      s.includes('model-generated') || s.includes('inferred') || s.includes('synthetic');
  }
  function sourceContextWarning(status,fieldLabel) {
    const raw=clean(status);
    if(!sourceStatusIsAIContent(raw))return'';
    return `${fieldLabel}: ${raw}. This displayed value contains AI-created, AI-translated, or inferred context; verify it against an official source before formal use.`;
  }
  function sourceContextDot(status,fieldLabel) {
    const warning=sourceContextWarning(status,fieldLabel);
    return warning?`<span class="source-context-dot" title="${esc(warning)}" aria-label="${esc(warning)}" role="img"></span>`:'';
  }

  function badgeSet(r,type) {
    const badges=[];
    if(!yes(r.Active ?? 'YES')) badges.push(`<span class="badge off">Inactive</span>`);
    if(type==='faculty'){
      // Keep only operational record warnings in the normal search UI.
      // Source/audit metadata remains in the workbook for maintenance but is intentionally hidden.
      const recordStatus=clean(r['Record Status']);
      if(recordStatus==='Legacy') badges.push(`<span class="badge off">Legacy</span>`);
      else if(recordStatus==='Intake-specific') badges.push(`<span class="badge source">Intake-specific</span>`);
      else if(recordStatus==='Transition') badges.push(`<span class="badge warn">Transition</span>`);
    }else{
      if(yes(r['AI Added']) && !yes(r.Verified)) badges.push(statusDot('ai-added','AI added — verify'));
      if(yes(r['AI Review Required'])) badges.push(statusDot('ai-review','AI review'));
    }
    if(type==='country'&&r['Entity Type']){
      const entity=clean(r['Entity Type']);
      if(normalize(entity).includes('un member')) badges.push(statusDot('un-member','UN Member State'));
      else badges.push(`<span class="badge source">${esc(entity)}</span>`);
    }
    if(type==='embassy'&&r['Reconciliation Status']){const s=String(r['Reconciliation Status']);if(s.includes('CURRENT')||s.includes('MATCH'))badges.push(`<span class="badge good">Official source checked</span>`);}
    return badges.join('');
  }

  function copyButton(value,label='Copy') {
    if(!clean(value))return'';const safe=esc(String(value).replace(/\r/g,''));
    return `<button class="copy-btn" type="button" data-copy="${safe.replace(/\n/g,'&#10;')}" title="${esc(label)}" aria-label="${esc(label)}"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>`;
  }
  function copyAllButton(value){if(!clean(value))return'';const safe=esc(String(value).replace(/\r/g,'')).replace(/\n/g,'&#10;');return `<button class="copy-all-btn" type="button" data-copy="${safe}">Copy all</button>`;}
  function valueCopy(value){return `<div class="value-with-copy"><span>${esc(value||'—')}</span>${copyButton(value)}</div>`;}
  function safeUrl(value){const v=clean(value);return /^https?:\/\//i.test(v)?v:'';}
  function sourceLink(r){const u=safeUrl(r['Web Source URL']);return u?`<a class="source-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`:'';}


  function floatButton(key){return `<button class="float-ref-btn" type="button" data-float-ref="${esc(key)}">Float</button>`;}
  function nl2br(v){return esc(v||'—').replace(/\n/g,'<br>');}
  function nextWindowZ(){windowZCounter+=1;return windowZCounter;}
  function ensureFloatingUI(){
    if($('#referenceWindows'))return;
    document.body.insertAdjacentHTML('beforeend','<div id="referenceWindows" class="reference-windows" aria-live="polite"></div>');
  }
  function createFloatingItem(type,r,key){
    if(type==='country'){
      const title=r['Country EN']||r['Full Country Name EN'];
      const rows=[
        {label:'Country / ประเทศ',value:`${r['Country EN']||'—'}\n${r['Country TH']||'—'}`,copy:`${r['Country EN']||'—'} | ${r['Country TH']||'—'}`},
        {label:'Full country name / ชื่อประเทศเต็ม',value:`${r['Full Country Name EN']||'—'}\n${r['Full Country Name TH']||'—'}`,copy:`${r['Full Country Name EN']||'—'} | ${r['Full Country Name TH']||'—'}`},
        {label:'Capital / เมืองหลวง',value:`${r['Capital EN']||'—'}\n${r['Capital TH']||'—'}`,copy:`${r['Capital EN']||'—'} | ${r['Capital TH']||'—'}`},
        {label:'Nationality / สัญชาติ',value:`${r['Nationality EN']||'—'}\n${r['Nationality TH']||'—'}`,copy:`${r['Nationality EN']||'—'} | ${r['Nationality TH']||'—'}`},
        {label:'People / ประชาชน',value:`${r['People EN']||'—'}\n${r['People TH']||'—'}`,copy:`${r['People EN']||'—'} | ${r['People TH']||'—'}`}
      ];
      return {id:key,type,iso:clean(r['ISO Alpha-2']).toUpperCase(),title,subtitle:[r['Country TH'],r['ISO Alpha-2'],r['ISO Alpha-3']].filter(Boolean).join(' · '),rows};
    }
    if(type==='faculty'){
      const facultyEN=facultyENValue(r);
      const majorEN=majorENValue(r);
      const title=majorEN||r['Major TH']||facultyEN;
      const isBui=normalize(r['Faculty Abbreviation'])==='bui'||/bangkok university international|bu international/i.test(`${r['Faculty EN']||''} ${autoFacultyENCopy(r)}`);
      const rows=[
        {label:'Faculty — English',value:facultyEN,copy:facultyEN,status:r['Faculty EN Source Status']},
        {label:'คณะ — ไทย',value:r['Faculty TH'],copy:r['Faculty TH'],status:r['Faculty TH Source Status']},
        {label:'Major — English',value:majorEN,copy:majorEN,status:r['EN Source Status']},
        {label:'สาขา — ไทย',value:r['Major TH'],copy:r['Major TH'],status:r['TH Source Status']}
      ];
      const credits=clean(r['Credits Required (2026/2569)']);if(credits)rows.push({label:'Credits required — 2026/2569',value:credits,copy:credits,status:r['Credits Status']});
      const degree=[r['Program Type'],r['Degree Level']].filter(Boolean).join(' · ');if(degree)rows.push({label:'Program / Degree',value:degree,copy:degree});
      return {id:key,type,iso:'',title:`${isBui?'🌐 ':''}${title}`,subtitle:'',rows,theme:normalize(r['Degree Level']).includes('master')?'master':'bachelor'};
    }
    const officeType=clean(r['Current Office Type'])||clean(r['Office Type']);
    const country=clean(r['Current Country / Territory EN'])||clean(r['Country / Territory EN']);
    const city=clean(r['Current City EN'])||clean(r['City EN']);
    const display=clean(r['Current Display Name EN'])||clean(r['Display Name EN'])||`${clean(r['Current Office Name EN'])||clean(r['Office Name EN'])}, ${country}`;
    const office=clean(r['Current Office Name EN'])||clean(r['Office Name EN']);
    const address=clean(r['Current Address EN'])||clean(r['Address EN']);
    const thai=clean(r['Current Official Name TH'])||clean(r['Official Name TH']);
    const output2=[office,address].filter(Boolean).join('\n');
    return {id:key,type:'embassy',iso:resolveCountryCode(country),title:display,subtitle:[officeType,city,country].filter(Boolean).join(' · '),rows:[{label:'1',value:display,copy:display},{label:'2',value:output2,copy:output2},{label:'3',value:thai,copy:thai}]};
  }
  function defaultFloatState(index=0){
    const width=390,height=430;
    return {x:Math.max(18,Math.min(70+index*34,window.innerWidth-width-24)),y:Math.max(90,Math.min(120+index*28,window.innerHeight-height-24)),width,height,minimized:false,z:nextWindowZ()};
  }
  function openFloatingByKey(key){
    if(activeWorkspace!=='reference')return;
    const ref=recordLookup.get(key);if(!ref)return;
    const item=createFloatingItem(ref.type,ref.record,key);if(!item)return;
    const existing=floatingWindows.get(key);
    if(existing){existing.item=item;existing.state.minimized=false;existing.state.z=nextWindowZ();}
    else floatingWindows.set(key,{item,state:defaultFloatState(floatingWindows.size)});
    renderFloatingWindows();
  }
  function getFloatingEl(id){return $$('.floating-window').find(el=>el.dataset.winId===id)||null;}
  function closeFloating(id){floatingWindows.delete(id);renderFloatingWindows();}
  function toggleFloatingMinimize(id){
    const w=floatingWindows.get(id);if(!w)return;
    const el=getFloatingEl(id);
    if(el&&!w.state.minimized){w.state.width=el.offsetWidth;w.state.height=el.offsetHeight;}
    w.state.minimized=!w.state.minimized;w.state.z=nextWindowZ();renderFloatingWindows();
  }
  function floatingRow(row){
    const val=clean(row.value)||'—';
    return `<div class="floating-info-row"><div class="floating-info-main"><div class="floating-info-label">${esc(row.label)}${row.status!==undefined?sourceContextDot(row.status,row.label):''}</div><div class="floating-info-value">${nl2br(val)}</div></div>${copyButton(row.copy||val,`Copy ${row.label}`)}</div>`;
  }
  function renderFloatingWindows(){
    if(!$('#referenceWindows'))return;
    if(activeWorkspace!=='reference'){$('#referenceWindows').innerHTML='';return;}
    $('#referenceWindows').innerHTML=[...floatingWindows.values()].map(({item,state})=>{
      const cls=item.type==='faculty'?(item.theme==='master'?' fw-master':' fw-bachelor'):'';
      const size=state.minimized?'':`width:${Math.max(220,Number(state.width)||390)}px;height:${Math.max(120,Number(state.height)||430)}px;`;
      return `<article class="floating-window${cls}${state.minimized?' is-minimized':''}" data-win-id="${esc(item.id)}" style="left:${Math.max(8,Number(state.x)||70)}px;top:${Math.max(80,Number(state.y)||120)}px;${size}z-index:${Number(state.z)||3001};"><div class="floating-window-head" data-drag-handle="${esc(item.id)}"><div class="floating-window-title">${item.iso?flagMarkup(item.iso):''}<span>${esc(item.title)}</span></div><div class="floating-window-head-actions"><button class="window-head-btn" type="button" data-window-action="minimize" data-id="${esc(item.id)}" title="${state.minimized?'Restore':'Minimize'}">${state.minimized?'▢':'−'}</button><button class="window-head-btn" type="button" data-window-action="close" data-id="${esc(item.id)}" title="Close">×</button></div></div>${state.minimized?'':`<div class="floating-window-scroll"><div class="floating-window-content">${item.subtitle?`<div class="floating-window-subtitle">${esc(item.subtitle)}</div>`:''}${item.rows.map(floatingRow).join('')}</div></div>`}</article>`;
    }).join('');
  }
  function renderCountry(r) {
    const title=r['Country EN']||r['Full Country Name EN'];const th=r['Country TH'];
    const iso=clean(r['ISO Alpha-2']).toUpperCase();const flag=flagMarkup(iso);const flagRgb=flagAccentRgb(iso);const wide=shouldWideCountry(r);
    const key=cardKey('country',r); recordLookup.set(key,{type:'country',record:r}); const expanded=expandedCards.has(key);
    const rows=[['Country / ประเทศ',r['Country EN'],r['Country TH']],['Full country name / ชื่อประเทศเต็ม',r['Full Country Name EN'],r['Full Country Name TH']],['Capital / เมืองหลวง',r['Capital EN'],r['Capital TH']],['Nationality / สัญชาติ',r['Nationality EN'],r['Nationality TH']],['People / ประชาชน',r['People EN'],r['People TH']]];
    const copyAll=rows.map(x=>`${x[0]}: ${x[1]||'—'} | ${x[2]||'—'}`).join('\n');
    return `<article class="result-card country-card is-collapsible ${wide?'card-span-2':''} ${expanded?'is-expanded':''}"><div class="card-head flag-tinted-head" style="--flag-rgb:${flagRgb}"><div class="card-head-main" role="button" tabindex="0" data-toggle-card="${esc(key)}" aria-expanded="${expanded}"><div class="flag-title-row">${flag}<div class="card-title flagged-title">${esc(title)}</div></div><div class="card-subtitle">${esc(th)} · ${esc(iso)} ${r['ISO Alpha-3']?`/ ${esc(r['ISO Alpha-3'])}`:''}</div></div><div class="card-actions"><div class="badges">${badgeSet(r,'country')}</div>${floatButton(key)}${copyAllButton(copyAll)}${toggleButton(key, expanded)}</div></div><div class="card-collapsible"><table class="data-table"><thead><tr><th>Category / หัวข้อ</th><th>English</th><th>ไทย</th></tr></thead><tbody>${rows.map(x=>`<tr><td class="category-cell">${esc(x[0])}</td><td>${valueCopy(x[1])}</td><td>${valueCopy(x[2])}</td></tr>`).join('')}</tbody></table></div></article>`;
  }

  function renderFaculty(r) {
    const facultyEN=facultyENValue(r);
    const majorEN=majorENValue(r);
    const majorTH=clean(r['Major TH']);
    const title=majorEN||majorTH||facultyEN;
    const sub=[r['Faculty Abbreviation'],r['Program Type'],r['Degree Level']].filter(Boolean).join(' · ');
    const isBui=normalize(r['Faculty Abbreviation'])==='bui'||/bangkok university international|bu international/i.test(`${r['Faculty EN']||''} ${autoFacultyENCopy(r)}`);
    const titleMarkup=`${isBui?'<span class="bui-globe" title="Bangkok University International" aria-label="Bangkok University International">🌐</span> ':''}${esc(title)}`;
    const credits=clean(r['Credits Required (2026/2569)']);
    const copyAll=[`Faculty / คณะ: ${facultyEN||'—'} | ${r['Faculty TH']||'—'}`,`Major / สาขา: ${majorEN||'—'} | ${majorTH||'—'}`,credits?`Credits required (2026/2569): ${credits}`:'',sub?`Program: ${sub}`:''].filter(Boolean).join('\n');
    const degreeClass=normalize(r['Degree Level']).includes('master')?'degree-master':normalize(r['Degree Level']).includes('bachelor')?'degree-bachelor':'degree-other';
    const wide=shouldWideFaculty(r);
    const key=cardKey('faculty',r); recordLookup.set(key,{type:'faculty',record:r}); const expanded=expandedCards.has(key);
    return `<article class="result-card faculty-card is-collapsible ${degreeClass} ${wide?'card-span-2':''} ${expanded?'is-expanded':''}"><div class="card-head"><div class="card-head-main" role="button" tabindex="0" data-toggle-card="${esc(key)}" aria-expanded="${expanded}"><div class="card-title">${titleMarkup}</div>${sub?`<div class="card-subtitle">${esc(sub)}</div>`:''}</div><div class="card-actions"><div class="badges">${badgeSet(r,'faculty')}</div>${sourceLink(r)}${floatButton(key)}${copyAllButton(copyAll)}${toggleButton(key, expanded)}</div></div><div class="card-collapsible"><div class="faculty-body">${infoPair('Faculty — English',facultyEN,false,r['Faculty EN Source Status'])}${infoPair('คณะ — ไทย',r['Faculty TH'],false,r['Faculty TH Source Status'])}${infoPair('Major — English',majorEN,false,r['EN Source Status'])}${infoPair('สาขา — ไทย',majorTH,false,r['TH Source Status'])}${infoPair('Credits required — 2026/2569',credits,false,r['Credits Status'])}${r['Additional / Notes']?infoPair('Additional / Notes',r['Additional / Notes'],true):''}</div></div></article>`;
  }
  function infoPair(label,value,wide=false,sourceStatus=null){if(!clean(value))return'';return `<div class="info-pair ${wide?'info-wide':''}"><div class="info-label">${esc(label)}${sourceStatus!==null?sourceContextDot(sourceStatus,label):''}</div><div class="value-with-copy"><div class="info-value">${esc(value)}</div>${copyButton(value)}</div></div>`;}

  function currentOr(r,current,base){return clean(r[base])||clean(r[current]);}
  function renderEmbassy(r) {
    const officeType=currentOr(r,'Current Office Type','Office Type');const country=currentOr(r,'Current Country / Territory EN','Country / Territory EN');const city=currentOr(r,'Current City EN','City EN');
    const iso=resolveCountryCode(country);const flag=flagMarkup(iso);const flagRgb=flagAccentRgb(iso);
    const display=currentOr(r,'Current Display Name EN','Display Name EN')||`${currentOr(r,'Current Office Name EN','Office Name EN')}, ${country}`;const office=currentOr(r,'Current Office Name EN','Office Name EN');const address=currentOr(r,'Current Address EN','Address EN');const thai=currentOr(r,'Current Official Name TH','Official Name TH');const output2=[office,address].filter(Boolean).join('\n');const review=yes(r['AI Review Required'])?(r['Reconciliation Notes']||r['Notes']||r['Reconciliation Status']):'';const all=`1. ${display}\n\n2. ${output2}\n\n3. ${thai}`;
    const wide=shouldWideEmbassy(r,display,output2,thai);
    const key=cardKey('embassy',r); recordLookup.set(key,{type:'embassy',record:r}); const expanded=expandedCards.has(key);
    return `<article class="result-card embassy-card is-collapsible ${wide?'card-span-2':''} ${expanded?'is-expanded':''}"><div class="card-head flag-tinted-head" style="--flag-rgb:${flagRgb}"><div class="card-head-main" role="button" tabindex="0" data-toggle-card="${esc(key)}" aria-expanded="${expanded}"><div class="flag-title-row">${flag}<div class="card-title flagged-title">${esc(display)}</div></div><div class="card-subtitle">${esc([officeType,city,country].filter(Boolean).join(' · '))}</div></div><div class="card-actions"><div class="badges">${badgeSet(r,'embassy')}</div>${sourceLink(r)}${floatButton(key)}${copyAllButton(all)}${toggleButton(key, expanded)}</div></div><div class="card-collapsible"><div class="embassy-body">${embassyOutput('1',display)}${embassyOutput('2',output2)}${embassyOutput('3',thai)}</div>${review?`<div class="note-strip"><strong>Review:</strong> ${esc(review)}</div>`:''}</div></article>`;
  }

  function embassyOutput(n,text){return `<div class="embassy-output"><div class="output-number">${n}</div><div class="output-text">${esc(text||'—')}</div>${copyButton(text,`Copy output ${n}`)}</div>`;}

  function metricValue(name,fallback=0){const row=data.status.find(x=>clean(x.Metric)===name);return row?Number(row.Count||0):fallback;}
  function updateDegreeCounts(){
    const activeFaculty=data.faculty.filter(r=>yes(r.Active??'YES'));
    const bachelor=activeFaculty.filter(r=>normalize(r['Degree Level']).includes('bachelor')).length;
    const master=activeFaculty.filter(r=>normalize(r['Degree Level']).includes('master')).length;
    const doctor=activeFaculty.filter(r=>normalize(r['Degree Level']).includes('doctor')).length;
    $('#degreeAllCount').textContent=activeFaculty.length.toLocaleString();
    $('#degreeBachelorCount').textContent=bachelor.toLocaleString();
    $('#degreeMasterCount').textContent=master.toLocaleString();
    $('#degreeDoctorCount').textContent=doctor.toLocaleString();
  }

  function updateOverview(){
    const active=arr=>arr.filter(r=>yes(r.Active??'YES')).length;
    const countries=active(data.countries),faculty=active(data.faculty),embassy=active(data.embassy);
    const countryReviews=data.countries.filter(r=>yes(r.Active??'YES')&&recordRequiresReview(r,'country')).length;
    const facultyReviews=data.faculty.filter(r=>yes(r.Active??'YES')&&recordRequiresReview(r,'faculty')).length;
    const embassyReviews=data.embassy.filter(r=>yes(r.Active??'YES')&&recordRequiresReview(r,'embassy')).length;
    const reviews=countryReviews+facultyReviews+embassyReviews;
    $('#countryCount').textContent=countries.toLocaleString();$('#facultyCount').textContent=faculty.toLocaleString();$('#embassyCount').textContent=embassy.toLocaleString();$('#reviewCount').textContent=reviews.toLocaleString();updateDegreeCounts();
    if($('#reviewBreakdown'))$('#reviewBreakdown').textContent=`Country ${countryReviews} · Faculty ${facultyReviews} · Embassy ${embassyReviews}`;
    const metrics=[['Countries / territories',countries],['Country aliases',metricValue('Country aliases')||rowsToObjects(sourceRows.Country_Aliases||[]).length],['Faculty / majors',faculty],['Faculty aliases',rowsToObjects(sourceRows.Faculty_Aliases||[]).length],['Embassy / consular',embassy],['Embassy aliases',rowsToObjects(sourceRows.Embassy_Aliases||[]).length],['Email topics',data.emailLibrary.filter(r=>yes(r.Active??'YES')).length],['Chat topics',data.chatLibrary.filter(r=>yes(r.Active??'YES')).length],['Document options',data.documentOptions.filter(r=>yes(r.Active??'YES')).length],['Review flags',reviews]];
    $('#drawerMetrics').innerHTML=metrics.map(([k,v])=>`<div class="metric-row"><span>${esc(k)}</span><strong>${typeof v==='number'?v.toLocaleString():esc(v)}</strong></div>`).join('');
    updateWorkspaceDataCounts();
    renderImportHistory();
  }
  function updateSourceUI(){
    $('#dataSourceLabel').textContent=sourceMeta.type==='hub'?'Central Hub':sourceMeta.type==='excel'?'Excel loaded':'Bundled data';$('#drawerSourceTitle').textContent=sourceMeta.title;$('#drawerSourceDetail').textContent=sourceMeta.detail;
    [$('#statusDot'),$('#drawerStatusDot')].forEach(el=>{el.classList.toggle('excel',sourceMeta.type==='excel');el.classList.toggle('warn',sourceMeta.type==='warning');});
  }
  function getImportHistory(){try{const h=JSON.parse(localStorage.getItem(IMPORT_HISTORY_KEY)||'[]');return Array.isArray(h)?h:[];}catch{return[];}}
  function saveImportHistory(history){try{localStorage.setItem(IMPORT_HISTORY_KEY,JSON.stringify(history.slice(0,IMPORT_HISTORY_LIMIT)));return true;}catch{return false;}}
  function pushCurrentImportToHistory(){
    if(!sourceRows||sourceMeta.type!=='excel')return;
    const history=getImportHistory().filter(x=>x?.meta?.detail!==sourceMeta.detail);
    history.unshift({savedAt:Date.now(),meta:sourceMeta,rows:sourceRows});
    if(!saveImportHistory(history))toast('Could not keep another Excel backup because browser storage is full.');
  }
  function renderImportHistory(){
    const history=getImportHistory();
    const html=history.length?history.map((item,i)=>{const when=item.savedAt?new Date(item.savedAt).toLocaleString():'';return `<div class="import-history-item"><div><strong>${esc(item.meta?.title||'Previous workbook')}</strong><span>${esc(when)}</span></div><button class="secondary-btn compact" type="button" data-restore-import="${i}">Restore</button></div>`;}).join(''):`<div class="import-history-empty">No previous Excel import yet.</div>`;
    if($('#dataImportHistory'))$('#dataImportHistory').innerHTML=html;
    if($('#drawerImportHistory'))$('#drawerImportHistory').innerHTML=html;
  }
  function restoreImportVersion(index){
    const history=getImportHistory(),item=history[index];if(!item?.rows)return;
    if(sourceMeta.type==='excel')pushCurrentImportToHistory();
    const remaining=getImportHistory().filter((_,i)=>i!==index);saveImportHistory(remaining);
    const meta={...item.meta,type:'excel',title:item.meta?.title||'Restored Excel data',detail:`Restored ${new Date().toLocaleString()} · ${item.meta?.detail||'previous workbook'}`};
    lastValidationReport={errors:[],warnings:[],label:'Restored a previously validated workbook from this browser.'};
    setRows(item.rows,meta,true);toast('Previous Excel workbook restored.');
  }
  function renderValidationSummary(){
    const el=$('#dataValidationSummary');if(!el)return;const r=lastValidationReport||{errors:[],warnings:[]};
    const errors=r.errors?.length||0,warnings=r.warnings?.length||0;
    el.className=`validation-summary ${errors?'has-errors':warnings?'has-warnings':'is-good'}`;
    el.innerHTML=`<strong>${errors?`${errors} error${errors===1?'':'s'}`:warnings?`0 errors · ${warnings} warning${warnings===1?'':'s'}`:'Validated'}</strong><span>${esc(r.label||'Workbook structure checked.')}</span>${warnings?`<small>${esc(r.warnings.slice(0,3).join(' · '))}${warnings>3?' · …':''}</small>`:''}`;
  }
  function setRows(rows,meta,persist=false){sourceRows=rows;data=buildData(rows);countryCodeCache.clear();flagColorCache.clear();floatingWindows.clear();sourceMeta=meta;if(persist){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(rows));localStorage.setItem(STORAGE_META_KEY,JSON.stringify(meta));}catch(e){toast('Excel loaded, but browser storage is full.');}}updateOverview();updateSourceUI();refreshCommunicationData();renderValidationSummary();search();renderFloatingWindows();}

  let hubSyncInFlight = false;
  function hubStatus(message, error = false) {
    const node = $('#hubDataStatus');
    if (node) {
      node.textContent = message;
      node.title = message;
      node.style.color = error ? '#b45309' : '';
    }
  }
  async function syncHubReferences(force = false) {
    if (hubSyncInFlight || !sourceRows || !window.BUICHubReference) return;
    if (sourceMeta.type === 'excel') {
      if (!force) {
        hubStatus('Local Excel override active · Hub will not replace it automatically');
        return;
      }
      if (!window.confirm('You have an imported Excel workbook. Apply published Hub fields to this page temporarily? Your saved workbook will not be overwritten; reload to restore it.')) return;
    }
    hubSyncInFlight = true;
    const buttons = ['#dataPageRefreshHubBtn', '#drawerRefreshHubBtn'].map(selector => $(selector)).filter(Boolean);
    buttons.forEach(button => button.disabled = true);
    try {
      const result = await window.BUICHubReference.update(sourceRows, force);
      if (result.status === 'updated') {
        lastValidationReport = {errors:[], warnings:[], label:'Published Hub reference v' + result.version + ' loaded. Non-reference workbook sheets were preserved.'};
        setRows(result.rows, {type:'hub', title:'BUIC Central Hub v' + result.version,
          detail:'Published reference data · version ' + result.version + ' · other workbook sheets preserved'}, false);
        hubStatus('Central Hub v' + result.version + ' · references updated');
      } else if (result.status === 'unchanged') {
        hubStatus('Central Hub v' + result.version + ' · up to date');
      } else {
        hubStatus('No published Hub dataset · existing workbook retained');
      }
    } catch (error) {
      console.warn('Central Hub reference refresh failed; existing workbook preserved', error);
      hubStatus('Hub not applied · ' + (error.message || 'current workbook preserved'), true);
    } finally {
      hubSyncInFlight = false;
      buttons.forEach(button => button.disabled = false);
    }
  }

  function validateRows(rows){
    const errors=[],warnings=[];
    const objects={};
    for(const name of TARGET_SHEETS){
      const table=rows[name];
      if(!Array.isArray(table)){errors.push(`Missing required sheet: ${name}`);continue;}
      if(['Countries','Faculty_Major','Embassy'].includes(name)&&table.length<2)errors.push(`${name} has no data rows`);
      const headers=(table[0]||[]).map(clean);
      const required=REQUIRED_COLUMNS[name]||[];
      const missingCols=required.filter(h=>!headers.includes(h));
      if(missingCols.length)errors.push(`${name}: missing column${missingCols.length>1?'s':''} ${missingCols.join(', ')}`);
      objects[name]=rowsToObjects(table);
    }
    const idRules=[['Countries','Record ID'],['Faculty_Major','Record ID'],['Embassy','Record ID'],['Email Library','Topic ID'],['Chat Reply Library','Chat ID'],['Document Options','Document ID']];
    for(const [name,key] of idRules){
      const list=objects[name]||[],seen=new Set(),dups=new Set();let blank=0;
      list.forEach(r=>{const id=clean(r[key]);if(!id){blank++;return;}if(seen.has(id))dups.add(id);seen.add(id);});
      if(blank)errors.push(`${name}: ${blank} blank ${key} value${blank===1?'':'s'}`);
      if(dups.size)errors.push(`${name}: duplicate ${key} ${[...dups].slice(0,5).join(', ')}${dups.size>5?'…':''}`);
    }
    const validYN=new Set(['YES','NO','']);
    ['Countries','Faculty_Major','Embassy'].forEach(name=>(objects[name]||[]).forEach((r,i)=>['Active','Verified'].forEach(k=>{if(k in r&&!validYN.has(clean(r[k]).toUpperCase()))warnings.push(`${name} row ${i+2}: ${k} should be YES or NO`);}))); 
    const parentRules=[['Country_Aliases','Country Record ID','Countries'],['Faculty_Aliases','Faculty/Major Record ID','Faculty_Major'],['Embassy_Aliases','Embassy Record ID','Embassy']];
    for(const [aliasSheet,key,parentSheet] of parentRules){const ids=new Set((objects[parentSheet]||[]).map(r=>clean(r['Record ID'])).filter(Boolean));let orphan=0;(objects[aliasSheet]||[]).forEach(r=>{if(clean(r[key])&&!ids.has(clean(r[key])))orphan++;});if(orphan)warnings.push(`${aliasSheet}: ${orphan} orphan alias reference${orphan===1?'':'s'}`);}
    const facultyHeaders=(rows.Faculty_Major?.[0]||[]).map(clean);
    ['EN Source Status','TH Source Status','Faculty EN Source Status','Faculty TH Source Status','Record Status','Audit Source URL'].forEach(h=>{if(!facultyHeaders.includes(h))warnings.push(`Faculty_Major: ${h} is missing; V4.6 source-status features will be limited`);});
    return {errors,warnings,label:errors.length?'Workbook was not imported.':warnings.length?'Workbook structure passed with warnings.':'Workbook structure and key IDs passed validation.'};
  }
  function ensureXlsx(){
    if(window.XLSX)return Promise.resolve(window.XLSX);if(window.__xlsxLoading)return window.__xlsxLoading;
    window.__xlsxLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';script.async=true;const timer=setTimeout(()=>{script.remove();reject(new Error('Excel reader timed out. Check your internet connection.'));},10000);script.onload=()=>{clearTimeout(timer);window.XLSX?resolve(window.XLSX):reject(new Error('Excel reader did not initialize'));};script.onerror=()=>{clearTimeout(timer);reject(new Error('Excel reader could not be loaded. Internet is required when importing Excel.'));};document.head.appendChild(script);}).finally(()=>{window.__xlsxLoading=null;});return window.__xlsxLoading;
  }
  async function loadExcelFile(file){
    if(!file)return;if(!/\.xlsx?$/i.test(file.name)){toast('Please choose an .xlsx or .xls workbook.');return;}
    try{
      toast('Reading Excel…');await ensureXlsx();const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:'array',cellDates:false});
      const missing=TARGET_SHEETS.filter(name=>!wb.Sheets[name]);if(missing.length)throw new Error(`Missing required sheet${missing.length>1?'s':''}: ${missing.join(', ')}`);
      const rows={};for(const name of TARGET_SHEETS)rows[name]=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',raw:true});
      const report=validateRows(rows);lastValidationReport=report;renderValidationSummary();
      if(report.errors.length)throw new Error(report.errors.slice(0,4).join(' | '));
      if(report.warnings.length&&!confirm(`Workbook passed validation with ${report.warnings.length} warning${report.warnings.length===1?'':'s'}. Load it anyway?`))return;
      pushCurrentImportToHistory();
      const meta={type:'excel',title:file.name,detail:`Loaded ${new Date().toLocaleString()} · ${rowsToObjects(rows.Countries).length} countries · ${rowsToObjects(rows.Faculty_Major).length} programs · ${rowsToObjects(rows.Embassy).length} missions · ${rowsToObjects(rows['Email Library']).length} email topics`};
      setRows(rows,meta,true);toast(`Loaded ${file.name} · ${report.warnings.length} warning${report.warnings.length===1?'':'s'}`);closeDrawer();
    }catch(err){console.error(err);lastValidationReport={errors:[err.message],warnings:[],label:'Workbook was not imported.'};renderValidationSummary();toast(`Could not load workbook: ${err.message}`);}
  }
  function resetBundled(){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(STORAGE_META_KEY);lastValidationReport={errors:[],warnings:[],label:'Bundled V4.6.12 workbook loaded.'};setRows(window.REFERENCE_SNAPSHOT,{type:'bundled',title:'Bundled data',detail:'Current V4.6.12 workbook snapshot included with this website.'},false);toast('Reset to bundled workbook data.');closeDrawer();}


  function setWorkspace(name){
    activeWorkspace=['reference','communication','documents','data'].includes(name)?name:'reference';
    $$('.workspace-tab').forEach(b=>b.classList.toggle('active',b.dataset.workspace===activeWorkspace));
    $$('.workspace-pane').forEach(p=>p.classList.remove('active'));
    const pane=$(`#workspace${activeWorkspace.charAt(0).toUpperCase()+activeWorkspace.slice(1)}`);if(pane)pane.classList.add('active');
    document.body.classList.toggle('workspace-reference',activeWorkspace==='reference');
    if(activeWorkspace!=='reference')document.body.classList.remove('is-searching');else if(clean($('#searchInput').value))document.body.classList.add('is-searching');
    if(activeWorkspace==='communication')renderCommTopicList();
    if(activeWorkspace==='documents')updateDocumentCaseSummary();
    if(activeWorkspace==='data'){updateWorkspaceDataCounts();renderImportHistory();renderValidationSummary();}
    renderFloatingWindows();
  }


  function updateWorkspaceDataCounts(){
    if(!data)return;
    const email=data.emailLibrary?.filter(r=>yes(r.Active??'YES')).length||0, chat=data.chatLibrary?.filter(r=>yes(r.Active??'YES')).length||0, docs=data.documentOptions?.filter(r=>yes(r.Active??'YES')).length||0;
    if($('#emailTopicCount'))$('#emailTopicCount').textContent=email;if($('#chatTopicCount'))$('#chatTopicCount').textContent=chat;
    if($('#dataEmailCount'))$('#dataEmailCount').textContent=email;if($('#dataChatCount'))$('#dataChatCount').textContent=chat;if($('#dataDocCount'))$('#dataDocCount').textContent=docs;
  }

  function makeSignatureId(){return `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;}
  function defaultSignatureLibrary(){return [{id:'sig-international-center',name:'International Center',type:'email',content:'Best regards,\nInternational Center\nBangkok University',createdAt:Date.now(),updatedAt:Date.now()}];}
  function loadSignatureLibrary(){
    try{const raw=localStorage.getItem(SIGNATURES_KEY);const saved=raw===null?null:JSON.parse(raw);signatures=Array.isArray(saved)?saved.filter(s=>s&&s.id&&s.name):defaultSignatureLibrary();}
    catch{signatures=defaultSignatureLibrary();}
    try{const savedDefaults=JSON.parse(localStorage.getItem(SIGNATURE_DEFAULTS_KEY)||'null');if(savedDefaults&&typeof savedDefaults==='object')signatureDefaults={email:savedDefaults.email||'sig-international-center',chat:savedDefaults.chat||'none'};else signatureDefaults={email:'sig-international-center',chat:'none'};}
    catch{signatureDefaults={email:'sig-international-center',chat:'none'};}
    ['email','chat'].forEach(channel=>{const id=signatureDefaults[channel];if(id!=='none'&&!signatures.some(s=>s.id===id&&signatureCompatible(s,channel)))signatureDefaults[channel]='none';});
    saveSignatureLibrary();
  }
  function saveSignatureLibrary(){try{localStorage.setItem(SIGNATURES_KEY,JSON.stringify(signatures));localStorage.setItem(SIGNATURE_DEFAULTS_KEY,JSON.stringify(signatureDefaults));}catch{}}
  function signatureCompatible(sig,channel=commChannel){return sig&&(sig.type==='both'||sig.type===channel);}
  function signatureById(id){return signatures.find(s=>s.id===id)||null;}
  function selectedSignatureId(channel=commChannel){const id=signatureDefaults[channel]||'none';const sig=signatureById(id);return id==='none'||signatureCompatible(sig,channel)?id:'none';}
  function selectedSignatureContent(channel=commChannel){const id=selectedSignatureId(channel);if(id==='none')return'';return clean(signatureById(id)?.content);}
  function selectedSignatureName(channel=commChannel){const id=selectedSignatureId(channel);if(id==='none')return'No signature';return clean(signatureById(id)?.name)||'No signature';}
  function stripEmbeddedSignature(template){
    let body=String(template||'');
    if(commChannel==='email') body=body.replace(/\n*Best regards,\s*\nInternational Center\s*\nBangkok University\s*$/i,'');
    return body.trimEnd();
  }
  function composeWithSignature(core,signature){const body=String(core||'').trimEnd();const sig=String(signature||'').trim();return sig?(body?`${body}\n\n${sig}`:sig):body;}
  function detachSignature(text,signature){
    const full=String(text||'');const sig=String(signature||'').trim();if(!sig)return full.trimEnd();
    const trimmed=full.trimEnd();if(trimmed.endsWith(sig))return trimmed.slice(0,trimmed.length-sig.length).replace(/\s+$/,'');
    return full;
  }
  function renderSignatureSelect(){
    const sel=$('#commSignatureSelect');if(!sel)return;
    const compatible=signatures.filter(s=>signatureCompatible(s,commChannel)).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    const id=selectedSignatureId();
    sel.innerHTML=`<option value="none">No signature</option>${compatible.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}${s.type==='both'?' · Email & Chat':''}</option>`).join('')}`;
    sel.value=compatible.some(s=>s.id===id)?id:'none';
    const note=$('#signatureMemoryNote');if(note)note.textContent=`Default for ${commChannel==='email'?'Email':'Chat'}: ${selectedSignatureName()}`;
  }
  function applySignatureSelection(id,{preserveDraft=true}= {}){
    const oldContent=selectedSignatureContent();
    let next=id||'none';const sig=signatureById(next);if(next!=='none'&&!signatureCompatible(sig,commChannel))next='none';
    if(preserveDraft&&$('#commBody')){const core=detachSignature($('#commBody').value,oldContent);signatureDefaults[commChannel]=next;saveSignatureLibrary();$('#commBody').value=composeWithSignature(core,selectedSignatureContent());}
    else{signatureDefaults[commChannel]=next;saveSignatureLibrary();}
    renderSignatureSelect();renderSignatureLibrary();
  }
  function openSignatureManager(){renderSignatureLibrary();closeSignatureEditor();$('#signatureModal').classList.add('open');$('#signatureModal').setAttribute('aria-hidden','false');}
  function closeSignatureManager(){$('#signatureModal').classList.remove('open');$('#signatureModal').setAttribute('aria-hidden','true');closeSignatureEditor();}
  function signatureTypeLabel(type){return type==='both'?'Email & Chat':type==='chat'?'Chat':'Email';}
  function renderSignatureLibrary(){
    const list=$('#signatureList');if(!list)return;
    const current=selectedSignatureId();
    const rows=[`<article class="signature-item signature-none ${current==='none'?'selected':''}"><div class="signature-item-main"><div class="signature-item-title-row"><strong>No signature</strong><span class="signature-type-pill">${commChannel==='email'?'Email':'Chat'}</span></div><p>Do not add a closing signature to the generated message.</p></div><div class="signature-item-actions"><button class="secondary-btn compact" type="button" data-signature-action="select" data-signature-id="none">${current==='none'?'Selected':'Select'}</button></div></article>`];
    signatures.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name))).forEach(sig=>{const selected=current===sig.id;const compatible=signatureCompatible(sig,commChannel);rows.push(`<article class="signature-item ${selected?'selected':''} ${compatible?'':'not-compatible'}"><div class="signature-item-main"><div class="signature-item-title-row"><strong>${esc(sig.name)}</strong><span class="signature-type-pill">${esc(signatureTypeLabel(sig.type))}</span>${selected?'<span class="signature-current-pill">Current</span>':''}</div><pre>${esc(sig.content||'')}</pre>${!compatible?`<p class="signature-compat-note">Not available for the current ${commChannel==='email'?'Email':'Chat'} channel.</p>`:''}</div><div class="signature-item-actions">${compatible?`<button class="secondary-btn compact" type="button" data-signature-action="select" data-signature-id="${esc(sig.id)}">${selected?'Selected':'Select'}</button>`:''}<button class="ghost-btn compact" type="button" data-signature-action="edit" data-signature-id="${esc(sig.id)}">Edit</button><button class="ghost-btn compact" type="button" data-signature-action="duplicate" data-signature-id="${esc(sig.id)}">Duplicate</button><button class="danger-text-btn" type="button" data-signature-action="delete" data-signature-id="${esc(sig.id)}">Delete</button></div></article>`);});
    list.innerHTML=rows.join('');
    const count=$('#signatureCountLabel');if(count)count.textContent=`${signatures.length} saved signature${signatures.length===1?'':'s'} · stored in this browser`;
  }
  function openSignatureEditor(id=''){
    signatureEditorId=id;const sig=signatureById(id);$('#signatureEditor').classList.remove('hidden');$('#signatureEditorTitle').textContent=sig?'Edit signature':'Add signature';$('#signatureName').value=sig?.name||'';$('#signatureType').value=sig?.type||'email';$('#signatureContent').value=sig?.content||'';setTimeout(()=>$('#signatureName').focus(),20);
  }
  function closeSignatureEditor(){signatureEditorId='';if($('#signatureEditor'))$('#signatureEditor').classList.add('hidden');}
  function saveSignatureFromEditor(){
    const name=clean($('#signatureName').value),content=String($('#signatureContent').value||'').trim(),type=$('#signatureType').value;
    if(!name){toast('Enter a signature name.');$('#signatureName').focus();return;}if(!content){toast('Enter signature content.');$('#signatureContent').focus();return;}
    const old=signatureById(signatureEditorId);const oldContent=old?.content||'';const wasCurrent=!!old&&signatureDefaults[commChannel]===old.id;let id=signatureEditorId;
    if(old){old.name=name;old.content=content;old.type=['email','chat','both'].includes(type)?type:'email';old.updatedAt=Date.now();}
    else{id=makeSignatureId();signatures.push({id,name,content,type:['email','chat','both'].includes(type)?type:'email',createdAt:Date.now(),updatedAt:Date.now()});}
    ['email','chat'].forEach(channel=>{if(signatureDefaults[channel]===id&&!signatureCompatible(signatureById(id),channel))signatureDefaults[channel]='none';});
    saveSignatureLibrary();
    if(wasCurrent&&$('#commBody')){const core=detachSignature($('#commBody').value,oldContent);$('#commBody').value=composeWithSignature(core,signatureCompatible(signatureById(id),commChannel)?content:'');}
    renderSignatureSelect();renderSignatureLibrary();closeSignatureEditor();toast(old?'Signature updated':'Signature added');
  }
  function duplicateSignature(id){const src=signatureById(id);if(!src)return;const copy={...src,id:makeSignatureId(),name:`${src.name} Copy`,createdAt:Date.now(),updatedAt:Date.now()};signatures.push(copy);saveSignatureLibrary();renderSignatureLibrary();openSignatureEditor(copy.id);}
  function deleteSignature(id){const sig=signatureById(id);if(!sig)return;if(!confirm(`Delete signature “${sig.name}”?`))return;const oldContent=sig.content||'';const wasCurrent=selectedSignatureId()===id;if(wasCurrent&&$('#commBody'))$('#commBody').value=composeWithSignature(detachSignature($('#commBody').value,oldContent),'');signatures=signatures.filter(s=>s.id!==id);['email','chat'].forEach(channel=>{if(signatureDefaults[channel]===id)signatureDefaults[channel]='none';});saveSignatureLibrary();renderSignatureSelect();renderSignatureLibrary();toast('Signature deleted');}

  function commRecords(){const rows=commChannel==='email'?(data?.emailLibrary||[]):(data?.chatLibrary||[]);return rows.filter(r=>yes(r.Active??'YES'));}
  function commId(r){return clean(commChannel==='email'?r['Topic ID']:r['Chat ID'])||clean(r.Topic);}
  function commCategory(topic){return clean(topic).split('—')[0].trim()||'Other';}
  function renderCommTopicList(){
    if(!data)return;
    const all=commRecords();
    const categoryCounts=new Map();all.forEach(r=>{const c=commCategory(r.Topic);categoryCounts.set(c,(categoryCounts.get(c)||0)+1);});
    if(selectedCommCategory && !categoryCounts.has(selectedCommCategory)){selectedCommCategory='';selectedCommId='';}
    $('#commCategoryList').innerHTML=[...categoryCounts.entries()].map(([cat,count])=>`<button class="comm-category-item ${cat===selectedCommCategory?'active':''}" type="button" data-comm-category="${esc(cat)}"><span>${esc(cat)}</span><small>${count}</small></button>`).join('');
    const q=normalize($('#commTopicSearch')?.value||'');
    const hint=$('#commOptionHint');
    if(!selectedCommCategory){
      hint.textContent='Select a topic above first.';
      $('#commTopicList').innerHTML='<div class="comm-options-empty">Choose a topic in Step 1 to see its options.</div>';
      return;
    }
    hint.textContent=`${selectedCommCategory} · ${categoryCounts.get(selectedCommCategory)||0} option${(categoryCounts.get(selectedCommCategory)||0)===1?'':'s'}`;
    let records=all.filter(r=>commCategory(r.Topic)===selectedCommCategory).filter(r=>!q||normalize(`${r.Topic} ${r.Context} ${r['Email Subject']||''}`).includes(q));
    $('#commTopicList').innerHTML=records.map(r=>{const id=commId(r);const raw=clean(r.Topic);const optionTitle=raw.includes('—')?raw.split('—').slice(1).join('—').trim():raw;const sub=commChannel==='email'?(r['Email Subject']||r.Context):r.Context;return `<button class="comm-topic-item ${id===selectedCommId?'active':''}" type="button" data-comm-id="${esc(id)}"><span class="comm-topic-title">${esc(optionTitle)}</span><span class="comm-topic-sub">${esc(sub||'')}</span></button>`;}).join('')||'<div class="comm-options-empty">No matching option in this topic.</div>';
  }

  function selectCommCategory(category){selectedCommCategory=category;selectedCommId='';commFieldValues={};commSelectedDocs.clear();$('#commTopicSearch').value='';renderCommTopicList();renderCommBuilder();}

  function findCommRecord(){return commRecords().find(r=>commId(r)===selectedCommId)||null;}
  function extractPlaceholders(template){const out=[];const seen=new Set();for(const m of String(template||'').matchAll(/\[([^\]]+)\]/g)){const k=clean(m[1]);if(k&&!seen.has(k)){seen.add(k);out.push(k);}}return out;}
  const casePlaceholderMap={
    'Student Name':'caseStudentName','Student Number':'caseStudentNumber','Student ID':'caseStudentNumber','Passport No':'casePassportNo','Passport Number':'casePassportNo',
    'Country':'caseCountry','Nationality':'caseNationality','Program':'caseMajor','Faculty / Major':'caseMajor','Embassy/Consulate':'caseEmbassy','Embassy / Consulate':'caseEmbassy'
  };
  function isDocumentPlaceholder(name){return /selected document|selected passport page/i.test(name);}
  function selectedDocumentText(name){const rows=(data.documentOptions||[]).filter(r=>commSelectedDocs.has(clean(r['Document ID'])));const labels=rows.map(r=>clean(r['Website Display Label'])||clean(r['Document Option'])).filter(Boolean);if(!labels.length)return'';if(commChannel==='email'&&/documents/i.test(name)&&labels.length>1)return labels.map(x=>`• ${x}`).join('\n');return labels.join(', ');}
  function caseValue(name){const id=casePlaceholderMap[name];return id&&$(`#${id}`)?clean($(`#${id}`).value):'';}
  function formattedDynamicValue(name){const v=clean(commFieldValues[name]);if(!v)return'';if(/date/i.test(name)&&/^\d{4}-\d{2}-\d{2}$/.test(v)){const [y,m,d]=v.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});}return v;}
  function currentTemplate(){const r=findCommRecord();return r?(commChannel==='email'?clean(r['Email Template']):clean(r['Chat Reply Template'])):'';}
  function currentTemplateBody(){return stripEmbeddedSignature(currentTemplate());}
  function applyTemplate(template){let missing=[];const body=String(template||'').replace(/\[([^\]]+)\]/g,(full,raw)=>{const name=clean(raw);let v=caseValue(name);if(!v&&isDocumentPlaceholder(name))v=selectedDocumentText(name);if(!v)v=formattedDynamicValue(name);if(!v){missing.push(name);return full;}return v;});return {text:body,missing:[...new Set(missing)]};}
  function dynamicFieldControl(name){
    const val=esc(commFieldValues[name]||'');const id=`dyn-${normalize(name).replace(/ /g,'-')}`;
    if(/will renew/i.test(name))return `<label class="field-group dynamic-field"><span>${esc(name)}</span><select data-dynamic-name="${esc(name)}" id="${id}"><option value="">Select...</option><option${val==='Yes'?' selected':''}>Yes</option><option${val==='No'?' selected':''}>No</option></select></label>`;
    if(/availability type/i.test(name))return `<label class="field-group dynamic-field"><span>${esc(name)}</span><select data-dynamic-name="${esc(name)}" id="${id}"><option value="">Select...</option><option>Available on this date only</option><option>Available from this date onward</option></select></label>`;
    if(/date/i.test(name))return `<label class="field-group dynamic-field"><span>${esc(name)}</span><input type="date" data-dynamic-name="${esc(name)}" value="${val}" id="${id}" /></label>`;
    const long=/instruction|action|issue|situation|grades|course|reason|window|dates|record/i.test(name);
    if(long)return `<label class="field-group dynamic-field field-wide"><span>${esc(name)}</span><textarea data-dynamic-name="${esc(name)}" id="${id}" placeholder="Enter ${esc(name.toLowerCase())}">${val}</textarea></label>`;
    return `<label class="field-group dynamic-field"><span>${esc(name)}</span><input data-dynamic-name="${esc(name)}" value="${val}" id="${id}" placeholder="${esc(name)}" /></label>`;
  }
  function renderCommDocuments(placeholders){
    const needs=placeholders.some(isDocumentPlaceholder);const section=$('#commDocumentsSection');section.classList.toggle('hidden',!needs);if(!needs)return;
    const passportOnly=placeholders.some(x=>/passport page/i.test(x));const rows=(data.documentOptions||[]).filter(r=>yes(r.Active??'YES')).filter(r=>!passportOnly||normalize(r['Document Group'])==='passport');
    const groups=new Map();rows.forEach(r=>{const g=clean(r['Document Group'])||'Other';if(!groups.has(g))groups.set(g,[]);groups.get(g).push(r);});const html=[];
    for(const [group,items] of groups){items.forEach(r=>{const id=clean(r['Document ID']);html.push(`<label class="document-option"><input type="checkbox" data-doc-id="${esc(id)}" ${commSelectedDocs.has(id)?'checked':''}/><span><strong>${esc(r['Website Display Label']||r['Document Option'])}</strong><small>${esc(group)}</small></span></label>`);});}
    $('#commDocumentOptions').innerHTML=html.join('');
  }
  function setCommDraftState(){
    const el=$('#commDraftState');if(!el)return;
    const modified=commDraftDirty||commSubjectDirty;
    el.textContent=modified?'Modified · auto-update paused':'Generated · auto-updates';
    el.classList.toggle('modified',modified);
  }
  function renderCommBuilder(force=false){
    const r=findCommRecord();$('#commEmpty').classList.toggle('hidden',!!r);$('#commBuilder').classList.toggle('hidden',!r);if(!r)return;
    $('#commBuilderChannel').textContent=commChannel==='email'?'EMAIL':'CHAT REPLY';$('#commSelectedTopic').textContent=r.Topic||'';$('#commSelectedContext').textContent=r.Context||'';
    $('#commTemplateStatus').innerHTML=commChannel==='email'?'<span class="status-mini-dot ai"></span> AI draft template — verify':'<span class="status-mini-dot source"></span> Source template';
    const placeholders=extractPlaceholders(currentTemplateBody());const dynamic=placeholders.filter(x=>!casePlaceholderMap[x]&&!isDocumentPlaceholder(x));$('#commDynamicFields').innerHTML=dynamic.map(dynamicFieldControl).join('');renderCommDocuments(placeholders);
    $('#commSubjectWrap').classList.toggle('hidden',commChannel!=='email');renderSignatureSelect();renderCommOutput(force);
  }
  function renderCommOutput(force=false){
    const r=findCommRecord();if(!r)return;
    const result=applyTemplate(currentTemplateBody());
    const modified=commDraftDirty||commSubjectDirty;
    if(force||!commDraftDirty)$('#commBody').value=composeWithSignature(result.text,selectedSignatureContent());
    if(commChannel==='email'&&(force||!commSubjectDirty)){
      const subjectResult=applyTemplate(clean(r['Email Subject']));
      $('#commSubject').value=subjectResult.text;
    }
    const n=result.missing.length;
    const missingHtml=n?`${n} field${n===1?'':'s'} still missing: ${result.missing.map(name=>`<button type="button" class="missing-chip" data-missing-field="${esc(name)}">${esc(name)}</button>`).join(' ')}`:'Ready';
    $('#commMissingStatus').innerHTML=(modified?'Manual draft · ':'')+missingHtml;
    $('#commMissingStatus').style.color=n?'var(--warning)':'';
    setCommDraftState();
  }
  function selectCommTopic(id){selectedCommId=id;commFieldValues={};commSelectedDocs.clear();commDraftDirty=false;commSubjectDirty=false;renderCommTopicList();renderCommBuilder(true);}
  function setCommChannel(channel){commChannel=channel==='chat'?'chat':'email';selectedCommCategory='';selectedCommId='';commFieldValues={};commSelectedDocs.clear();commDraftDirty=false;commSubjectDirty=false;$$('.comm-channel').forEach(b=>b.classList.toggle('active',b.dataset.channel===commChannel));$('#commTopicSearch').value='';renderCommTopicList();renderCommBuilder(true);}
  function refreshCommunicationData(){if(!data)return;updateWorkspaceDataCounts();renderCommDatalists();renderCommTopicList();if(selectedCommId&&!findCommRecord())selectedCommId='';renderCommBuilder();updateDocumentCaseSummary();}
  function renderCommDatalists(){
    if(!data||!$('#countryOptions'))return;$('#countryOptions').innerHTML=data.countries.filter(r=>yes(r.Active??'YES')).map(r=>`<option value="${esc(r['Country EN'])}">${esc(r['Country TH']||'')}</option>`).join('');
    $('#majorOptions').innerHTML=data.faculty.filter(r=>yes(r.Active??'YES')).map(r=>{const v=majorENValue(r);return v?`<option value="${esc(v)}">${esc(facultyENValue(r)||'')}</option>`:'';}).join('');
    $('#embassyOptions').innerHTML=data.embassy.filter(r=>yes(r.Active??'YES')).map(r=>{const v=currentOr(r,'Current Display Name EN','Display Name EN');return v?`<option value="${esc(v)}"></option>`:'';}).join('');
  }
  function autoNationality(){const q=normalize($('#caseCountry').value);if(!q||!data)return;const hit=data.countries.find(r=>[r['Country EN'],r['Country TH'],r['Full Country Name EN'],r['Full Country Name TH']].some(v=>normalize(v)===q));if(hit)$('#caseNationality').value=clean(hit['Nationality EN']);renderCommOutput();updateDocumentCaseSummary();}
  function updateDocumentCaseSummary(){if(!$('#documentCaseSummary'))return;const values=[['Student',clean($('#caseStudentName')?.value)],['Number',clean($('#caseStudentNumber')?.value)],['Country',clean($('#caseCountry')?.value)],['Program',clean($('#caseMajor')?.value)]].filter(x=>x[1]);$('#documentCaseSummary').textContent=values.length?values.map(x=>`${x[0]}: ${x[1]}`).join('\n'):'No student case entered yet.';}
  function resetCommDraft(){commFieldValues={};commSelectedDocs.clear();commDraftDirty=false;commSubjectDirty=false;renderCommBuilder(true);toast('Message fields reset. Student case kept.');}
  function regenerateCommDraft(){commDraftDirty=false;commSubjectDirty=false;renderCommOutput(true);toast('Message regenerated from the current fields.');}
  function clearStudentCase(){
    const ids=['caseStudentNumber','caseStudentName','casePassportNo','caseCountry','caseNationality','caseMajor','caseEmbassy'];
    const hasData=ids.some(id=>clean($('#'+id)?.value))||Object.values(commFieldValues).some(clean)||commSelectedDocs.size;
    if(hasData&&!confirm('Start a new student case? This clears the current student information and message fields.'))return;
    ids.forEach(id=>{const el=$('#'+id);if(el)el.value='';});commFieldValues={};commSelectedDocs.clear();commDraftDirty=false;commSubjectDirty=false;renderCommBuilder(true);updateDocumentCaseSummary();toast('New student case ready.');
  }
  function focusMissingField(name){
    const caseId=casePlaceholderMap[name];let el=caseId?$('#'+caseId):null;
    if(!el&&isDocumentPlaceholder(name)){el=$('#commDocumentOptions input');}
    if(!el){el=$$('[data-dynamic-name]').find(x=>x.getAttribute('data-dynamic-name')===name)||null;}
    if(el){el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>el.focus(),180);}
  }
  function getRecent(){
    try{
      let list=JSON.parse(localStorage.getItem(RECENT_KEY)||'null');
      if(!Array.isArray(list)){
        const legacy=JSON.parse(localStorage.getItem(LEGACY_RECENT_KEY)||'[]');
        list=Array.isArray(legacy)?legacy.map(q=>({q:clean(q),tab:'all',ts:0})):[];
      }
      return list.map(item=>typeof item==='string'?{q:clean(item),tab:'all',ts:0}:item).filter(item=>clean(item?.q)).slice(0,RECENT_LIMIT);
    }catch{return[];}
  }
  function rememberQuery(q){
    q=clean(q);if(q.length<2)return;
    const list=getRecent().filter(item=>normalize(item.q)!==normalize(q));
    list.unshift({q,tab:activeTab,ts:Date.now()});
    localStorage.setItem(RECENT_KEY,JSON.stringify(list.slice(0,RECENT_LIMIT)));
    renderRecent();
  }
  function historyTabLabel(tab){return ({all:'All',countries:'Country',faculty:'Faculty',embassy:'Embassy'})[tab]||'All';}
  function historyTime(ts){if(!ts)return'';const d=new Date(ts);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});}
  function renderRecent(){
    const list=getRecent();
    $('#historyEmpty').classList.toggle('hidden',!!list.length);
    $('#recentChips').innerHTML=list.map((item,i)=>`<button class="history-item" type="button" data-recent-index="${i}"><span class="history-query">${esc(item.q)}</span><span class="history-meta">${esc(historyTabLabel(item.tab))}${item.ts?` · ${esc(historyTime(item.ts))}`:''}</span></button>`).join('');
    if(!query&&!browseMode)$('#starter').classList.toggle('hidden',list.length===0);
  }
  function clearRecent(){localStorage.removeItem(RECENT_KEY);localStorage.removeItem(LEGACY_RECENT_KEY);renderRecent();toast('Search history cleared.');}

  const THEMES={
    'light':{label:'Light',mode:'light',icon:'☀'},'dark':{label:'Dark',mode:'dark',icon:'◐'},'graphite':{label:'Graphite',mode:'dark',icon:'◼'},
    'purple-night':{label:'Purple Night',mode:'dark',icon:'◆'},'red-blue':{label:'Red-Blue',mode:'light',icon:'◒'},'forest':{label:'Forest',mode:'light',icon:'●'},'sand':{label:'Warm Sand',mode:'light',icon:'◐'}
  };
  function applyTheme(theme){
    const key=THEMES[theme]?theme:'light',cfg=THEMES[key];
    document.documentElement.setAttribute('data-theme',key);document.documentElement.setAttribute('data-theme-mode',cfg.mode);
    $('#themeIcon').textContent=cfg.icon;$('#themeLabel').textContent=cfg.label;$('#themeToggle').setAttribute('aria-label',`Current theme: ${cfg.label}. Choose theme.`);
    $$('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===key));
    try{localStorage.setItem(THEME_KEY,key);}catch{}
  }
  function initTheme(){let saved='';try{saved=localStorage.getItem(THEME_KEY)||'';}catch{}applyTheme(THEMES[saved]?saved:'light');}
  function toggleThemeMenu(force){const menu=$('#themeMenu');if(!menu)return;const open=typeof force==='boolean'?force:menu.classList.contains('hidden');menu.classList.toggle('hidden',!open);$('#themeToggle').setAttribute('aria-expanded',String(open));}

  function openLetterCreator(){
    if($('#caseStudentNumber') && !clean($('#studentNumber').value)) $('#studentNumber').value=clean($('#caseStudentNumber').value);
    if($('#caseStudentName') && !clean($('#studentName').value)) $('#studentName').value=clean($('#caseStudentName').value);
    $('#letterModal').classList.add('open');$('#letterModal').setAttribute('aria-hidden','false');
    updateLetterPreview();setTimeout(()=>$('#studentNumber').focus(),80);
  }
  function closeLetterCreator(){$('#letterModal').classList.remove('open');$('#letterModal').setAttribute('aria-hidden','true');}
  function sanitizePathPart(value){return clean(value).replace(/[<>:\"/\\|?*\x00-\x1F]/g,'').replace(/[. ]+$/g,'').trim();}
  function updateLetterPreview(){
    const num=sanitizePathPart($('#studentNumber').value)||'3408';
    const name=sanitizePathPart($('#studentName').value)||'Miss ABC';
    $('#folderPreview').textContent=`${num} ${name}`;
    $('#filePreview').textContent=`Letter_${name}.docx`;
  }
  const NO_IEN_OVERRIDE_KEY = 'bu-ic-bachelor-no-ien-template-override-v1';
  function customNoIenTemplate(){
    try {
      const entry=JSON.parse(localStorage.getItem(NO_IEN_OVERRIDE_KEY)||'null');
      if(entry && typeof entry.base64==='string' && entry.base64.length>100 && entry.filename) return entry;
    } catch(err) { console.warn('Could not read the personal No IEN template.',err); }
    return null;
  }
  function showNoIenTemplateState(){
    const tools=$('#noIenTemplateTools');
    if(!tools)return;
    tools.hidden=$('#letterType').value!=='bachelor_no_ien';
    const custom=customNoIenTemplate();
    const status=$('#letterNoIenStatus');
    if(status)status.textContent=custom
      ? `Using your imported template: ${custom.filename} (saved in this browser)`
      : "Using the website's shared Word template.";
    const reset=$('#letterNoIenReset');
    if(reset)reset.hidden=!custom;
  }
  async function importNoIenTemplate(file){
    if(!file)return;
    if(!/\.docx$/i.test(file.name))throw new Error('Please select a .docx Word file.');
    if(file.size<1024||file.size>3*1024*1024)throw new Error('The DOCX must be between 1 KB and 3 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes[0]!==0x50 || bytes[1]!==0x4b)throw new Error('This file is not a valid DOCX/ZIP document.');
    const blocks=[];
    for(let i=0;i<bytes.length;i+=0x8000)blocks.push(String.fromCharCode(...bytes.subarray(i,i+0x8000)));
    const entry={filename:file.name,base64:btoa(blocks.join('')),updatedAt:new Date().toISOString()};
    try{localStorage.setItem(NO_IEN_OVERRIDE_KEY,JSON.stringify(entry));}
    catch(err){throw new Error('Could not save the Word template in this browser. Check available browser storage.');}
    showNoIenTemplateState();
    toast('Bachelor Degree No IEN template imported for this browser.');
  }
  function templateBlob(key){
    const t=(key==='bachelor_no_ien'?customNoIenTemplate():null)||window.LETTER_TEMPLATES?.[key];
    if(!t)throw new Error('Letter template is missing.');
    const binary=atob(t.base64);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  }
  async function chooseDestination(){
    if(!window.showDirectoryPicker){toast('Folder creation needs Chrome or Edge with folder access support.');return false;}
    try{
      destinationHandle=await window.showDirectoryPicker({mode:'readwrite'});
      $('#destinationName').textContent=destinationHandle.name||'Selected folder';
      $('#destinationHelp').textContent='Student folders will be created inside this destination for this session.';
      toast(`Destination: ${destinationHandle.name||'selected'}`);return true;
    }catch(err){if(err?.name!=='AbortError'){console.error(err);toast(`Could not select folder: ${err.message}`);}return false;}
  }
  async function createLetterFolder(){
    const number=sanitizePathPart($('#studentNumber').value);
    const name=sanitizePathPart($('#studentName').value);
    const type=$('#letterType').value;
    if(!number){toast('Enter the student number.');$('#studentNumber').focus();return;}
    if(!name){toast('Enter the student name.');$('#studentName').focus();return;}
    if(number.length>60||name.length>120){toast('Number or name is too long for a folder/file name.');return;}
    if(!destinationHandle){const ok=await chooseDestination();if(!ok)return;}
    const folderName=`${number} ${name}`;const fileName=`Letter_${name}.docx`;
    try{
      const folder=await destinationHandle.getDirectoryHandle(folderName,{create:true});
      let exists=false;try{await folder.getFileHandle(fileName,{create:false});exists=true;}catch(err){if(err?.name!=='NotFoundError')throw err;}
      if(exists&&!window.confirm(`${fileName} already exists in ${folderName}. Replace it?`))return;
      const fileHandle=await folder.getFileHandle(fileName,{create:true});
      const writable=await fileHandle.createWritable();await writable.write(templateBlob(type));await writable.close();
      toast(`Created ${folderName} / ${fileName}`);
      $('#studentNumber').value='';$('#studentName').value='';updateLetterPreview();$('#studentNumber').focus();
    }catch(err){
      console.error(err);
      if(err?.name==='NotAllowedError'){destinationHandle=null;$('#destinationName').textContent='Permission required';$('#destinationHelp').textContent='Choose the destination again and allow write access.';}
      toast(`Could not create folder: ${err.message||err.name}`);
    }
  }

  function openDrawer(){$('#dataDrawer').classList.add('open');$('#dataDrawer').setAttribute('aria-hidden','false');}
  function closeDrawer(){$('#dataDrawer').classList.remove('open');$('#dataDrawer').setAttribute('aria-hidden','true');$('#excelDropZone').classList.remove('dragover');}
  function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2500);}
  async function copyText(text){const t=String(text||'').replace(/&#10;/g,'\n');try{await navigator.clipboard.writeText(t);toast('Copied');}catch{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('Copied');}}

  function setDegreeFilter(level){
    degreeFilter=['all','bachelor','master','doctor'].includes(level)?level:'all';
    $$('.degree-option').forEach(x=>x.classList.toggle('active',x.dataset.degree===degreeFilter));
    expandedGroups.clear();expandedCards.clear();search();
  }

  function changeTab(tab){activeTab=tab;$$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));const degreeEl=$('#facultyDegreeFilter');if(degreeEl)degreeEl.classList.toggle('hidden',tab!=='faculty');const ph={all:'Search everything — e.g. British, BUI, Yangon...',countries:'Search country, nationality, capital, ISO, Thai name...',faculty:'Search faculty or major — then choose Bachelor / Master / Doctor...',embassy:'Search embassy by country, city, Thai or English name...'};$('#searchInput').placeholder=ph[tab]||ph.all;expandedGroups.clear();expandedCards.clear();search();renderSearchSuggestions();}

  function initEvents(){
    $('.workspace-tab').forEach(b=>b.addEventListener('click',()=>setWorkspace(b.dataset.workspace)));
    $('#letterType')?.addEventListener('change',showNoIenTemplateState);
    $('#letterNoIenImport')?.addEventListener('change',async e=>{
      const input=e.target;
      try {await importNoIenTemplate(input.files?.[0]);}
      catch(err){console.error(err);toast(err.message||'Could not import the Word template.');}
      finally {input.value='';}
    });
    $('#letterNoIenReset')?.addEventListener('click',()=>{
      if(!window.confirm('Restore the website\'s shared Bachelor Degree No IEN template for this browser?'))return;
      localStorage.removeItem(NO_IEN_OVERRIDE_KEY);
      showNoIenTemplateState();
      toast('Restored the shared Bachelor Degree No IEN template.');
    });
    showNoIenTemplateState();
    $$('.comm-channel').forEach(b=>b.addEventListener('click',()=>setCommChannel(b.dataset.channel)));
    $('#commSignatureSelect').addEventListener('change',e=>applySignatureSelection(e.target.value));
    $('#manageSignatures').addEventListener('click',openSignatureManager);
    $$('[data-close-signature]').forEach(el=>el.addEventListener('click',closeSignatureManager));
    $('#addSignature').addEventListener('click',()=>openSignatureEditor());
    $('#cancelSignatureEdit').addEventListener('click',closeSignatureEditor);
    $('#saveSignature').addEventListener('click',saveSignatureFromEditor);
    $('#signatureList').addEventListener('click',e=>{const b=e.target.closest('[data-signature-action]');if(!b)return;const action=b.getAttribute('data-signature-action'),id=b.getAttribute('data-signature-id');if(action==='select')applySignatureSelection(id);else if(action==='edit')openSignatureEditor(id);else if(action==='duplicate')duplicateSignature(id);else if(action==='delete')deleteSignature(id);});
    $('#commTopicSearch').addEventListener('input',renderCommTopicList);
    $('#commCategoryList').addEventListener('click',e=>{const b=e.target.closest('[data-comm-category]');if(b)selectCommCategory(b.getAttribute('data-comm-category'));});
    $('#commTopicList').addEventListener('click',e=>{const b=e.target.closest('[data-comm-id]');if(b)selectCommTopic(b.getAttribute('data-comm-id'));});
    $('#commDynamicFields').addEventListener('input',e=>{const el=e.target.closest('[data-dynamic-name]');if(!el)return;commFieldValues[el.getAttribute('data-dynamic-name')]=el.value;renderCommOutput();});
    $('#commDynamicFields').addEventListener('change',e=>{const el=e.target.closest('[data-dynamic-name]');if(!el)return;commFieldValues[el.getAttribute('data-dynamic-name')]=el.value;renderCommOutput();});
    $('#commDocumentOptions').addEventListener('change',e=>{const cb=e.target.closest('[data-doc-id]');if(!cb)return;const id=cb.getAttribute('data-doc-id');cb.checked?commSelectedDocs.add(id):commSelectedDocs.delete(id);renderCommOutput();});
    $('#clearCommDocuments').addEventListener('click',()=>{commSelectedDocs.clear();renderCommOutput();});
    ['caseStudentNumber','caseStudentName','casePassportNo','caseNationality','caseMajor','caseEmbassy'].forEach(id=>$('#'+id).addEventListener('input',()=>{renderCommOutput();updateDocumentCaseSummary();}));
    $('#caseCountry').addEventListener('input',autoNationality);
    $('#resetCommDraft').addEventListener('click',resetCommDraft);
    $('#regenerateCommDraft').addEventListener('click',regenerateCommDraft);
    $('#clearStudentCase').addEventListener('click',clearStudentCase);
    $('#commBody').addEventListener('input',()=>{commDraftDirty=true;setCommDraftState();});
    $('#commSubject').addEventListener('input',()=>{commSubjectDirty=true;setCommDraftState();});
    $('#copyCommBody').addEventListener('click',()=>copyText($('#commBody').value));
    $('#copyCommAll').addEventListener('click',()=>copyText(commChannel==='email'?`Subject: ${$('#commSubject').value}\n\n${$('#commBody').value}`:$('#commBody').value));
    $('#documentsCreateFolder').addEventListener('click',openLetterCreator);
    $('#documentsGoCommunication').addEventListener('click',()=>setWorkspace('communication'));
    $('#dataPageLoadExcel').addEventListener('click',()=>$('#excelInput').click());
    $('#dataPageStatus').addEventListener('click',openDrawer);
    $('#searchInput').addEventListener('input',()=>{suggestionIndex=-1;search();renderSearchSuggestions();});
    $('#searchInput').addEventListener('focus',renderSearchSuggestions);
    $('#searchInput').addEventListener('keydown',e=>{
      if(!$('#searchSuggestions').classList.contains('hidden')&&suggestionItems.length){
        if(e.key==='ArrowDown'){e.preventDefault();suggestionIndex=(suggestionIndex+1)%suggestionItems.length;renderSearchSuggestions();return;}
        if(e.key==='ArrowUp'){e.preventDefault();suggestionIndex=suggestionIndex<0?suggestionItems.length-1:(suggestionIndex-1+suggestionItems.length)%suggestionItems.length;renderSearchSuggestions();return;}
        if(e.key==='Enter'&&suggestionIndex>=0){e.preventDefault();chooseSearchSuggestion(suggestionIndex);return;}
      }
      if(e.key==='Enter'&&query)rememberQuery(query);
    });
    $('#searchSuggestions').addEventListener('mousedown',e=>{const b=e.target.closest('[data-suggestion-index]');if(b){e.preventDefault();chooseSearchSuggestion(Number(b.getAttribute('data-suggestion-index')));}});
    $('#clearSearch').addEventListener('click',()=>{runQuery('');});
    $$('.tab').forEach(b=>b.addEventListener('click',()=>changeTab(b.dataset.tab)));
    $$('.degree-option').forEach(b=>b.addEventListener('click',()=>setDegreeFilter(b.dataset.degree)));
    $('#recentChips').addEventListener('click',e=>{const b=e.target.closest('[data-recent-index]');if(!b)return;const item=getRecent()[Number(b.getAttribute('data-recent-index'))];if(item){changeTab(item.tab||'all');runQuery(item.q);}});
    $('#clearRecent').addEventListener('click',clearRecent);
    $('#themeToggle').addEventListener('click',e=>{e.stopPropagation();toggleThemeMenu();});
    $('#themeMenu').addEventListener('click',e=>{const b=e.target.closest('[data-theme-choice]');if(!b)return;applyTheme(b.dataset.themeChoice);toggleThemeMenu(false);});
    $('#openLetterCreator')?.addEventListener('click',openLetterCreator);
    $$('[data-close-letter]').forEach(el=>el.addEventListener('click',closeLetterCreator));
    $('#studentNumber').addEventListener('input',updateLetterPreview);
    $('#studentName').addEventListener('input',updateLetterPreview);
    $('#chooseDestination').addEventListener('click',chooseDestination);
    $('#createLetterFolder').addEventListener('click',createLetterFolder);
    $('#showInactive').addEventListener('change',e=>{showInactive=e.target.checked;expandedGroups.clear();expandedCards.clear();search();});
    $('#reviewOnly').addEventListener('change',e=>{reviewOnly=e.target.checked;expandedGroups.clear();expandedCards.clear();search();});
    $('#loadExcelBtn')?.addEventListener('click',()=>$('#excelInput').click());
    $('#excelDropZone').addEventListener('click',()=>$('#excelInput').click());
    $('#excelInput').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)loadExcelFile(file);e.target.value='';});
    $('#excelDropZone').addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';$('#excelDropZone').classList.add('dragover');});
    $('#excelDropZone').addEventListener('dragleave',()=>$('#excelDropZone').classList.remove('dragover'));
    $('#excelDropZone').addEventListener('drop',e=>{e.preventDefault();$('#excelDropZone').classList.remove('dragover');const file=e.dataTransfer.files?.[0];if(file)loadExcelFile(file);});
    $('#dataPageRefreshHubBtn')?.addEventListener('click', () => { void syncHubReferences(true); });
    $('#drawerRefreshHubBtn')?.addEventListener('click', () => { void syncHubReferences(true); });
    $('#dataStatusBtn').addEventListener('click',openDrawer);$$('[data-close-drawer]').forEach(el=>el.addEventListener('click',closeDrawer));$('#resetDataBtn').addEventListener('click',resetBundled);
    document.addEventListener('click',e=>{if(!e.target.closest('.theme-picker-wrap'))toggleThemeMenu(false);if(!e.target.closest('.search-shell'))closeSearchSuggestions();const missing=e.target.closest('[data-missing-field]');if(missing){focusMissingField(missing.getAttribute('data-missing-field'));return;}const browse=e.target.closest('[data-browse-type]');if(browse){browseType(browse.getAttribute('data-browse-type'));return;}const restore=e.target.closest('[data-restore-import]');if(restore){restoreImportVersion(Number(restore.getAttribute('data-restore-import')));return;}const copy=e.target.closest('[data-copy]');if(copy){copyText(copy.getAttribute('data-copy'));return;}const floatBtn=e.target.closest('[data-float-ref]');if(floatBtn){openFloatingByKey(floatBtn.getAttribute('data-float-ref'));return;}const winAction=e.target.closest('[data-window-action]');if(winAction){const id=winAction.getAttribute('data-id');const action=winAction.getAttribute('data-window-action');if(action==='minimize')toggleFloatingMinimize(id);else if(action==='close')closeFloating(id);return;}const expand=e.target.closest('[data-expand-group]');if(expand){const key=expand.getAttribute('data-expand-group');expandedGroups.has(key)?expandedGroups.delete(key):expandedGroups.add(key);renderResults(lastGroups);return;}const cardToggle=e.target.closest('[data-toggle-card]');if(cardToggle){const key=cardToggle.getAttribute('data-toggle-card');expandedCards.has(key)?expandedCards.delete(key):expandedCards.add(key);renderResults(lastGroups);return;}});
    document.addEventListener('keydown',e=>{const toggle=e.target.closest && e.target.closest('[data-toggle-card]');if(toggle && toggle.tagName!=='BUTTON' && (e.key==='Enter' || e.key===' ')){e.preventDefault();const key=toggle.getAttribute('data-toggle-card');expandedCards.has(key)?expandedCards.delete(key):expandedCards.add(key);renderResults(lastGroups);}});
    document.addEventListener('mousedown',e=>{const handle=e.target.closest('[data-drag-handle]');if(!handle||e.target.closest('button'))return;const id=handle.getAttribute('data-drag-handle');const win=getFloatingEl(id);const w=floatingWindows.get(id);if(!win||!w)return;const rect=win.getBoundingClientRect();w.state.z=nextWindowZ();win.style.zIndex=String(w.state.z);dragState={id,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top};document.body.classList.add('dragging-window');e.preventDefault();});
    document.addEventListener('mousemove',e=>{if(!dragState)return;const w=floatingWindows.get(dragState.id);const win=getFloatingEl(dragState.id);if(!w||!win)return;const x=Math.max(0,Math.min(window.innerWidth-80,e.clientX-dragState.offsetX));const y=Math.max(72,Math.min(window.innerHeight-44,e.clientY-dragState.offsetY));w.state.x=x;w.state.y=y;win.style.left=`${x}px`;win.style.top=`${y}px`;});
    document.addEventListener('mouseup',()=>{if(dragState){const w=floatingWindows.get(dragState.id);const win=getFloatingEl(dragState.id);if(w&&win&&!w.state.minimized){w.state.width=win.offsetWidth;w.state.height=win.offsetHeight;}dragState=null;document.body.classList.remove('dragging-window');}else{$$('.floating-window').forEach(win=>{const w=floatingWindows.get(win.dataset.winId);if(w&&!w.state.minimized){w.state.width=win.offsetWidth;w.state.height=win.offsetHeight;}});}});
    document.addEventListener('keydown',e=>{if(activeWorkspace==='reference'&&(e.key==='/'||(e.key.toLowerCase()==='k'&&(e.ctrlKey||e.metaKey)))&&document.activeElement?.tagName!=='INPUT'&&document.activeElement?.tagName!=='SELECT'){e.preventDefault();$('#searchInput').focus();}if(e.key==='Escape'){if($('#signatureModal').classList.contains('open'))closeSignatureManager();else if($('#letterModal').classList.contains('open'))closeLetterCreator();else if($('#dataDrawer').classList.contains('open'))closeDrawer();else if($('#searchInput').value){runQuery('');}}});
  }

  function init(){
    loadSignatureLibrary();initTheme();ensureFloatingUI();initEvents();renderRecent();updateLetterPreview();let saved=null,meta=null;try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');meta=JSON.parse(localStorage.getItem(STORAGE_META_KEY)||'null');}catch{}
    if(saved)setRows(saved,meta||{type:'excel',title:'Saved Excel data',detail:'Previously loaded workbook data from this browser.'},false);else setRows(window.REFERENCE_SNAPSHOT,{type:'bundled',title:'Bundled data',detail:'Current V4.6.12 workbook snapshot included with this website.'},false);
    setWorkspace('reference');
    renderFloatingWindows();
    setTimeout(()=>$('#searchInput').focus(),120);
  }
  init();
  // Sync only public references; browser-local Excel imports have priority.
  void syncHubReferences();
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncHubReferences();
  }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncHubReferences();
  });
})();
