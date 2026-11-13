"use strict";
(() => {
 const section=document.getElementById('view-projects'),header=section.querySelector('header');header.querySelector('small').textContent='LIVE WORK · LOCAL';header.querySelector('h1').textContent='Work Activity';header.querySelector('mark').textContent='Owner controlled';
 const area=document.createElement('div');area.className='foreman-area';area.innerHTML='<article class="panel foreman-explainer"><h2>Tell Junction what to work on</h2><p>Use Chat normally. Name a file, folder or repository in your request; that message starts the work and keeps its context. Junction never copies a project into its own repository.</p><p>Example: <code>Work on Civlets and fix the failing build</code></p><p id="foreman-error" role="status"></p></article><div id="foreman-projects"></div>';section.querySelector('.projects-grid')?.remove();header.after(area);
 const list=area.querySelector('#foreman-projects'),error=area.querySelector('#foreman-error'),patches=new Map(),expandedContexts=new Set(),documentViews=new Map();let pending=false;
 const element=(tag,value,className='')=>{const e=document.createElement(tag);e.textContent=value;if(className)e.className=className;return e;};
 const call=async fn=>{try{error.textContent='';await fn();}catch(e){error.textContent=e.message;}finally{await refresh();}};
 const stopButton=p=>{const b=element('button','Stop work','danger');b.onclick=()=>call(()=>window.junction.foreman('task.control',{id:p.id,revision:p.revision,action:'stop'}));return b;};
 function statusText(p){if(['RUNNING','VERIFYING'].includes(p.status))return p.phase==='verifying'?'Verifying candidate':p.provider==='claude'?'Claude working':p.provider==='codex'?'Codex working':'Preparing approved work';if(p.status==='WAITING_CAPACITY')return p.nextAction||'Waiting for provider capacity';if(p.status==='WAITING_CODEX')return 'Waiting for legitimate Codex availability';if(p.status==='BLOCKED')return 'Blocked — tell Junction how to proceed in Chat';if(p.status==='PAUSED')return 'Paused — resume when ready';if(p.status==='STOPPED')return 'Stopped by owner';if(p.status==='DRAFT')return 'Awaiting your Start before implementation';if(p.status==='COMPLETED'&&p.sharedCheckout)return 'Verified in shared main checkout; awaiting engineering review and commit';if(p.status==='COMPLETED'&&(p.sourceObjectiveId||p.autoHandoff)&&!p.appliedAt)return 'Verified candidate ready for your patch review';if(p.status==='COMPLETED')return 'Current queue complete';return 'Waiting for an instruction in Chat';}
 function projectDocumentsEditor(project){
  const id=project.id,section=element('section',''),status=element('p','');status.setAttribute('role','status');
  const state=documentViews.get(id)||{query:'',documents:null,preview:null};documentViews.set(id,state);
  const matches=element('div',''),preview=element('div','');
  const load=async()=>{const result=await window.junction.foreman('project.documents',{id,query:state.query});state.documents=result.documents;};
  const perform=async fn=>{try{status.textContent='';await fn();render();}catch(e){status.textContent=e.message;}};
  const showDocument=(documentId,revision)=>perform(async()=>{
   const result=await window.junction.foreman('project.document.get',{id,documentId,revision});state.preview=result.document;
  });
  const render=()=>{
   matches.replaceChildren();preview.replaceChildren();
   for(const document of state.documents||[]){
    const button=element('button',`${document.name} · revision ${document.revision}`);button.type='button';
    button.onclick=()=>showDocument(document.id,document.revision);
    const remove=element('button','Remove document');remove.type='button';
    remove.onclick=()=>{
     if(!window.confirm(`Remove all saved revisions of “${document.name}” from Junction? The original file stays on disk.`))return;
     perform(async()=>{
      await window.junction.foreman('project.document.remove',{id,documentId:document.id,revision:document.revision,confirm:true});
      if(state.preview?.id===document.id)state.preview=null;
      await load();
     });
    };
    const row=element('div','');row.append(button,remove);matches.append(row);
   }
   if(state.documents&&!state.documents.length)matches.append(element('p',state.query?'No matching documents.':'No documents imported.'));
   if(!state.preview)return;
   const document=state.preview,latest=state.documents?.find(item=>item.id===document.id)?.revision||document.revision;
   const revision=element('select',''),label=element('label','Revision');
   for(let index=latest;index>=1;index--){const option=element('option',String(index));option.value=String(index);revision.append(option);}
   revision.value=String(document.revision);revision.onchange=()=>showDocument(document.id,Number(revision.value));label.append(revision);
   const close=element('button','Close preview');close.type='button';close.onclick=()=>{state.preview=null;render();};
   preview.append(element('h5',document.name),label,element('p',document.source),element('pre',document.content),close);
  };
  const form=element('form',''),query=element('input',''),label=element('label','Search saved documents');
  query.type='search';query.maxLength=120;query.value=state.query;label.append(query);form.append(label,element('button','Search'));
  form.onsubmit=event=>{event.preventDefault();perform(async()=>{state.query=query.value;state.preview=null;await load();});};
  const importButton=element('button','Import document');importButton.type='button';
  importButton.onclick=()=>perform(async()=>{
   importButton.disabled=true;
   try {
    const result=await window.junction.foreman('project.document.import',{id});
    if(result.cancelled)return;
    state.query='';query.value='';state.preview=null;await load();
    status.textContent=`Saved ${result.document.name}, revision ${result.document.revision}.`;
   } finally { importButton.disabled=false; }
  });
  section.append(element('h4','Project documents'),importButton,form,status,matches,preview);render();
  return section;
 }
 function projectContextEditor(project,threads){
  const context=project.context,details=element('details','');
  details.className='project-context';details.open=expandedContexts.has(project.id);
  details.ontoggle=()=>{if(details.open)expandedContexts.add(project.id);else expandedContexts.delete(project.id);};
  details.append(element('summary','Project context'));
  const change=entry=>call(()=>window.junction.foreman('project.context',{id:project.id,revision:project.revision,...entry}));
  const titles=new Map(threads.map(thread=>[thread.id,thread.title]));
  const linked=element('ul','');
  const showConversation=(id,removable)=>{
   const row=element('li',''),title=titles.get(id);
   if(title){
    const open=element('button',title);open.type='button';
    open.onclick=()=>call(async()=>{await openConversation(id);document.querySelector('[data-view="chat"]').click();});row.append(open);
   }else row.append(element('span','Conversation unavailable'));
   if(removable){const unlink=element('button','Unlink');unlink.type='button';unlink.onclick=()=>change({kind:'conversation',action:'remove',key:id});row.append(unlink);}
   linked.append(row);
  };
  details.append(element('h4','Linked conversations'));
  if(context.primaryConversationId)showConversation(context.primaryConversationId,false);
  for(const id of context.conversationIds)if(id!==context.primaryConversationId)showConversation(id,true);
  if(linked.children.length)details.append(linked);
  const candidates=threads.filter(thread=>thread.id!==context.primaryConversationId&&!context.conversationIds.includes(thread.id));
  if(candidates.length){
   const form=element('form',''),label=element('label','Conversation to link'),select=element('select','');
   for(const thread of candidates){const option=element('option',thread.title);option.value=thread.id;select.append(option);}
   label.append(select);form.append(label,element('button','Link conversation'));
   form.onsubmit=event=>{event.preventDefault();change({kind:'conversation',action:'link',key:select.value});};
   details.append(form);
  }
  const noteForm=(kind,entry)=>{
   const form=element('form',''),label=element('label',kind==='decision'?'Decision':'Question'),input=element('textarea','');
   input.maxLength=400;input.required=true;input.rows=2;input.value=entry?.text||'';label.append(input);form.append(label);
   const status=kind==='question'&&entry?element('select',''):null;
   if(status){
    for(const [value,title] of [['OPEN','Open'],['RESOLVED','Resolved']]){const option=element('option',title);option.value=value;status.append(option);}
    status.value=entry.status;const statusLabel=element('label','Question status');statusLabel.append(status);form.append(statusLabel);
   }
   form.append(element('button',entry?'Save changes':`Add ${kind}`));
   if(entry){const remove=element('button',`Remove ${kind}`);remove.type='button';remove.onclick=()=>change({kind,action:'remove',key:entry.id});form.append(remove);}
   form.onsubmit=event=>{event.preventDefault();change({kind,action:'save',...(entry?{key:entry.id}:{}),text:input.value,...(status?{status:status.value}:{})});};
   return form;
  };
  for(const [kind,entries] of [['decision',context.decisions],['question',context.questions]]){
   details.append(element('h4',kind==='decision'?'Decisions':'Questions'));
   for(const entry of entries)details.append(noteForm(kind,entry));
   details.append(noteForm(kind));
  }
  details.append(projectDocumentsEditor(project));
  return details;
 }
 async function refresh(){if(pending)return;pending=true;try{const [{projects},threads]=await Promise.all([window.junction.foreman('project.list'),window.junction.conversations()]);list.replaceChildren();if(!projects.length)list.append(element('p','No active work yet. Give Junction a development instruction in Chat.'));
  for(const row of projects){const {project:p}=await window.junction.foreman('project.get',{id:row.id});const card=element('article','');card.className='delegation-card';card.append(element('h3',`${p.name} · ${p.status.replaceAll('_',' ')}`),element('strong',statusText(p)),element('p',p.repoPath||''),element('p',p.objective));
   if(p.sourceObjectiveId)card.append(element('p',p.sharedCheckout?'Nethra proposed this work. Codex reviewed the proposal. Choose “Start with Codex and Claude” to authorize both providers.':'Nethra proposed this work. Codex reviewed the proposal; your Start authorizes isolated implementation. Applying its verified patch is a separate choice.'));
   if(p.sharedCheckout)card.append(element('p','Codex and Claude share the original main checkout. Start authorizes scoped file edits; Nethra will not commit or push. Pause stops further dispatch.'));
   if(['WAITING_CAPACITY','WAITING_CODEX'].includes(p.status)){const recheck=element('button','Check provider availability','secondary');recheck.onclick=()=>call(()=>window.junction.foreman('task.control',{id:p.id,revision:p.revision,action:'retry'}));card.append(recheck);}
   if(p.status==='DRAFT'){const start=element('button','Start scoped work','primary');const needsAcceptance=p.sourceObjectiveId&&p.tasks.some(task=>!task.acceptance||task.acceptance.trim().length<30);const needsReview=p.sourceObjectiveId&&p.codeReviewVerdict!=='READY';if(needsAcceptance||needsReview){start.disabled=true;card.append(element('p',needsAcceptance?'Nethra must give measurable acceptance criteria before this draft can start. Ask her to prepare a revised proposal.':'Codex requested a revision or has not marked this exact proposal ready. Ask Nethra to prepare a revised proposal.'));}start.onclick=()=>call(()=>window.junction.foreman('task.control',{id:p.id,revision:p.revision,action:'start'}));card.append(start);}
   if(!p.autoHandoff&&['DRAFT','PAUSED','STOPPED','BLOCKED'].includes(p.status)){
     const handoff=element('button','Start with Codex and Claude','secondary');
     handoff.disabled=Boolean(p.sourceObjectiveId&&p.codeReviewVerdict!=='READY');
     handoff.onclick=()=>{if(window.confirm(p.sharedCheckout?'Approve Codex and Claude to take turns editing this scope in the shared main checkout? Neither Nethra nor this action commits or pushes.':'Approve Codex and Claude to work on this scope and hand off automatically? The candidate stays isolated until you review and apply it.'))call(()=>window.junction.foreman('task.control',{id:p.id,revision:p.revision,action:p.status==='DRAFT'?'start':'resume',autoHandoff:true}));};
     card.append(handoff);
   }
   if(p.status==='DRAFT'&&p.sourceObjectiveId)card.append(stopButton(p));
   const active=['RUNNING','VERIFYING','WAITING_CODEX','WAITING_CAPACITY'].includes(p.status);
   if(active){
     const actions=element('div','');actions.className='delegation-actions';
     const pause=element('button','Pause work','secondary');
     pause.onclick=()=>call(()=>window.junction.foreman('task.control',{id:p.id,revision:p.revision,action:'pause'}));
     actions.append(pause,stopButton(p));card.append(actions);
   }else if(['PAUSED','STOPPED','BLOCKED'].includes(p.status)){
     const resume=element('button','Resume approved work','primary');
     resume.onclick=()=>call(()=>window.junction.foreman('task.control',{id:p.id,revision:p.revision,action:'resume'}));
     card.append(resume);
     if(p.status==='PAUSED'&&p.statusRecord?.capacityWait)card.append(stopButton(p));
   }
   const restoredWait=p.statusRecord?.capacityWait;
   if(restoredWait)card.append(element('p',restoredWait.line));
   else if(p.retryAt&&p.status!=='STOPPED')card.append(element('p',`Next capacity check: ${new Date(p.retryAt).toLocaleString()}`));
   const capacity=p.tasks.find(task=>task.id===p.activeTask)?.lastAttempt?.capacity;
   if(capacity)for(const [provider,label] of [['codex','Codex'],['claude','Claude']]){
     const item=capacity[provider];
     const windows=item?.windows.map(w=>`${w.minutes===300?'5h':w.minutes===10080?'weekly':w.name||'window'} ${w.usedPercent}% used · resets ${new Date(w.resetsAt).toLocaleString()}`).join(' / ');
     card.append(element('p',`${label}: ${windows||'Usage unknown'}${item?.checkedAt?` · checked ${new Date(item.checkedAt).toLocaleTimeString()}`:''}`));
   }
   for(const t of p.tasks.slice(-8)){const d=element('details','');d.append(element('summary',`${t.title} · ${t.kind==='verify'?'Verification':t.lastAttempt?.provider==='claude'?'Claude':t.lastAttempt?.provider==='codex'?'Codex':'Queued for assignment'} · ${t.status}`),element('p',t.acceptance));if(t.lastAttempt)d.append(element('pre',JSON.stringify(t.lastAttempt,null,2)));card.append(d);}if(p.handoff)card.append(element('p',`Latest: ${p.handoff}`));if(p.lastBackup)card.append(element('p',`Rollback checkpoint: ${p.lastBackup}`));
   if((p.sourceObjectiveId||p.autoHandoff)&&p.verifiedSha&&!p.appliedAt){const review=element('button','Review exact patch','secondary');review.onclick=()=>call(async()=>{const result=await window.junction.foreman('task.review',{id:p.id,revision:p.revision});patches.set(p.id,{headSha:result.headSha,diffHash:result.diffHash,patch:result.patch});});card.append(review);
    const shown=patches.get(p.id);if(shown&&shown.headSha===p.verifiedSha&&shown.diffHash===p.reviewed?.diffHash){card.append(element('pre',shown.patch,'foreman-patch'));const apply=element('button',p.sharedCheckout?'Acknowledge reviewed changes':'Apply this reviewed patch','primary');apply.onclick=()=>{if(window.confirm(p.sharedCheckout?'Acknowledge this verified shared-checkout diff? No files will be changed or committed.':'Apply the exact reviewed patch to the original checkout? It will be staged for inspection.'))call(()=>window.junction.foreman('task.apply',{id:p.id,revision:p.revision}));};card.append(apply);}}
   if(p.appliedAt)card.append(element('p',`Reviewed patch applied and staged ${new Date(p.appliedAt).toLocaleString()}. Inspect and commit it when ready.`));
   if(p.context)card.append(projectContextEditor(p,threads));
   const logButton=element('button','Show activity log','secondary');logButton.onclick=()=>call(async()=>{let after=0,lines=[];for(let page=0;page<20;page++){const {events}=await window.junction.foreman('project.get',{id:p.id,after});if(!events.length)break;lines.push(...events.map(e=>`${new Date(e.at).toLocaleString()} ${e.kind}: ${e.detail}`));after=events.at(-1).seq;}card.append(element('pre',lines.join('\n')));});card.append(logButton);list.append(card);}
 }catch(e){error.textContent=e.message;}finally{pending=false;}}
 const chat=document.querySelector('#view-chat .conversation'),banner=element('div','');banner.id='work-status';banner.className='work-status hidden';chat.prepend(banner);
 async function refreshBanner(){try{const {projects}=await window.junction.foreman('project.list'),p=projects.find(item=>['RUNNING','VERIFYING','WAITING_CODEX','WAITING_CAPACITY'].includes(item.status));if(!p){banner.classList.add('hidden');banner.replaceChildren();return;}banner.classList.remove('hidden');banner.replaceChildren(element('span',`${p.name}: ${statusText(p)}`));banner.append(stopButton(p));}catch{}}
 document.querySelector('[data-view="projects"]').addEventListener('click',refresh);setInterval(()=>{refreshBanner();if(section.classList.contains('active')&&!document.activeElement?.closest('.project-context'))refresh();},3000);refresh();refreshBanner();
})();
