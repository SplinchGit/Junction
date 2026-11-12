'use strict';
(()=>{
 const el=(tag,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};
 const section=el('aside');section.id='nethra-task-drawer';section.className='nethra-task-drawer';section.setAttribute('aria-label','Nethra tasks');section.setAttribute('aria-hidden','true');section.inert=true;
 const header=el('header'),title=el('h2','Nethra tasks'),close=el('button','×');close.type='button';close.setAttribute('aria-label','Close task drawer');header.append(title,close);section.append(header);
 const area=el('div');area.className='foreman-area';section.append(area);
 const page=el('section');page.className='view';page.id='view-tasks';page.setAttribute('aria-hidden','true');
 const pageHeader=el('header');const pageTitle=el('div');pageTitle.append(Object.assign(el('small','NETHRA · ON YOUR PC'),{}),el('h1','Tasks'));pageHeader.append(pageTitle,Object.assign(el('mark','Keeps working when this window is closed'),{}));
 const layout=el('div');layout.className='tasks-page';const detailPane=el('div');detailPane.className='task-detail-pane';detailPane.setAttribute('aria-live','polite');
 section.classList.add('tasks-list-pane');queueMicrotask(()=>{area.append(reunion);notice.classList.add('task-line');area.append(notice);});section.inert=false;section.removeAttribute('aria-hidden');layout.append(section,detailPane);page.append(pageHeader,layout);document.querySelector('main').append(page);
 const notice=el('p','Tasks and agent assignments run on your Windows PC. The local scheduler runs one assignment at a time.');area.append(notice);
 const reunion=el('details');reunion.append(el('summary','Since you were away'));const reunionBody=el('div','Checking saved activity…');reunion.append(reunionBody);area.append(reunion);
 const error=el('p');error.role='status';area.append(error);
 const form=el('form');form.className='panel';const goal=el('textarea');goal.placeholder='Give Nethra a goal and describe what success looks like';goal.setAttribute('aria-label','Objective');goal.rows=3;goal.required=true;goal.maxLength=10000;
 const roots=el('input');roots.placeholder='Optional approved read folder on this PC';roots.setAttribute('aria-label','Approved read folder');
 const persistent=el('input');persistent.type='checkbox';persistent.checked=true;const persistenceLabel=el('label',' Continue autonomously across restarts');persistenceLabel.prepend(persistent);
 const select=(label,values,chosen)=>{const wrapper=el('label',label);const field=el('select');for(const [value,title] of values){const option=el('option',title);option.value=value;field.append(option);}field.value=chosen;wrapper.append(field);return {wrapper,field};};
 const taskModels=[['qwen3:30b','Qwen3 30B · thinking'],['junction-qwen3-next:80b-q3km','Qwen3-Next 80B · instruct'],['junction-qwen3-next-thinking:80b-q3km','Qwen3-Next 80B · Thinking Q3'],['junction-qwen3-next-thinking:80b-q4km','Qwen3-Next 80B · Thinking Q4']];
 const newTaskModel=select('Task model ',taskModels,'qwen3:30b');
 const mode=select('Objective type ',[['FINITE','Finish when achieved'],['ONGOING','Keep monitoring after each result']],'FINITE');
 const autonomy=select('Autonomy ',[['QUIET','Quiet monitoring'],['BALANCED','Balanced initiative'],['ACTIVE','Active exploration']],'BALANCED');
 const priority=select('Priority ',[[1,'1 · Highest'],[2,'2 · High'],[3,'3 · Normal'],[4,'4 · Low'],[5,'5 · Lowest']],'3');
 const checkIn=select('Direction check-in ',[['DAILY','Daily'],['WEEKLY','Weekly'],['MILESTONES','At milestones or blockers'],['MANUAL','Manual only']],'WEEKLY');
 const policyFields=el('div');policyFields.className='objective-policy';policyFields.append(newTaskModel.wrapper,mode.wrapper,autonomy.wrapper,priority.wrapper,checkIn.wrapper);
 const checkbox=(text,checked=false)=>{const input=el('input');input.type='checkbox';input.checked=checked;const label=el('label',text);label.prepend(input);return {label,input};};
 const watchCalendar=checkbox(' Watch my Google Calendar (read-only)'),watchGmail=checkbox(' Watch new Gmail inbox mail (headers only)'),codeWorkNew=checkbox(' Allow Codex advice and development drafts (uses shared plan allowance)');
 const continuousNew=checkbox(' Keep working continuously until done',true);const create=el('button','Create task');create.type='submit';const moreOptions=el('details');moreOptions.className='task-more-options';moreOptions.append(el('summary','More options'),roots,persistenceLabel,policyFields,watchCalendar.label,watchGmail.label,codeWorkNew.label,el('p','Advice is limited to three Codex calls per UTC day across all tasks. Development drafts wait in Work Activity until you start them.'));form.append(goal,continuousNew.label,moreOptions,create);const createDetails=el('details');createDetails.className='task-create-details';createDetails.append(el('summary','+ New task'),form);area.append(createDetails);
 const settings=el('article');settings.className='panel';const thinking=el('input');thinking.type='checkbox';thinking.checked=true;thinking.disabled=true;const thinkingLabel=el('label',' Thinking is always on with Qwen3 30B');thinkingLabel.prepend(thinking);
 const startup=el('input');startup.type='checkbox';const startupLabel=el('label',' Start Nethra after Windows sign-in');startupLabel.prepend(startup);const modelStatus=el('p','Checking host…');settings.append(thinkingLabel,startupLabel,modelStatus);document.querySelector('.settings').append(settings);
 // Model warm-up and proactive updates. Loading never generates a reply or touches chats.
 const warmPanel=el('article');warmPanel.className='panel';warmPanel.append(el('h2','Model readiness and updates'),el('p','Junction can load Qwen3 30B before you need it. A load uses about 10 GB of GPU memory and 9 GB of system RAM on this PC and is skipped automatically when free memory is low.'));
 const warmGrid=el('div');warmGrid.className='appearance-grid';warmPanel.append(warmGrid);
 const warmStartup=select('Load model at launch ',[['desktop','When I open Junction'],['always','Also at Windows sign-in'],['never','Only when I chat']],'desktop');
 const retention=select('Keep loaded after last use ',[['15m','15 minutes'],['30m','30 minutes'],['1h','1 hour'],['2h','2 hours (default)'],['4h','4 hours'],['8h','8 hours']],'2h');
 const BUDGETS={none:[null,null],'4h':[4*3600000,8*3600000],'2h':[2*3600000,4*3600000],'1h':[3600000,2*3600000],'20m':[1200000,3600000]};
 const taskBudget=select('Task model time per day ',[['none','No limit (chats still come first)'],['4h','4 h per task, 8 h total'],['2h','2 h per task, 4 h total'],['1h','1 h per task, 2 h total'],['20m','20 min per task, 1 h total']],'20m');
 const proactive=select('Task updates in chat ',[['ALL','Milestones and outcomes'],['IMPORTANT','Only outcomes and requests'],['OFF','None (Tasks only)']],'ALL');
 const quietOn=checkbox(' Quiet hours (hold task updates)'),quietStart=el('input'),quietEnd=el('input');quietStart.type=quietEnd.type='time';
 const quietStartLabel=el('label','Quiet from ');quietStartLabel.append(quietStart);const quietEndLabel=el('label','until ');quietEndLabel.append(quietEnd);
 warmGrid.append(warmStartup.wrapper,retention.wrapper,taskBudget.wrapper,proactive.wrapper,quietOn.label,quietStartLabel,quietEndLabel);document.querySelector('.settings').append(warmPanel);
 const saveSetting=patch=>perform(()=>api('nethra.settings',patch));
 const taskAgents=checkbox(' Allow full task agents');
 taskAgents.input.onchange=()=>saveSetting({taskAgentsEnabled:taskAgents.input.checked});
 const researchAgents=checkbox(' Allow read-only research helpers');
 researchAgents.input.onchange=()=>saveSetting({childDelegation:researchAgents.input.checked});
 warmGrid.append(taskAgents.label,el('p','Turning off full task agents pauses their work.'),researchAgents.label);
 const advisorPanel=el('article');advisorPanel.className='panel';advisorPanel.append(el('h2','Self-improvement advisors'),el('p','On tasks where you enable self-improvement, Nethra may ask Codex and Claude for read-only advice whenever your live plan usage allows. It stops when any usage window reaches the ceiling below and resumes after that window resets.'));
 const reserve=select('Keep for my own use ',[[0,'Nothing (use everything available)'],[5,'5%'],[10,'10% (default)'],[20,'20%'],[30,'30%'],[50,'50%']],'10');const advisorStatus=el('p','Usage not checked yet.');
 const describeAdvisor=(label,item)=>!item?.ready?`${label}: ${item?.detail||'not signed in'}`:item.limits?.error?`${label}: usage unavailable (${item.limits.error})`:`${label}: ${item.limits?.available?'available':'resting'} · ${(item.limits?.windows||[]).filter(w=>!w.stale).map(w=>`${w.name.replace('_',' ')} ${w.usedPercent}%`).join(', ')||item.limits?.source||'no reading yet'}${item.limits?.nextAvailableAt?` · back at ${time(item.limits.nextAvailableAt)}`:''}`;
 const checkAdvisors=()=>api('nethra.advisors').then(value=>{advisorStatus.textContent=`${describeAdvisor('Codex',value.codex)}\n${describeAdvisor('Claude',value.claude)}`;}).catch(error=>{advisorStatus.textContent=`Could not check usage: ${error.message}`;});
 advisorStatus.style.whiteSpace='pre-line';reserve.field.onchange=()=>saveSetting({advisorReservePercent:Number(reserve.field.value)});const checkNow=el('button','Check usage now');checkNow.type='button';checkNow.onclick=checkAdvisors;advisorPanel.append(reserve.wrapper,advisorStatus,checkNow);document.querySelector('.settings').append(advisorPanel);
 warmStartup.field.onchange=()=>saveSetting({warmOnStartup:warmStartup.field.value});retention.field.onchange=()=>saveSetting({idleRetention:retention.field.value});proactive.field.onchange=()=>saveSetting({proactiveUpdates:proactive.field.value});taskBudget.field.onchange=()=>{const [task,total]=BUDGETS[taskBudget.field.value];saveSetting({objectiveDailyMs:task,globalDailyMs:total});};
 const saveQuiet=()=>{if(quietStart.value&&quietEnd.value)saveSetting({quietHours:{enabled:quietOn.input.checked,start:quietStart.value,end:quietEnd.value}});};quietOn.input.onchange=saveQuiet;quietStart.onchange=saveQuiet;quietEnd.onchange=saveQuiet;
 const showSettings=value=>{if(!value)return;taskAgents.input.checked=value.taskAgentsEnabled===true;researchAgents.input.checked=value.childDelegation===true;taskBudget.field.value=Object.keys(BUDGETS).find(key=>BUDGETS[key][0]===(value.objectiveDailyMs??null))||'20m';reserve.field.value=String(value.advisorReservePercent??10);warmStartup.field.value=value.warmOnStartup||'desktop';retention.field.value=value.idleRetention||'2h';proactive.field.value=value.proactiveUpdates||'ALL';quietOn.input.checked=Boolean(value.quietHours?.enabled);quietStart.value=value.quietHours?.start||'22:00';quietEnd.value=value.quietHours?.end||'07:00';};
 // Read-only Google grants owned by this PC; consent opens in the default browser. Each source has its own grant.
 const sourcePanel=(key,label,noun)=>{
   const panel=el('article');panel.className='panel';const status=el('p',`${label}: checking…`);
   const id=el('input');id.placeholder='Desktop OAuth client ID (…apps.googleusercontent.com)';id.setAttribute('aria-label',`${label} OAuth client ID`);
   const secret=el('input');secret.type='password';secret.placeholder='Client secret shown with the Desktop client';secret.setAttribute('aria-label',`${label} OAuth client secret`);
   const buttons=el('div');buttons.className='objective-policy';panel.append(el('h2',label),status,id,secret,buttons);document.querySelector('.settings').append(panel);
   const call=async action=>(await api(`nethra.source.${key}`,{action,...(action==='connect'?{clientId:id.value.trim(),clientSecret:secret.value.trim()}:{})}))[key];
   const describe=c=>c.status==='DISCONNECTED'?`${label}: not connected. Nethra cannot see your ${noun}.`:c.status==='CONNECTED'?`${label}: connected (${c.scope}) · ${c.items} watched item(s) · last checked ${new Date(c.lastSyncAt).toLocaleString()}`:c.status==='STALE'?`${label}: connected but not checked since ${c.lastSyncAt?new Date(c.lastSyncAt).toLocaleString():'connection'}`:`${label}: ${c.error}`;
   const show=c=>{status.textContent=describe(c);const connected=c.status!=='DISCONNECTED';id.hidden=secret.hidden=connected;
     buttons.replaceChildren(...(connected?[button('Check now',async()=>show(await call('sync'))),button('Disconnect',async()=>show(await call('disconnect')))]:[button('Connect read-only',async()=>{status.textContent='Finish consent in your browser…';show(await call('connect'));secret.value='';})]));};
   return show;
 };
 const showCalendar=sourcePanel('calendar','Google Calendar','calendar'),showGmail=sourcePanel('gmail','Gmail','mail');
 const chatThinking=el('div','Thinking on');chatThinking.id='chat-thinking';chatThinking.className='research-toggle fixed-option';chatThinking.title='Qwen3 30B uses thinking on every reply';chatThinking.setAttribute('aria-disabled','true');document.getElementById('research-toggle').after(chatThinking);window.junction.provider().then(renderChatSelection).catch(()=>{});
 const openObjectives=el('button','Continue as objective');openObjectives.id='new-objective';openObjectives.type='button';openObjectives.className='research-toggle';document.querySelector('.chat-options-panel').append(openObjectives);
 const objectiveStatus=el('button','Tasks');objectiveStatus.id='objective-status';objectiveStatus.type='button';objectiveStatus.title='View active Nethra tasks and next wakes';objectiveStatus.setAttribute('aria-controls','nethra-task-drawer');objectiveStatus.setAttribute('aria-expanded','false');document.getElementById('new-chat').before(objectiveStatus);
 const taskFilters=el('div');taskFilters.className='task-list-filters';
 const taskSearch=el('input');taskSearch.type='search';taskSearch.placeholder='Search tasks';taskSearch.setAttribute('aria-label','Search tasks');
 const taskFilter=el('select');taskFilter.setAttribute('aria-label','Show tasks');
 for(const [value,label] of [['active','Active tasks'],['finished','Finished tasks'],['all','All tasks']]){const option=el('option',label);option.value=value;taskFilter.append(option);}
 taskFilters.append(taskSearch,taskFilter);area.append(taskFilters);
 const list=el('div');area.append(list);let loading=false,refreshAgain=false,selectedId=null,lastObjectives=[];
 const strip=el('button');strip.id='nethra-chat-strip';strip.type='button';strip.hidden=true;strip.setAttribute('aria-label','Open task details for this chat');document.querySelector('#view-chat .conversation').prepend(strip);
 const api=(type,payload={})=>window.junction.nethra(type,payload);
 const visible=task=>!['COMPLETED','CANCELLED','FAILED'].includes(task.status);
 const needsOwner=kind=>['approval','input','blocked','owner_resume'].includes(kind);
 const updateObjectiveStatus=objectives=>{const active=objectives.filter(visible).length;objectiveStatus.textContent=active?`${active} active`:'Tasks';objectiveStatus.classList.toggle('has-active',active>0);};
 const updateStrip=()=>{const linked=lastObjectives.filter(row=>row.conversationId&&row.conversationId===activeConversationId);strip.hidden=!linked.length;if(!linked.length)return;const row=linked[0],wake='',needs=needsOwner(row.tracking?.waitingFor?.kind)?' · needs you':'',progress=row.progress?.total?` · Step ${Math.min(row.progress.done+1,row.progress.total)} of ${row.progress.total}${row.step?`: ${row.step}`:''}`:'';strip.textContent=`${linked.length>1?`${linked.length} tasks · `:''}${row.goal} · ${row.live?'Working now':row.status.replaceAll('_',' ')}${needs}${wake}${progress} · ${row.nextWakeAt?`Next wake ${time(row.nextWakeAt)}`:'No wake scheduled'}`;};
 const refreshBadge=async()=>{try{lastObjectives=(await api('nethra.list')).objectives;updateObjectiveStatus(lastObjectives);updateStrip();}catch{objectiveStatus.textContent='Tasks';}};
 window.addEventListener('junction:chat-opened',refreshBadge);
 strip.onclick=()=>{const row=lastObjectives.find(item=>item.conversationId===activeConversationId);if(row)selectedId=row.id;setDrawerOpen(true);};
 const setDrawerOpen=open=>{if(open)showView('tasks');else if(document.getElementById('view-tasks').classList.contains('active'))showView('chat');section.classList.toggle('open',open);objectiveStatus.setAttribute('aria-expanded',String(open));if(open)refresh();};
 close.onclick=()=>setDrawerOpen(false);
 const perform=async fn=>{try{error.textContent='';await fn();}catch(e){error.textContent=e.message;}finally{await refresh();}};
 const button=(label,fn)=>{const b=el('button',label);b.type='button';b.onclick=()=>perform(fn);return b;};
 const time=value=>value?new Date(value).toLocaleString():'None scheduled';
 const details=(label,value)=>{const d=el('details');d.append(el('summary',label),el('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));return d;};
 const stateOf=row=>row.live?'working':['WAITING_FOR_USER','BLOCKED'].includes(row.status)||needsOwner(row.tracking?.waitingFor?.kind)?'needs':row.status==='PAUSED'?'paused':row.status==='COMPLETED'?'done':['FAILED','CANCELLED'].includes(row.status)?'ended':row.status==='SLEEPING'?'sleeping':'queued';
 const stateLabel=row=>({working:'Working now',needs:'Needs you',paused:'Paused',done:'Done',ended:row.status==='CANCELLED'?'Stopped':'Failed',sleeping:row.tracking?.waitingFor?.kind==='budget'?'Daily limit reached':row.continuous&&row.tracking?.wake?.kind==='CONTINUE'?'Continuing shortly':row.mode==='ONGOING'?'Monitoring':'Sleeping',queued:row.continuous?'Queued for next pass':'Queued'})[stateOf(row)];
 const deletedIds=new Set();
 const deleteTask=async id=>{const result=await api('nethra.delete',{id,confirm:true});if(result.deleted){deletedIds.add(id);if(selectedId===id)selectedId=null;}return result;};
 async function refresh(){if(loading){refreshAgain=true;return;}loading=true;try{
   const result=await api('nethra.list');let next=result.nextOffset;while(next!=null){const page=await api('nethra.list',{offset:next});result.objectives.push(...page.objectives);next=page.nextOffset;}result.objectives=[...new Map(result.objectives.map(row=>[row.id,row])).values()];result.objectives=result.objectives.filter(row=>!deletedIds.has(row.id));thinking.checked=true;startup.checked=result.settings.persistentStartup;showSettings(result.settings);lastObjectives=result.objectives;window.junctionTaskByChat=new Map(result.objectives.filter(row=>row.conversationId).map(row=>[row.conversationId,row.id]));window.junctionTaskChats=new Set(window.junctionTaskByChat.keys());updateObjectiveStatus(result.objectives);updateStrip();
   const answerDrafts=new Map([...document.querySelectorAll('#view-tasks article[data-objective-id]')].map(card=>[card.dataset.objectiveId,card.querySelector('textarea[aria-label="Answer Nethra"]')?.value||'']));
   const expandedId=detailPane.querySelector('article[data-objective-id]')?.dataset.objectiveId;
   const expandedSections=new Set([...detailPane.querySelectorAll('details[open][data-section]')].map(node=>node.dataset.section));
   const keepExpanded=(id,key)=>expandedId===id&&expandedSections.has(key);
   list.replaceChildren();detailPane.replaceChildren(Object.assign(el('p','Select a task to view its progress and controls.'),{className:'task-line'}));
   const query=taskSearch.value.trim().toLowerCase();
   const matches=result.objectives.filter(row=>!query||`${row.goal} ${row.summary||''}`.toLowerCase().includes(query));
   const attention=row=>needsOwner(row.tracking?.waitingFor?.kind)||['WAITING_FOR_USER','BLOCKED'].includes(row.status);
   const activeRows=matches.filter(visible).sort((a,b)=>Number(attention(b))-Number(attention(a))||Number(b.live)-Number(a.live)||(a.priority||3)-(b.priority||3));
   const endedRows=matches.filter(row=>!visible(row));
   const rows=taskFilter.value==='finished'?endedRows:taskFilter.value==='all'?[...activeRows,...endedRows]:activeRows;
   if(!rows.length)list.append(el('p',query?'No matching tasks.':taskFilter.value==='finished'?'No finished tasks.':'No active tasks. Create one above.'));
   if(!rows.some(row=>row.id===selectedId))selectedId=rows[0]?.id||null;
   const openTaskChat=async row=>{const opened=await api('nethra.openChat',{id:row.id});await openConversation(opened.conversationId);setDrawerOpen(false);showView('chat');};
   for(const row of rows){
     if(row===endedRows[0]&&taskFilter.value==='all')list.append(el('h3','Finished tasks'));
     const card=el('article');card.className='task-card';card.dataset.objectiveId=row.id;card.dataset.state=stateOf(row);
     const head=el('div');head.className='task-head';
     const chip=el('span',row.parentId?`Agent · ${stateLabel(row)}`:stateLabel(row));chip.className='task-chip';
     const title=button(row.goal,()=>{selectedId=row.id;});title.className='task-index-row task-title';title.title='View task details';
     const inspect=el('button','Chat');inspect.type='button';inspect.className='task-link task-chat-button';inspect.title='Open task chat';inspect.onclick=()=>perform(()=>openTaskChat(row));
     head.append(chip,title,inspect);card.append(head);
     card.onclick=event=>{if(event.target.closest('button,label,input,textarea,select'))return;selectedId=row.id;refresh();};
     const line=row.tracking?((needsOwner(row.tracking.waitingFor?.kind)?`Needs you: ${row.tracking.waitingFor.detail||''}`:row.tracking.waitingFor?.kind==='budget'?row.tracking.waitingFor.detail:row.tracking.doing)||''):(row.step||'');
     if(line)card.append(Object.assign(el('p',line),{className:'task-line'}));
     if(row.progress?.total){const count=el('p',`${row.progress.done} of ${row.progress.total} steps ${row.mode==='ONGOING'?'this cycle':'done'}`);count.className='task-card-progress';const bar=el('progress');bar.max=row.progress.total;bar.value=row.progress.done;bar.setAttribute('aria-label','Completed task steps');card.append(bar,count);}
     const quickActions=el('div');quickActions.className='task-actions task-card-actions';
     if(!['COMPLETED','CANCELLED','FAILED'].includes(row.status)){
       const quick=checkbox(' Continuous',row.continuous===true);quick.label.className='task-toggle task-quick';quick.label.title='Continue useful plan steps in short passes';quick.input.onchange=()=>perform(()=>api('nethra.configure',{id:row.id,revision:row.revision,continuous:quick.input.checked}));quickActions.append(quick.label);
       quickActions.append(button(row.status==='PAUSED'?'Resume':'Pause',()=>api('nethra.control',{id:row.id,action:row.status==='PAUSED'?'resume':'pause',revision:row.revision})));
     }
       const quickEdit=el('button','Edit');quickEdit.type='button';quickEdit.onclick=async()=>{selectedId=row.id;await refresh();const editor=detailPane.querySelector('.task-editor');if(editor){editor.hidden=false;editor.querySelector('textarea')?.focus();}};quickActions.append(quickEdit);
     const quickDelete=button('Delete',async()=>{if(!window.confirm('Delete this task, its history and drafts? Its chat is kept. This cannot be undone.'))return;await deleteTask(row.id);});quickDelete.className='danger';quickActions.append(quickDelete);card.append(quickActions);
     list.append(card);
     if(selectedId!==row.id)continue;
     card.classList.add('selected');const detailCard=el('article');detailCard.className='task-detail';detailCard.dataset.objectiveId=row.id;
     const detailHead=el('div');detailHead.className='task-head';detailHead.append(Object.assign(el('span',stateLabel(row)),{className:'task-chip'}),Object.assign(el('h2',row.goal),{className:'task-detail-title'}),button(row.conversationId?'Open task chat':'Create task chat',async()=>{const opened=await api('nethra.openChat',{id:row.id});await openConversation(opened.conversationId);showView('chat');}));detailCard.dataset.state=stateOf(row);detailCard.append(detailHead);detailPane.replaceChildren(detailCard);
     const topActions=el('div');topActions.className='task-actions';
     const topDelete=button('Delete',async()=>{if(window.confirm('Delete this task and its drafts? Its ordinary conversation is kept. This cannot be undone.'))await deleteTask(row.id);});topDelete.className='danger';
     const editButton=el('button','Edit');editButton.type='button';editButton.onclick=()=>{const editor=detailCard.querySelector('.task-editor');if(editor){editor.hidden=!editor.hidden;if(!editor.hidden)editor.scrollIntoView({block:'nearest'});}};
     topActions.append(editButton,topDelete);detailHead.append(topActions,Object.assign(el('small',taskModels.find(([id])=>id===row.model)?.[1]||'Qwen3 30B'),{className:'task-detail-model'}));
     const {task,codeWork=[],approvals,events,attention,progress,performance,experiments,projects=[],children=[],agents=[],projectDocuments=[],approvedDocumentStatus=[]}=await api('nethra.get',{id:row.id});
     if(deletedIds.has(row.id)||selectedId!==row.id)continue;
     for(const document of approvedDocumentStatus){
       if(document.status==='NEWER_AVAILABLE')detailCard.append(el('p',`${document.name}: revision ${document.latestRevision} is available. This task can read only approved revision ${document.revision}.`));
       if(document.status==='UNAVAILABLE')detailCard.append(el('p',`${document.name}: approved revision ${document.revision} is unavailable.`));
     }
     const diagnostics=el('details');diagnostics.dataset.section='diagnostics';diagnostics.open=keepExpanded(row.id,'diagnostics');diagnostics.append(el('summary','Diagnostics'));
     if(!task.parentId&&(/^self[ -]improvement[.!]?$/i.test(task.goal.trim())||task.coordination)){
       const coordination=el('section');coordination.append(el('h3','Self Improvement coordination'));
       if(task.coordinateSelfImprovement){
         coordination.append(el('p',task.summary||'Queued for consultation.'));
         for(const [provider,receipt] of Object.entries(task.coordination?.advisors||{})){
           coordination.append(el('p',`${provider==='codex'?'Codex':'Claude'}: ${receipt.status}${receipt.retryAt?` · next check ${time(receipt.retryAt)}`:''}`));
           if(receipt.advice){diagnostics.append(el('h4',`${provider} advice (unverified proposal)`));diagnostics.append(el('pre',receipt.advice));}
         }
       }else if(!task.allowCodeWork||!task.conversationId){
         coordination.append(el('p','Enable development work under Approach and sources and link the task conversation first.'));
       }
       const toggle=button(task.coordinateSelfImprovement?'Disable coordination':'Enable coordination',()=>api('nethra.configure',{id:task.id,revision:task.revision,coordinateSelfImprovement:!task.coordinateSelfImprovement}));
       toggle.disabled=!task.coordinateSelfImprovement&&(!task.allowCodeWork||!task.conversationId||!task.persistent||['COMPLETED','FAILED','CANCELLED'].includes(task.status));
       coordination.append(toggle);detailCard.append(coordination);
     }
     for(const work of codeWork){
       const section=el('section');section.dataset.section='code-work';
       const activity=work.status==='COMPLETED'?'Verified; awaiting engineering review':work.status==='BLOCKED'?'Blocked':work.status==='PAUSED'?'Paused':work.status==='STOPPED'?'Stopped':work.status==='DRAFT'?'Draft awaiting your Start':['WAITING_CAPACITY','WAITING_CODEX'].includes(work.status)?'Waiting for provider capacity':work.phase==='verifying'?'Verifying':work.provider==='claude'?'Claude working':work.provider==='codex'?'Codex working':'Preparing';
       section.append(el('h3',`Development work · ${activity}`));
       section.append(el('p',work.lastVerified?`Last verified: ${work.lastVerified.summary}${work.lastVerified.at?` (${time(work.lastVerified.at)})`:''}`:'Nothing verified yet.'));
       if(work.blocker)section.append(el('p',`Blocked: ${work.blocker}`));
       if(work.nextAction)section.append(el('p',`Next: ${work.nextAction}`));
       if(work.retryAt)section.append(el('p',`Next provider check ${time(work.retryAt)}`));
       detailCard.append(section);
     }
     if(!task.parentId){
       const delegation=el('section');
       delegation.append(el('h3','Task agents'));
       if(!agents.length)delegation.append(el('p','No agents assigned to this task.'));
       for(const agent of agents){
         const entry=el('div');entry.append(el('p',`${agent.goal} · ${stateLabel(agent)}`));
         if(agent.live&&agent.tracking?.doing)entry.append(el('p',agent.tracking.doing));
         if(agent.status==='SLEEPING'&&agent.nextWakeAt)entry.append(el('p',`Next wake: ${time(agent.nextWakeAt)}`));
         const inspect=el('button','View agent task');inspect.type='button';inspect.onclick=()=>{selectedId=agent.id;refresh();};
         entry.append(inspect);delegation.append(entry);
       }
       const assignment=el('textarea');assignment.setAttribute('aria-label','Agent assignment');assignment.placeholder='What should this agent accomplish?';assignment.maxLength=2000;
       const launch=el('details');launch.className='task-agent-assignment';launch.append(el('summary','Assign an agent'),assignment,button('Launch task agent',async()=>{
         const {task:agent}=await api('nethra.agent.create',{id:task.id,goal:assignment.value.trim()});
         selectedId=agent.id;
       }));
       delegation.append(launch);detailCard.append(delegation);
     }
     if(children.length){
       const agents=el('section');agents.append(el('h3','Research helpers'));
       for(const child of children){
         const item=el('div');item.append(el('p',`${child.status.toLowerCase()} · ${child.scope}`));
         if(child.status==='ACTIVE')item.append(button('Stop agent',()=>api('nethra.child.stop',{id:task.id,childId:child.id})));
         if(child.report||child.error)item.append(details('Agent report',child.report||child.error));
         agents.append(item);
       }
       detailCard.append(agents);
     }
     const open=!['COMPLETED','CANCELLED','FAILED'].includes(task.status);
     const pendingApprovals=approvals.filter(a=>a.status==='PENDING');
     // What Nethra needs from the owner comes first.
     if(pendingApprovals.length||task.status==='WAITING_FOR_USER'||task.status==='BLOCKED'){
       const needs=el('div');needs.className='task-needs';needs.append(el('strong',pendingApprovals.length?'Approval needed':task.status==='BLOCKED'?'Blocked':'Nethra is asking'));
       for(const approval of pendingApprovals){needs.append(el('p',approval.reviewReason||`Replace the draft ${approval.args?.path||''}`),details('Exact change',approval.args));const row2=el('div');row2.className='task-actions';row2.append(button(approval.reviewRequired?'Approve exact retry':'Approve',()=>api('nethra.approve',{id:approval.id,approved:true})),button('Reject',()=>api('nethra.approve',{id:approval.id,approved:false})));needs.append(row2);}
       if(!pendingApprovals.length){needs.append(el('p',task.summary||'Nethra needs a direction.'));
         if(task.status==='WAITING_FOR_USER'){const answer=el('textarea');answer.placeholder='Answer Nethra (or reply in this task’s chat)';answer.setAttribute('aria-label','Answer Nethra');answer.value=answerDrafts.get(task.id)||'';needs.append(answer,button('Send answer',()=>api('nethra.answer',{id:task.id,revision:task.revision,answer:answer.value})));}}
       detailCard.append(needs);
     }
     if(progress){
       const overview=el('section');overview.className='task-progress-overview';overview.append(el('h3','Task progress'));
       const nowLine=el('p');nowLine.append(el('strong','Now'),el('span',progress.doing||'Finished'));overview.append(nowLine);
       const nextLine=el('p');nextLine.append(el('strong','Next action'),el('span',progress.next|| (progress.wake?`Check at ${time(progress.wake.at)}`:'None scheduled')));overview.append(nextLine);
       if(progress.counts.total){const count=el('p',`${progress.counts.done} of ${progress.counts.total} steps ${task.mode==='ONGOING'?'in this cycle':'done'}`);count.className='task-step-count';const bar=el('progress');bar.max=progress.counts.total;bar.value=progress.counts.done;bar.setAttribute('aria-label','Completed task steps');overview.append(bar,count);}
       detailCard.append(overview);
     }
     // Host-recorded tracking; the model's own words are labelled as its note.
     if(progress){const dl=el('dl');dl.className='tracking';const add=(term,value,cls)=>{if(!value)return;const dd=el('dd',value);if(cls)dd.className=cls;dl.append(el('dt',term),dd);};
       add('Last recorded action',progress.lastAccomplished?`${progress.lastAccomplished.line} (${time(progress.lastAccomplished.at)})`:null);
       add('Wakes',progress.wake?`${time(progress.wake.at)} — ${progress.wake.reason}`:null);
       if(['source','dependency','budget'].includes(progress.waitingFor.kind))add('Waiting for',progress.waitingFor.detail);
       add('Outputs',progress.outputs.length?progress.outputs.map(item=>`${String(item.path).split(/[\\/]/).at(-1)}${item.current?'':' (changed since written)'}`).join('\n'):null);

       if(task.summary&&!['WAITING_FOR_USER','BLOCKED'].includes(task.status))add("Nethra's note",task.summary);
       if(row.usage)add('Model time today',result.settings.objectiveDailyMs==null?`${Math.round(row.usage.todayMs/60000)} min · no daily limit`:`${Math.round(row.usage.todayMs/60000)} min of ${Math.round(result.settings.objectiveDailyMs/60000)} min daily limit`);
       detailCard.append(dl);}
     if(progress){const timeline=el('section');timeline.className='task-activity';timeline.append(el('h3','Work log · newest first'));if(progress.activity?.length){const items=el('ol');for(const item of progress.activity){const li=el('li');li.dataset.kind=item.kind;li.append(el('span',item.line),el('small',`${time(item.at)} · ${item.actor||'Junction'}${item.model?` (${item.model})`:''}`));items.append(li);}timeline.append(items);}else timeline.append(el('p','No recorded actions yet.'));diagnostics.append(timeline);}
     if(performance){const metrics=el('section');metrics.className='task-performance';metrics.append(el('h3','Measured performance · last 7 days'));const seconds=ms=>`${(ms/1000).toFixed(1)} s`;const objective=performance.objective,chat=performance.chat;
       metrics.append(el('p',objective.sampleCount?`${objective.sampleCount} task model call${objective.sampleCount===1?'':'s'} · median inference ${seconds(objective.medianInferenceMs)} · latest ${time(objective.lastSampleAt)}`:'No measured samples for this task in the last 7 days.'));
       metrics.append(el('p',chat.sampleCount?`${chat.sampleCount} local chat repl${chat.sampleCount===1?'ies':'y'} across all conversations · median response ${seconds(chat.medianResponseMs)}${chat.medianTokensPerSecond?` · ${chat.medianTokensPerSecond} tokens/s`:''} · latest ${time(chat.lastSampleAt)}`:'No measured samples for local chat in the last 7 days.'));
       metrics.append(el('small','These are recorded timings, not a before-and-after speedup test.'));diagnostics.append(metrics);}
     if(experiments?.length){const card=el('section');card.className='task-experiments';card.append(el('h3','Experiments · verdicts computed by Junction'));const items=el('ol');const status={BASELINE:'Baseline recorded; waiting for the change',CHANGED:'Change recorded; collecting samples',CONCLUDED:'Concluded'};
       for(const item of experiments){const li=el('li');li.dataset.verdict=item.result?.verdict||item.status;li.append(el('span',`${item.hypothesis} · ${item.metric.replace(/_/g,' ')}`),el('small',item.result?`${item.result.verdict.replace(/_/g,' ').toLowerCase()} · ${item.result.detail||''}`:`${status[item.status]||item.status} · baseline ${item.baseline.count} samples, median ${item.baseline.median}`));items.append(li);}card.append(items);diagnostics.append(card);}
       // Edit the objective's wording; completed steps and evidence are kept.
       const editor=el('div');editor.className='task-editor';editor.hidden=true;const goalField=el('textarea');goalField.value=task.goal;goalField.setAttribute('aria-label','Edit goal');goalField.rows=3;
       const criteriaField=el('textarea');criteriaField.value=task.successCriteria&&task.successCriteria!==task.goal?task.successCriteria:'';criteriaField.placeholder='What does done look like? (optional)';criteriaField.setAttribute('aria-label','Edit success criteria');
       const instructionField=el('textarea');instructionField.placeholder='Describe the change, for example: redo the research using official sources';instructionField.setAttribute('aria-label','Edit instruction');
       const editActions=el('div');editActions.className='task-actions';editActions.append(button('Save changes',async()=>{const result=await api('nethra.edit',{id:task.id,revision:task.revision,goal:goalField.value,successCriteria:criteriaField.value,instruction:instructionField.value});if(result.clarification)throw new Error(result.clarification);}),Object.assign(el('button','Cancel'),{type:'button',onclick:()=>{editor.hidden=true;}}));
       editor.append(el('label','Goal'),goalField,el('label','Success criteria'),criteriaField,instructionField,editActions);editButton.onclick=()=>{editor.hidden=!editor.hidden;if(!editor.hidden)goalField.focus();};detailCard.append(editor);
       if(projects.length||task.projectId){
         const projectField=el('select');projectField.setAttribute('aria-label','Saved project');
         projectField.append(Object.assign(el('option','No project'),{value:''}));
         for(const project of projects)projectField.append(Object.assign(el('option',project.name),{value:project.id}));
         if(task.projectId&&!projects.some(project=>project.id===task.projectId))projectField.append(Object.assign(el('option','Unavailable project'),{value:task.projectId}));
         projectField.value=task.projectId||'';
         const saveProject=button('Save project',()=>api('nethra.project',{id:task.id,revision:task.revision,projectId:projectField.value||null}));
         saveProject.disabled=true;
         projectField.onchange=()=>{saveProject.disabled=projectField.value===(task.projectId||'');};
         editor.append(el('label','Saved project'),projectField,saveProject);
       }
       const linkedProject=projects.find(project=>project.id===task.projectId);
       if(linkedProject&&(projectDocuments.length||task.projectDocuments?.length)){
         editor.append(el('h3','Approved project documents'),el('p','Approving a revision makes this task local-only for research and advisors.'));
         for(const grant of task.projectDocuments||[]){
           editor.append(el('p',`${grant.name} · revision ${grant.revision}`),button('Revoke access',()=>api('nethra.projectDocument',{id:task.id,revision:task.revision,documentId:grant.id,documentRevision:null})));
         }
         const available=projectDocuments.filter(document=>!task.projectDocuments?.some(grant=>grant.id===document.id&&grant.revision===document.revision));
         if(available.length){
           const field=el('select');field.setAttribute('aria-label','Project document revision');
           for(const document of available)field.append(Object.assign(el('option',`${document.name} · revision ${document.revision}`),{value:document.id}));
           editor.append(field,button('Approve document access',()=>{
             const selected=available.find(document=>document.id===field.value);
             return api('nethra.projectDocument',{id:task.id,revision:task.revision,documentId:selected.id,documentRevision:selected.revision});
           }));
         }
       }
       if(linkedProject){
         const notifications=el('select');
         notifications.setAttribute('aria-label',`Phone notifications for ${linkedProject.name}`);
         for(const [value,label] of [['INHERIT','Use global preference'],['IMPORTANT','Important only'],['OFF','Muted']]){
           notifications.append(Object.assign(el('option',label),{value}));
         }
         const current=result.settings?.projectNotifications?.[linkedProject.id]||'INHERIT';
         notifications.value=current;
         const saveNotifications=button('Save notification preference',()=>api('nethra.settings',{projectNotification:{id:linkedProject.id,mode:notifications.value}}));
         saveNotifications.disabled=true;
         notifications.onchange=()=>{saveNotifications.disabled=notifications.value===current;};
         editor.append(el('label',`Phone notifications for ${linkedProject.name}`),notifications,saveNotifications);
       }
     if(open){
       const actions=el('div');actions.className='task-actions';
       if(task.status==='PAUSED')actions.append(button('Resume',()=>api('nethra.control',{id:task.id,action:'resume',revision:task.revision})));
       else if(!['WAITING_FOR_USER','BLOCKED'].includes(task.status))actions.append(button('Pause',()=>api('nethra.control',{id:task.id,action:'pause',revision:task.revision})));
       if(task.status==='SLEEPING')actions.append(button('Check now',()=>api('nethra.control',{id:task.id,action:'wake',revision:task.revision})));

       const stop=button('Stop task',async()=>{if(!window.confirm('Stop this task? It will not run again. Its chat, evidence and drafts are kept.'))return;await api('nethra.control',{id:task.id,action:'cancel',revision:task.revision});});stop.className='danger';actions.append(stop);

       topActions.prepend(actions);
       {const continuous=checkbox(' Continue useful steps in short passes',task.continuous===true);continuous.label.className='task-toggle';
       continuous.input.onchange=()=>perform(()=>api('nethra.configure',{id:task.id,revision:task.revision,continuous:continuous.input.checked}));detailCard.append(continuous.label);if(task.mode==='ONGOING')detailCard.append(el('small','Once the plan is complete, monitoring follows its normal schedule.'));}
       const redirect=el('details');redirect.append(el('summary','Change direction'));const redirectRow=el('div');redirectRow.className='redirect-row';const direction=el('textarea');direction.placeholder='Tell Nethra the new direction (keeps verified evidence)';direction.setAttribute('aria-label','Redirect objective');direction.maxLength=10000;
       redirectRow.append(direction,button('Redirect',()=>api('nethra.redirect',{id:task.id,revision:task.revision,instruction:direction.value})));redirect.append(redirectRow);detailCard.append(redirect);
       const taskMode=select('Objective type ',[['FINITE','Finish when achieved'],['ONGOING','Keep monitoring after each result']],task.mode||'FINITE');
       const taskModel=select('Task model ',taskModels,task.model||'qwen3:30b');
       const profile=select('Autonomy ',[['QUIET','Quiet monitoring'],['BALANCED','Balanced initiative'],['ACTIVE','Active exploration']],task.autonomy||'BALANCED');
       const rank=select('Priority ',[[1,'1 · Highest'],[2,'2 · High'],[3,'3 · Normal'],[4,'4 · Low'],[5,'5 · Lowest']],String(task.priority||3));
       const review=select('Direction check-in ',[['DAILY','Daily'],['WEEKLY','Weekly'],['MILESTONES','At milestones or blockers'],['MANUAL','Manual only']],task.checkIn||'WEEKLY');
       const watches=checkbox(' Watch Google Calendar',(task.sources||[]).includes('calendar')),watchesMail=checkbox(' Watch Gmail',(task.sources||[]).includes('gmail')),codeWork=checkbox(' Self-improvement: Codex and Claude advice, measured experiments and development drafts (uses your plan allowances)',task.allowCodeWork===true);
       const approach=el('details');approach.append(el('summary','Approach and sources'));const controls=el('div');controls.className='objective-policy';controls.append(taskModel.wrapper,taskMode.wrapper,profile.wrapper,rank.wrapper,review.wrapper,watches.label,watchesMail.label,codeWork.label,el('p','The selected model continues the same saved plan, evidence, and approvals. 80B loads slowly and uses more memory.'),el('p','Advice uses your live Codex and Claude plan usage, stopping at the reserve set in Settings. A development draft waits in Work Activity until you start it. Applying verified code to this checkout still requires your review.'),button('Save approach',()=>api('nethra.configure',{id:task.id,revision:task.revision,model:taskModel.field.value,mode:taskMode.field.value,autonomy:profile.field.value,priority:Number(rank.field.value),checkIn:review.field.value,allowCodeWork:codeWork.input.checked,sources:[...(watches.input.checked?['calendar']:[]),...(watchesMail.input.checked?['gmail']:[])]})));approach.append(controls);detailCard.append(approach);
     }
     const record=el('details');record.append(el('summary','Full record'),details('Plan',{steps:task.plan,completed:task.completedSteps,pending:task.pendingSteps}),details('Evidence',task.evidence),details('Attention',attention||[]),details('History',events),details('Errors',task.errors));diagnostics.append(record);
     let diagnosticCursor={seq:0,offset:0};const fullHistory=el('div');
     const loadHistory=el('button','Load full history');loadHistory.type='button';loadHistory.onclick=async()=>{
       loadHistory.disabled=true;
       try{const page=await api('nethra.get',{id:task.id,diagnosticsCursor:diagnosticCursor});for(const item of page.events)fullHistory.append(details(`${time(item.at)} · ${item.kind}${item.continued?' (continued)':''}`,item.detail));diagnosticCursor=page.nextCursor;loadHistory.hidden=!diagnosticCursor;loadHistory.textContent='Load more history';}
       catch(failure){error.textContent=failure.message;}finally{loadHistory.disabled=false;}
     };diagnostics.append(fullHistory,loadHistory);detailCard.append(diagnostics);
   }
 }catch(e){error.textContent=e.message;}finally{loading=false;if(refreshAgain){refreshAgain=false;refresh();}}}
 form.onsubmit=event=>{event.preventDefault();perform(async()=>{await api('nethra.create',{goal:goal.value,conversationId:activeConversationId||null,persistent:persistent.checked,model:newTaskModel.field.value,mode:mode.field.value,readRoots:roots.value.trim()?[roots.value.trim()]:[],autonomy:autonomy.field.value,priority:Number(priority.field.value),checkIn:checkIn.field.value,continuous:continuousNew.input.checked,allowCodeWork:codeWorkNew.input.checked,sources:[...(watchCalendar.input.checked?['calendar']:[]),...(watchGmail.input.checked?['gmail']:[])]});goal.value='';watchCalendar.input.checked=watchGmail.input.checked=codeWorkNew.input.checked=false;});};
 taskSearch.oninput=()=>refresh();taskFilter.onchange=()=>{selectedId=null;refresh();};
 startup.onchange=()=>perform(()=>api('nethra.settings',{persistentStartup:startup.checked}));
 openObjectives.onclick=()=>{const draft=document.getElementById('message-input').value.trim();if(draft)goal.value=draft;document.getElementById('chat-options').open=false;createDetails.open=true;setDrawerOpen(true);goal.focus();};
 objectiveStatus.onclick=()=>setDrawerOpen(!section.classList.contains('open'));
 document.querySelectorAll('[data-view="tasks"]').forEach(button=>button.addEventListener('click',()=>{section.classList.add('open');refresh();}));
 document.querySelectorAll('.nav[data-view]:not([data-view="tasks"])').forEach(button=>button.addEventListener('click',()=>section.classList.remove('open')));
 api('nethra.status',{warm:false}).then(s=>{showSettings(s.settings);modelStatus.textContent=`${s.model} · Windows host · ${s.capabilities.thinking?'native thinking supported':'thinking support unavailable'} · one inference at a time${s.modelState?` · ${s.modelState.state}`:''}`;showCalendar(s.sources.calendar);showGmail(s.sources.gmail);}).catch(e=>{modelStatus.textContent=e.message;});
 api('nethra.reunion',{since:Date.now()-86400000}).then(result=>{reunionBody.replaceChildren(el('p',`${result.objectives.length} saved objective(s) · ${result.pendingApprovals} approval(s) waiting`));for(const event of result.events.slice(0,8))reunionBody.append(el('p',`${time(event.at)} · ${event.kind} · ${event.taskId.slice(0,8)}`));}).catch(e=>{reunionBody.textContent=e.message;});
 setInterval(()=>{if(page.classList.contains('active')&&!page.querySelector('textarea:focus,input:focus,select:focus,.task-editor:not([hidden]),.task-agent-assignment[open]'))refresh();else if(document.getElementById('view-chat').classList.contains('active'))refreshBadge();},5000);refreshBadge();
})();
