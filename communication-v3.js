(() => {
  'use strict';

  const DATA_KEY='bu-international-workspace-data-v4_6_12';
  const STATE_KEY='bu-ic-communication-v3-reload';
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const clean=v=>String(v??'').trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let managerChannel='email';
  let managerCategory='';
  let showRemoved=false;
  let editorMode='add';
  let editorId='';

  function rows(){
    try{const saved=JSON.parse(localStorage.getItem(DATA_KEY)||'null');if(saved&&typeof saved==='object')return saved;}catch{}
    return window.REFERENCE_SNAPSHOT||{};
  }
  function cloneRows(){return JSON.parse(JSON.stringify(rows()));}
  function spec(channel){return channel==='chat'?{sheet:'Chat Reply Library',id:'Chat ID',body:'Chat Reply Template',prefix:'CUSR'}:{sheet:'Email Library',id:'Topic ID',body:'Email Template',prefix:'EUSR'};}
  function records(channel,includeInactive=false){
    const s=spec(channel),table=rows()[s.sheet];
    if(!Array.isArray(table)||!Array.isArray(table[0]))return[];
    const h=table[0].map(clean);
    return table.slice(1).filter(Array.isArray).map((row,i)=>{
      const r=Object.fromEntries(h.map((k,j)=>[k,row[j]]));
      const topic=clean(r.Topic),active=clean(r.Active||'YES').toUpperCase()!=='NO';
      return {...r,_row:i+1,_channel:channel,_id:clean(r[s.id])||topic,_category:topic.split('—')[0].trim()||'Other',_option:topic.includes('—')?topic.split('—').slice(1).join('—').trim():topic,_active:active};
    }).filter(r=>includeInactive||r._active);
  }
  function channel(){return $('.comm-channel.active')?.dataset.channel==='chat'?'chat':'email';}
  function category(){return $('#commCategoryList .comm-category-item.active')?.getAttribute('data-comm-category')||'';}
  function activeRecord(){const b=$('#commTopicList .comm-topic-item.active');return b?records(channel()).find(r=>r._id===b.getAttribute('data-comm-id'))||null:null;}
  function topicTitle(r){return clean(r?._option||r?.Topic);}
  function findButton(root,attr,value){return $$(`[${attr}]`,$(root)||document).find(x=>x.getAttribute(attr)===value)||null;}

  function buildPicker(){
    const panel=$('.comm-builder-panel');
    if(!panel||$('#commV3Picker'))return;
    panel.insertAdjacentHTML('afterbegin',`<section class="comm-v3-picker" id="commV3Picker">
      <div class="comm-v3-picker-main">
        <div class="comm-v3-meta"><span id="commV3Channel">EMAIL</span><span>·</span><strong id="commV3Category">Choose a topic on the left</strong></div>
        <label class="comm-v3-select"><span>Sub-topic</span><select id="commV3Subtopic" disabled><option>Select a topic on the left first</option></select></label>
        <p id="commV3Context">Choose a main topic, then select the exact sub-topic here.</p>
      </div>
      <div class="comm-v3-picker-actions"><button class="secondary-btn compact" id="commV3EditCurrent" type="button" disabled>Edit message</button><button class="primary-btn compact" id="commV3Manage" type="button">Manage library</button></div>
    </section>`);
    $('#commV3Subtopic').addEventListener('change',e=>{const id=e.target.value;if(!id)return;findButton('#commTopicList','data-comm-id',id)?.click();setTimeout(syncPicker,0);});
    $('#commV3EditCurrent').addEventListener('click',()=>{const r=activeRecord();if(r)openEditor('edit',r);});
    $('#commV3Manage').addEventListener('click',openManager);
  }

  function syncPicker(){
    if(!$('#commV3Picker'))return;
    const ch=channel(),cat=category(),record=activeRecord(),sel=$('#commV3Subtopic');
    const list=cat?records(ch).filter(r=>r._category===cat).sort((a,b)=>topicTitle(a).localeCompare(topicTitle(b))):[];
    $('#commV3Channel').textContent=ch==='email'?'EMAIL':'CHAT REPLY';
    $('#commV3Category').textContent=cat||'Choose a topic on the left';
    sel.disabled=!cat;
    sel.innerHTML=cat?`<option value="">Select a sub-topic…</option>${list.map(r=>`<option value="${esc(r._id)}" ${record?._id===r._id?'selected':''}>${esc(topicTitle(r))}</option>`).join('')}`:'<option value="">Select a topic on the left first</option>';
    $('#commV3Context').textContent=record?clean(record.Context||record['Email Subject']||''):(cat?`${list.length} sub-topic${list.length===1?'':'s'} available.`:'Choose a main topic, then select the exact sub-topic here.');
    $('#commV3EditCurrent').disabled=!record;
  }

  function buildManager(){
    if($('#commV3Modal'))return;
    document.body.insertAdjacentHTML('beforeend',`<div class="comm-v3-modal" id="commV3Modal" aria-hidden="true">
      <button class="comm-v3-backdrop" type="button" data-v3-close></button>
      <section class="comm-v3-panel" role="dialog" aria-modal="true" aria-labelledby="commV3Title">
        <header class="comm-v3-head"><div><div class="comm-v3-kicker">COMMUNICATION LIBRARY</div><h2 id="commV3Title">Manage topics & messages</h2><p>Add, edit, move, remove, restore, or export your communication templates.</p></div><button class="icon-btn" type="button" data-v3-close>×</button></header>
        <div class="comm-v3-toolbar"><div class="comm-v3-channels"><button type="button" data-v3-channel="email">Email</button><button type="button" data-v3-channel="chat">Chat Reply</button></div><label class="comm-v3-show-removed"><input id="commV3ShowRemoved" type="checkbox"/> Show removed</label><button class="secondary-btn compact" id="commV3Export" type="button">Export updated Excel</button></div>
        <div class="comm-v3-body"><aside class="comm-v3-topics"><div class="comm-v3-section-head"><div><strong>Topics</strong><span>Main categories</span></div><button class="primary-btn compact" id="commV3AddTopic" type="button">+ Topic</button></div><div class="comm-v3-topic-list" id="commV3Topics"></div></aside><main class="comm-v3-messages"><div class="comm-v3-messages-head" id="commV3MessagesHead"></div><div class="comm-v3-message-list" id="commV3Messages"></div></main></div>
        <footer class="comm-v3-foot"><strong>Safe editing:</strong> Remove only marks a record inactive, so it can be restored. Changes are stored in this browser's working dataset; use Export updated Excel for a portable master copy.</footer>
      </section>
    </div>
    <div class="comm-v3-editor" id="commV3Editor" aria-hidden="true"><button class="comm-v3-backdrop" type="button" data-v3-editor-close></button><section class="comm-v3-editor-panel" role="dialog" aria-modal="true"><header class="comm-v3-head"><div><div class="comm-v3-kicker" id="commV3EditorKicker">EMAIL MESSAGE</div><h2 id="commV3EditorTitle">Add message</h2><p id="commV3EditorHelp">Create a reusable communication template.</p></div><button class="icon-btn" type="button" data-v3-editor-close>×</button></header><form class="comm-v3-editor-form" id="commV3EditorForm"><div class="comm-v3-editor-grid"><label class="field-group"><span>Topic</span><input id="commV3EditCategory" required placeholder="Documents"/></label><label class="field-group"><span>Sub-topic</span><input id="commV3EditSubtopic" required placeholder="Missing documents (general)"/></label><label class="field-group field-wide"><span>Context / staff note</span><input id="commV3EditContext" placeholder="When should staff use this message?"/></label><label class="field-group field-wide" id="commV3SubjectWrap"><span>Email subject</span><input id="commV3EditSubject" placeholder="Visa Request – Additional Documents Required"/></label><label class="field-group field-wide"><span>Message template</span><textarea id="commV3EditBody" rows="12" required placeholder="Dear [Student Name], ..."></textarea></label></div><div class="comm-v3-placeholders"><span>Insert placeholder</span><div id="commV3Placeholders"></div></div><div class="comm-v3-editor-actions"><button class="secondary-btn" type="button" data-v3-editor-close>Cancel</button><button class="primary-btn" type="submit" id="commV3Save">Save message</button></div></form></section></div>`);

    $$('[data-v3-close]').forEach(b=>b.addEventListener('click',closeManager));
    $$('[data-v3-editor-close]').forEach(b=>b.addEventListener('click',closeEditor));
    $$('[data-v3-channel]').forEach(b=>b.addEventListener('click',()=>{managerChannel=b.dataset.v3Channel==='chat'?'chat':'email';managerCategory='';renderManager();}));
    $('#commV3ShowRemoved').addEventListener('change',e=>{showRemoved=e.target.checked;managerCategory='';renderManager();});
    $('#commV3AddTopic').addEventListener('click',()=>openEditor('new-topic'));
    $('#commV3Export').addEventListener('click',exportWorkbook);
    $('#commV3Topics').addEventListener('click',e=>{const b=e.target.closest('[data-v3-topic]');if(!b)return;managerCategory=b.dataset.v3Topic;renderManager();});
    $('#commV3MessagesHead').addEventListener('click',handleHeadAction);
    $('#commV3Messages').addEventListener('click',handleMessageAction);
    $('#commV3EditorForm').addEventListener('submit',saveEditor);
    $('#commV3Placeholders').addEventListener('click',e=>{const b=e.target.closest('[data-v3-placeholder]');if(!b)return;const ta=$('#commV3EditBody'),t=b.dataset.v3Placeholder,start=ta.selectionStart??ta.value.length,end=ta.selectionEnd??start;ta.value=ta.value.slice(0,start)+t+ta.value.slice(end);ta.focus();ta.setSelectionRange(start+t.length,start+t.length);});
  }

  function openManager(){managerChannel=channel();managerCategory=category();showRemoved=false;$('#commV3ShowRemoved').checked=false;renderManager();$('#commV3Modal').classList.add('open');$('#commV3Modal').setAttribute('aria-hidden','false');}
  function closeManager(){$('#commV3Modal')?.classList.remove('open');$('#commV3Modal')?.setAttribute('aria-hidden','true');}
  function closeEditor(){$('#commV3Editor')?.classList.remove('open');$('#commV3Editor')?.setAttribute('aria-hidden','true');editorId='';}

  function categories(){
    const map=new Map();
    records(managerChannel,true).forEach(r=>{if(!showRemoved&&!r._active)return;if(!map.has(r._category))map.set(r._category,{name:r._category,total:0,active:0});const x=map.get(r._category);x.total++;if(r._active)x.active++;});
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
  }
  function renderManager(){
    $$('[data-v3-channel]').forEach(b=>b.classList.toggle('active',b.dataset.v3Channel===managerChannel));
    const cats=categories();
    if(managerCategory&&!cats.some(c=>c.name===managerCategory))managerCategory='';
    if(!managerCategory&&cats.length)managerCategory=cats[0].name;
    $('#commV3Topics').innerHTML=cats.length?cats.map(c=>`<button class="comm-v3-topic ${c.name===managerCategory?'active':''}" type="button" data-v3-topic="${esc(c.name)}"><span>${esc(c.name)}</span><small>${c.active}${showRemoved&&c.total!==c.active?` / ${c.total}`:''}</small></button>`).join(''):'<div class="comm-v3-empty">No topics yet.</div>';
    if(!managerCategory){$('#commV3MessagesHead').innerHTML='<div><strong>No topic selected</strong><span>Create a topic and its first message.</span></div><button class="primary-btn compact" data-v3-head="new-topic" type="button">+ Topic</button>';$('#commV3Messages').innerHTML='<div class="comm-v3-empty">Create your first topic to begin.</div>';return;}
    const all=records(managerChannel,true).filter(r=>r._category===managerCategory),active=all.filter(r=>r._active).length,removedTopic=active===0;
    $('#commV3MessagesHead').innerHTML=`<div><strong>${esc(managerCategory)}</strong><span>${active} active message${active===1?'':'s'}${showRemoved?` · ${all.length-active} removed`:''}</span></div><div class="comm-v3-head-actions"><button class="ghost-btn compact" data-v3-head="rename" type="button">Rename</button>${removedTopic?'<button class="secondary-btn compact" data-v3-head="restore-topic" type="button">Restore topic</button>':'<button class="ghost-btn compact comm-v3-danger" data-v3-head="remove-topic" type="button">Remove topic</button>'}<button class="primary-btn compact" data-v3-head="add-message" type="button">+ Message</button></div>`;
    const visible=showRemoved?all:all.filter(r=>r._active);
    $('#commV3Messages').innerHTML=visible.length?visible.map(r=>`<article class="comm-v3-message ${r._active?'':'removed'}"><div><div class="comm-v3-message-title"><strong>${esc(topicTitle(r))}</strong>${r._active?'':'<span class="comm-v3-removed-pill">Removed</span>'}</div><p>${esc(clean(r['Email Subject']||r.Context||''))}</p></div><div class="comm-v3-message-actions">${r._active?`<button class="secondary-btn compact" data-v3-msg="edit" data-v3-id="${esc(r._id)}" type="button">Edit</button><button class="ghost-btn compact" data-v3-msg="duplicate" data-v3-id="${esc(r._id)}" type="button">Duplicate</button><button class="ghost-btn compact comm-v3-danger" data-v3-msg="remove" data-v3-id="${esc(r._id)}" type="button">Remove</button>`:`<button class="secondary-btn compact" data-v3-msg="restore" data-v3-id="${esc(r._id)}" type="button">Restore</button>`}</div></article>`).join(''):'<div class="comm-v3-empty">No messages in this topic.</div>';
  }

  function handleHeadAction(e){const b=e.target.closest('[data-v3-head]');if(!b)return;const a=b.dataset.v3Head;if(a==='new-topic')openEditor('new-topic');else if(a==='add-message')openEditor('add');else if(a==='rename')startRename();else if(a==='remove-topic')setTopicActive(false);else if(a==='restore-topic')setTopicActive(true);}
  function handleMessageAction(e){const b=e.target.closest('[data-v3-msg]');if(!b)return;const r=records(managerChannel,true).find(x=>x._id===b.dataset.v3Id);if(!r)return;const a=b.dataset.v3Msg;if(a==='edit')openEditor('edit',r);else if(a==='duplicate')openEditor('duplicate',r);else if(a==='remove')setMessageActive(r,false);else if(a==='restore')setMessageActive(r,true);}

  function placeholders(ch){const a=['[Student Name]','[Student Number]','[Passport No]','[Country]','[Nationality]','[Program]','[Embassy/Consulate]'];if(ch==='email')a.push('[Selected Documents]');return a;}
  function openEditor(mode,r=null){editorMode=mode;editorId=r?._id||'';const ch=r?._channel||managerChannel||channel();managerChannel=ch;const newTopic=mode==='new-topic';$('#commV3Editor').dataset.channel=ch;$('#commV3EditorKicker').textContent=ch==='email'?'EMAIL MESSAGE':'CHAT REPLY';$('#commV3EditorTitle').textContent=newTopic?'Add topic + first message':mode==='edit'?'Edit message':mode==='duplicate'?'Duplicate message':'Add message';$('#commV3EditorHelp').textContent=newTopic?'A topic appears after its first sub-topic/message is saved.':'Edit the topic, sub-topic and reusable wording here.';$('#commV3EditCategory').value=newTopic?'':(r?._category||managerCategory||category());$('#commV3EditSubtopic').value=mode==='duplicate'?`${topicTitle(r)} (Copy)`:(r?topicTitle(r):'');$('#commV3EditContext').value=clean(r?.Context||'');$('#commV3EditSubject').value=ch==='email'?clean(r?.['Email Subject']||''):'';$('#commV3SubjectWrap').classList.toggle('hidden',ch!=='email');$('#commV3EditBody').value=clean(r?.[spec(ch).body]||'');$('#commV3Placeholders').innerHTML=placeholders(ch).map(p=>`<button type="button" data-v3-placeholder="${esc(p)}">${esc(p)}</button>`).join('');$('#commV3Save').textContent=mode==='edit'?'Save changes':'Save message';$('#commV3Editor').classList.add('open');$('#commV3Editor').setAttribute('aria-hidden','false');setTimeout(()=>$(newTopic?'#commV3EditCategory':'#commV3EditSubtopic')?.focus(),50);}

  function newId(data,ch){const s=spec(ch),table=data[s.sheet],h=table[0].map(clean),i=h.indexOf(s.id),used=new Set(table.slice(1).map(r=>clean(r?.[i])));let n=1;while(used.has(`${s.prefix}${String(n).padStart(3,'0')}`))n++;return`${s.prefix}${String(n).padStart(3,'0')}`;}
  function setValues(table,rowIndex,values){const h=table[0].map(clean),row=table[rowIndex];Object.entries(values).forEach(([k,v])=>{const i=h.indexOf(k);if(i>=0)row[i]=v;});}
  function appendRow(table,values){const h=table[0].map(clean),row=new Array(h.length).fill(null);Object.entries(values).forEach(([k,v])=>{const i=h.indexOf(k);if(i>=0)row[i]=v;});table.push(row);}

  function preserve(selectId=''){const ids=['caseStudentNumber','caseStudentName','casePassportNo','caseCountry','caseNationality','caseMajor','caseEmbassy'],fields=Object.fromEntries(ids.map(id=>[id,$('#'+id)?.value||'']));try{sessionStorage.setItem(STATE_KEY,JSON.stringify({channel:managerChannel||channel(),category:managerCategory||category(),id:selectId,fields,managerOpen:$('#commV3Modal')?.classList.contains('open'),showRemoved}));}catch{}}
  function saveReload(data,id,msg){localStorage.setItem(DATA_KEY,JSON.stringify(data));preserve(id);try{sessionStorage.setItem(STATE_KEY+'-msg',msg||'Communication library updated.');}catch{}location.reload();}

  function saveEditor(e){e.preventDefault();const ch=$('#commV3Editor').dataset.channel==='chat'?'chat':'email',s=spec(ch),cat=clean($('#commV3EditCategory').value),sub=clean($('#commV3EditSubtopic').value),ctx=clean($('#commV3EditContext').value),subject=clean($('#commV3EditSubject').value),body=clean($('#commV3EditBody').value);if(!cat)return $('#commV3EditCategory').focus();if(!sub)return $('#commV3EditSubtopic').focus();if(ch==='email'&&!subject)return $('#commV3EditSubject').focus();if(!body)return $('#commV3EditBody').focus();const data=cloneRows(),table=data[s.sheet];if(!Array.isArray(table)||!Array.isArray(table[0]))return alert('Communication sheet is missing from the current data.');const values={Topic:`${cat} — ${sub}`,Context:ctx,Active:'YES',[s.body]:body};if(ch==='email')values['Email Subject']=subject;let id=editorId;if(editorMode==='edit'&&id){const h=table[0].map(clean),ii=h.indexOf(s.id),ri=table.findIndex((r,i)=>i>0&&clean(r?.[ii])===id);if(ri<0)return alert('The original message could not be found.');setValues(table,ri,values);}else{id=newId(data,ch);appendRow(table,{[s.id]:id,...values});}managerChannel=ch;managerCategory=cat;closeEditor();saveReload(data,id,editorMode==='edit'?'Message updated.':'Message added.');}

  function setMessageActive(r,on){if(!on&&!confirm(`Remove “${topicTitle(r)}”?\n\nIt will be hidden from normal use but can be restored from Manage library.`))return;const data=cloneRows(),s=spec(r._channel),table=data[s.sheet],h=table[0].map(clean),ii=h.indexOf(s.id),ri=table.findIndex((x,i)=>i>0&&clean(x?.[ii])===r._id);if(ri<0)return;setValues(table,ri,{Active:on?'YES':'NO'});managerChannel=r._channel;managerCategory=r._category;saveReload(data,on?r._id:'',on?'Message restored.':'Message removed.');}

  function startRename(){const old=managerCategory,head=$('#commV3MessagesHead');head.innerHTML=`<form class="comm-v3-rename" id="commV3Rename"><label><span>Rename topic</span><input id="commV3RenameInput" value="${esc(old)}"/></label><div><button class="secondary-btn compact" type="button" id="commV3RenameCancel">Cancel</button><button class="primary-btn compact" type="submit">Save name</button></div></form>`;const input=$('#commV3RenameInput');input.focus();input.select();$('#commV3RenameCancel').addEventListener('click',renderManager);$('#commV3Rename').addEventListener('submit',e=>{e.preventDefault();const next=clean(input.value);if(!next||next===old)return renderManager();renameTopic(old,next);});}
  function renameTopic(old,next){const data=cloneRows(),s=spec(managerChannel),table=data[s.sheet],h=table[0].map(clean),ti=h.indexOf('Topic');let changed=0;table.slice(1).forEach(row=>{const t=clean(row?.[ti]),cat=t.split('—')[0].trim()||'Other';if(cat!==old)return;const opt=t.includes('—')?t.split('—').slice(1).join('—').trim():t;row[ti]=`${next} — ${opt}`;changed++;});if(!changed)return;managerCategory=next;saveReload(data,'',`Topic renamed to ${next}.`);}
  function setTopicActive(on){const name=managerCategory,all=records(managerChannel,true).filter(r=>r._category===name);if(!on&&!confirm(`Remove topic “${name}” and hide all ${all.filter(r=>r._active).length} active messages?\n\nYou can restore the topic later with Show removed.`))return;const data=cloneRows(),s=spec(managerChannel),table=data[s.sheet],h=table[0].map(clean),ii=h.indexOf(s.id),ai=h.indexOf('Active'),ids=new Set(all.map(r=>r._id));table.slice(1).forEach(row=>{if(ids.has(clean(row?.[ii]))&&ai>=0)row[ai]=on?'YES':'NO';});saveReload(data,'',on?`Topic ${name} restored.`:`Topic ${name} removed.`);}

  function ensureXlsx(){if(window.XLSX)return Promise.resolve(window.XLSX);return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';s.onload=()=>resolve(window.XLSX);s.onerror=()=>reject(new Error('Could not load the Excel export library.'));document.head.appendChild(s);});}
  async function exportWorkbook(){const b=$('#commV3Export'),old=b.textContent;b.disabled=true;b.textContent='Preparing…';try{const XLSX=await ensureXlsx(),wb=XLSX.utils.book_new();Object.entries(rows()).forEach(([name,table])=>{if(!Array.isArray(table)||!Array.isArray(table[0]))return;XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(table),String(name).slice(0,31));});XLSX.writeFile(wb,`Reference_Data_communication_${new Date().toISOString().slice(0,10)}.xlsx`);}catch(err){alert(`${err.message}\n\nAn internet connection may be required the first time Excel export is used.`);}finally{b.disabled=false;b.textContent=old;}}

  function restore(){let state=null;try{state=JSON.parse(sessionStorage.getItem(STATE_KEY)||'null');sessionStorage.removeItem(STATE_KEY);}catch{}if(!state)return;$('.workspace-tab[data-workspace="communication"]')?.click();setTimeout(()=>{const cb=$$('.comm-channel').find(b=>b.dataset.channel===state.channel);cb?.click();Object.entries(state.fields||{}).forEach(([id,v])=>{const el=$('#'+id);if(el){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));}});setTimeout(()=>{const r=state.id?records(state.channel).find(x=>x._id===state.id):null;if(r){findButton('#commCategoryList','data-comm-category',r._category)?.click();setTimeout(()=>findButton('#commTopicList','data-comm-id',r._id)?.click(),0);}else if(state.category)findButton('#commCategoryList','data-comm-category',state.category)?.click();if(state.managerOpen){managerChannel=state.channel;managerCategory=state.category||'';showRemoved=!!state.showRemoved;$('#commV3ShowRemoved').checked=showRemoved;renderManager();$('#commV3Modal').classList.add('open');$('#commV3Modal').setAttribute('aria-hidden','false');}syncPicker();let msg='';try{msg=sessionStorage.getItem(STATE_KEY+'-msg')||'';sessionStorage.removeItem(STATE_KEY+'-msg');}catch{}if(msg){const t=$('#toast');if(t){t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}}},20);},70);}

  function bind(){
    $('#commCategoryList')?.addEventListener('click',()=>setTimeout(syncPicker,0));
    $('#commTopicList')?.addEventListener('click',()=>setTimeout(syncPicker,0));
    $$('.comm-channel').forEach(b=>b.addEventListener('click',()=>setTimeout(syncPicker,0)));
    new MutationObserver(syncPicker).observe($('#commCategoryList'),{subtree:true,attributes:true,childList:true});
    new MutationObserver(syncPicker).observe($('#commTopicList'),{subtree:true,attributes:true,childList:true});
    document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if($('#commV3Editor')?.classList.contains('open'))closeEditor();else if($('#commV3Modal')?.classList.contains('open'))closeManager();});
  }

  function start(){
    if(!$('#workspaceCommunication')||!$('#commCategoryList')||!$('#commTopicList'))return setTimeout(start,40);
    buildPicker();buildManager();bind();
    const empty=$('#commEmpty');if(empty){const strong=$('strong',empty),p=$('p',empty);if(strong)strong.textContent='Choose a topic and sub-topic';if(p)p.textContent='Select a main topic on the left, then choose the exact sub-topic from the dropdown above.';}
    syncPicker();restore();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();