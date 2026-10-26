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
 const notice=el('p','One local agent on your Windows PC. Enabled objectives continue while the desktop window is closed.');area.append(notice);
 const reunion=el('details');reunion.append(el('summary','Since you were away'));const reunionBody=el('div','Checking saved activity…');reunion.append(reunionBody);area.append(reunion);
 const error=el('p');error.role='status';area.append(error);
 const form=el('form');form.className='panel';const goal=el('textarea');goal.placeholder='Give Nethra a goal and describe what success looks like';goal.setAttribute('aria-label','Objective');goal.rows=3;goal.required=true;goal.maxLength=8000;
 const roots=el('input');roots.placeholder='Optional approved read folder on this PC';roots.setAttribute('aria-label','Approved read folder');
 const persistent=el('input');persistent.type='checkbox';persistent.checked=true;const persistenceLabel=el('label',' Continue autonomously across restarts');persistenceLabel.prepend(persistent);
 const select=(label,values,chosen)=>{const wrapper=el('label',label);const field=el('select');for(const [value,title] of values){const option=el('option',title);option.value=value;field.append(option);}field.value=chosen;wrapper.append(field);return {wrapper,field};};
 const mode=select('Objective type ',[['FINITE','Finish when achieved'],['ONGOING','Keep monitoring after each result']],'FINITE');
 const autonomy=select('Autonomy ',[['QUIET','Quiet monitoring'],['BALANCED','Balanced initiative'],['ACTIVE','Active exploration']],'BALANCED');
 const priority=select('Priority ',[[1,'1 · Highest'],[2,'2 · High'],[3,'3 · Normal'],[4,'4 · Low'],[5,'5 · Lowest']],'3');
 const checkIn=select('Direction check-in ',[['DAILY','Daily'],['WEEKLY','Weekly'],['MILESTONES','At milestones or blockers'],['MANUAL','Manual only']],'WEEKLY');
 const policyFields=el('div');policyFields.className='objective-policy';policyFields.append(mode.wrapper,autonomy.wrapper,priority.wrapper,checkIn.wrapper);
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
 const advisorPanel=el('article');advisorPanel.className='panel';advisorPanel.append(el('h2','Self-improvement advisors'),el('p','On tasks where you enable self-improvement, Nethra may ask Codex and Claude for read-only advice whenever your live plan usage allows. It stops when any usage window reaches the ceiling below and resumes after that window resets.'));
 const reserve=select('Keep for my own use ',[[0,'Nothing (use everything available)'],[5,'5%'],[10,'10% (default)'],[20,'20%'],[30,'30%'],[50,'50%']],'10');const advisorStatus=el('p','Usage not checked yet.');
 const describeAdvisor=(label,item)=>!item?.ready?`${label}: ${item?.detail||'not signed in'}`:item.limits?.error?`${label}: usage unavailable (${item.limits.error})`:`${label}: ${item.limits?.available?'available':'resting'} · ${(item.limits?.windows||[]).filter(w=>!w.stale).map(w=>`${w.name.replace('_',' ')} ${w.usedPercent}%`).join(', ')||item.limits?.source||'no reading yet'}${item.limits?.nextAvailableAt?` · back at ${time(item.limits.nextAvailableAt)}`:''}`;
 const checkAdvisors=()=>api('nethra.advisors').then(value=>{advisorStatus.textContent=`${describeAdvisor('Codex',value.codex)}\n${describeAdvisor('Claude',value.claude)}`;}).catch(error=>{advisorStatus.textContent=`Could not check usage: ${error.message}`;});
 advisorStatus.style.whiteSpace='pre-line';reserve.field.onchange=()=>saveSetting({advisorReservePercent:Number(reserve.field.value)});const checkNow=el('button','Check usage now');checkNow.type='button';checkNow.onclick=checkAdvisors;advisorPanel.append(reserve.wrapper,advisorStatus,checkNow);document.querySelector('.settings').append(advisorPanel);
 warmStartup.field.onchange=()=>saveSetting({warmOnStartup:warmStartup.field.value});retention.field.onchange=()=>saveSetting({idleRetention:retention.field.value});proactive.field.onchange=()=>saveSetting({proactiveUpdates:proactive.field.value});taskBudget.field.onchange=()=>{const [task,total]=BUDGETS[taskBudget.field.value];saveSetting({objectiveDailyMs:task,globalDailyMs:total});};
 const saveQuiet=()=>{if(quietStart.value&&quietEnd.value)saveSetting({quietHours:{enabled:quietOn.input.checked,start:quietStart.value,end:quietEnd.value}});};quietOn.input.onchange=saveQuiet;quietStart.onchange=saveQuiet;quietEnd.onchange=saveQuiet;
 const showSettings=value=>{if(!value)return;taskBudget.field.value=Object.keys(BUDGETS).find(key=>BUDGETS[key][0]===(value.objectiveDailyMs??null))||'20m';reserve.field.value=String(value.advisorReservePercent??10);warmStartup.field.value=value.warmOnStartup||'desktop';retention.field.value=value.idleRetention||'2h';proactive.field.value=value.proactiveUpdates||'ALL';quietOn.input.checked=Boolean(value.quietHours?.enabled);quietStart.value=value.quietHours?.start||'22:00';quietEnd.value=value.quietHours?.end||'07:00';};
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
 const chatThinking=el('div','Thinking on');chatThinking.id='chat-thinking';chatThinking.className='research-toggle fixed-option';chatThinking.title='Qwen3 30B uses thinking on every reply';chatThinking.setAttribute('aria-disabled','true');document.getElementById('research-toggle').after(chatThinking);
 const openObjectives=el('button','Continue as objective');openObjectives.id='new-objective';openObjectives.type='button';openObjectives.className='research-toggle';document.querySelector('.chat-options-panel').append(openObjectives);
 const objectiveStatus=el('button','Tasks');objectiveStatus.id='objective-status';objectiveStatus.type='button';objectiveStatus.title='View active Nethra tasks and next wakes';objectiveStatus.setAttribute('aria-controls','nethra-task-drawer');objectiveStatus.setAttribute('aria-expanded','false');document.getElementById('new-chat').before(objectiveStatus);
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
 async function refresh(){if(loading){refreshAgain=true;return;}loading=true;try{
   const result=await api('nethra.list');thinking.checked=true;startup.checked=result.settings.persistentStartup;showSettings(result.settings);lastObjectives=result.objectives;updateObjectiveStatus(result.objectives);updateStrip();
   const answerDrafts=new Map([...document.querySelectorAll('#view-tasks article[data-objective-id]')].map(card=>[card.dataset.objectiveId,card.querySelector('textarea[aria-label="Answer Nethra"]')?.value||'']));
   list.replaceChildren();detailPane.replaceChildren(Object.assign(el('p','Select a task to see what Nethra is doing, what it needs from you, and its controls.'),{className:'task-line'}));const activeRows=result.objectives.filter(visible);if(!activeRows.length)list.append(el('p','No active tasks. Start one from the chat draft.'));
   const recentEnded=result.objectives.filter(row=>!visible(row)).slice(0,5);
   const rows=[...activeRows,...recentEnded];if((selectedId===null||(selectedId&&!rows.some(row=>row.id===selectedId)))&&activeRows.length)selectedId=activeRows[0].id;
   for(const row of rows){
     if(row===recentEnded[0])list.append(el('h3','Recent work'));
     const card=el('article');card.className='task-card';card.dataset.objectiveId=row.id;card.dataset.state=stateOf(row);
     const head=el('div');head.className='task-head';
     const chip=el('span',stateLabel(row));chip.className='task-chip';
     const title=el('button',row.goal);title.type='button';title.className='task-index-row task-title';title.setAttribute('aria-expanded',String(selectedId===row.id));title.onclick=()=>{selectedId=selectedId===row.id?'':row.id;refresh();};
     const chat=button(row.conversationId?'Open chat':'Create chat',async()=>{const result=await api('nethra.openChat',{id:row.id});await openConversation(result.conversationId);setDrawerOpen(false);});chat.className='task-link';
     head.append(chip,title,chat);card.append(head);
     const line=row.tracking?((needsOwner(row.tracking.waitingFor?.kind)?`Needs you: ${row.tracking.waitingFor.detail||''}`:row.tracking.waitingFor?.kind==='budget'?row.tracking.waitingFor.detail:row.tracking.doing)||''):(row.step||'');
     if(line)card.append(Object.assign(el('p',line),{className:'task-line'}));
     if(row.progress?.total){const count=el('p',`${row.progress.done} of ${row.progress.total} steps ${row.mode==='ONGOING'?'this cycle':'done'}`);count.className='task-card-progress';const bar=el('progress');bar.max=row.progress.total;bar.value=row.progress.done;bar.setAttribute('aria-label','Completed task steps');card.append(bar,count);}
     // A visible continuous switch on every open task.
     if(!['COMPLETED','CANCELLED','FAILED'].includes(row.status)){const quick=checkbox(' Continuous passes',row.continuous===true);quick.label.className='task-toggle task-quick';quick.label.title='Continue useful plan steps in short passes';quick.input.onchange=()=>perform(()=>api('nethra.configure',{id:row.id,revision:row.revision,continuous:quick.input.checked}));card.append(quick.label);}
     list.append(card);
     if(selectedId!==row.id)continue;
     card.classList.add('selected');const detailCard=el('article');detailCard.className='task-detail';detailCard.dataset.objectiveId=row.id;
     const detailHead=el('div');detailHead.className='task-head';detailHead.append(Object.assign(el('span',stateLabel(row)),{className:'task-chip'}),Object.assign(el('h2',row.goal),{className:'task-detail-title'}),button(row.conversationId?'Open task chat':'Create task chat',async()=>{const opened=await api('nethra.openChat',{id:row.id});await openConversation(opened.conversationId);showView('chat');}));detailCard.dataset.state=stateOf(row);detailCard.append(detailHead);detailPane.replaceChildren(detailCard);
     const {task,approvals,events,attention,progress,performance,experiments}=await api('nethra.get',{id:row.id});
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
       add('Outputs',progress.outputs.length?progress.outputs.map(item=>`${item.path}${item.current?'':' (changed since written)'}`).join('\n'):null);
       add('Evidence',progress.evidence.length?progress.evidence.map(item=>`${item.ok?'✓':'✗'} ${item.line}`).join('\n'):null);
       if(task.summary&&!['WAITING_FOR_USER','BLOCKED'].includes(task.status))add("Nethra's note",task.summary);
       if(row.usage)add('Model time today',result.settings.objectiveDailyMs==null?`${Math.round(row.usage.todayMs/60000)} min · no daily limit`:`${Math.round(row.usage.todayMs/60000)} min of ${Math.round(result.settings.objectiveDailyMs/60000)} min daily limit`);
       detailCard.append(dl);}
     if(progress){const timeline=el('section');timeline.className='task-activity';timeline.append(el('h3','Work log · newest first'));if(progress.activity?.length){const items=el('ol');for(const item of progress.activity){const li=el('li');li.dataset.kind=item.kind;li.append(el('span',item.line),el('small',`${time(item.at)} · ${item.actor||'Junction'}${item.model?` (${item.model})`:''}`));items.append(li);}timeline.append(items);}else timeline.append(el('p','No recorded actions yet.'));detailCard.append(timeline);}
     if(performance){const metrics=el('section');metrics.className='task-performance';metrics.append(el('h3','Measured performance · last 7 days'));const seconds=ms=>`${(ms/1000).toFixed(1)} s`;const objective=performance.objective,chat=performance.chat;
       metrics.append(el('p',objective.sampleCount?`${objective.sampleCount} task model call${objective.sampleCount===1?'':'s'} · median inference ${seconds(objective.medianInferenceMs)} · latest ${time(objective.lastSampleAt)}`:'No measured samples for this task in the last 7 days.'));
       metrics.append(el('p',chat.sampleCount?`${chat.sampleCount} local chat repl${chat.sampleCount===1?'ies':'y'} across all conversations · median response ${seconds(chat.medianResponseMs)}${chat.medianTokensPerSecond?` · ${chat.medianTokensPerSecond} tokens/s`:''} · latest ${time(chat.lastSampleAt)}`:'No measured samples for local chat in the last 7 days.'));
       metrics.append(el('small','These are recorded timings, not a before-and-after speedup test.'));detailCard.append(metrics);}
     if(experiments?.length){const card=el('section');card.className='task-experiments';card.append(el('h3','Experiments · verdicts computed by Junction'));const items=el('ol');const status={BASELINE:'Baseline recorded; waiting for the change',CHANGED:'Change recorded; collecting samples',CONCLUDED:'Concluded'};
       for(const item of experiments){const li=el('li');li.dataset.verdict=item.result?.verdict||item.status;li.append(el('span',`${item.hypothesis} · ${item.metric.replace(/_/g,' ')}`),el('small',item.result?`${item.result.verdict.replace(/_/g,' ').toLowerCase()} · ${item.result.detail||''}`:`${status[item.status]||item.status} · baseline ${item.baseline.count} samples, median ${item.baseline.median}`));items.append(li);}card.append(items);detailCard.append(card);}
     if(open){
       const actions=el('div');actions.className='task-actions';
       if(task.status==='PAUSED')actions.append(button('Resume',()=>api('nethra.control',{id:task.id,action:'resume',revision:task.revision})));
       else if(!['WAITING_FOR_USER','BLOCKED'].includes(task.status))actions.append(button('Pause',()=>api('nethra.control',{id:task.id,action:'pause',revision:task.revision})));
       if(task.status==='SLEEPING')actions.append(button('Check now',()=>api('nethra.control',{id:task.id,action:'wake',revision:task.revision})));
       const editButton=el('button','Edit');editButton.type='button';actions.append(editButton);
       const stop=button('Stop task',async()=>{if(!window.confirm('Stop this task? It will not run again. Its chat, evidence and drafts are kept.'))return;await api('nethra.control',{id:task.id,action:'cancel',revision:task.revision});});stop.className='danger';actions.append(stop);
       const remove=button('Delete',async()=>{if(!window.confirm('Delete this task, its history and its drafts? Its chat is kept as an ordinary conversation. This cannot be undone.'))return;await api('nethra.delete',{id:task.id,confirm:true});selectedId=null;});remove.className='danger';actions.append(remove);
       detailCard.append(actions);
       {const continuous=checkbox(' Continue useful steps in short passes',task.continuous===true);continuous.label.className='task-toggle';
       continuous.input.onchange=()=>perform(()=>api('nethra.configure',{id:task.id,revision:task.revision,continuous:continuous.input.checked}));detailCard.append(continuous.label);if(task.mode==='ONGOING')detailCard.append(el('small','Once the plan is complete, monitoring follows its normal schedule.'));}
       // Edit the objective's wording; completed steps and evidence are kept.
       const editor=el('div');editor.className='task-editor';editor.hidden=true;const goalField=el('textarea');goalField.value=task.goal;goalField.setAttribute('aria-label','Edit goal');goalField.rows=3;
       const criteriaField=el('textarea');criteriaField.value=task.successCriteria&&task.successCriteria!==task.goal?task.successCriteria:'';criteriaField.placeholder='What does done look like? (optional)';criteriaField.setAttribute('aria-label','Edit success criteria');
       const editActions=el('div');editActions.className='task-actions';editActions.append(button('Save changes',()=>api('nethra.edit',{id:task.id,revision:task.revision,goal:goalField.value,successCriteria:criteriaField.value})),Object.assign(el('button','Cancel'),{type:'button',onclick:()=>{editor.hidden=true;}}));
       editor.append(el('label','Goal'),goalField,el('label','Success criteria'),criteriaField,editActions);editButton.onclick=()=>{editor.hidden=!editor.hidden;if(!editor.hidden)goalField.focus();};detailCard.append(editor);
       const redirect=el('details');redirect.append(el('summary','Change direction'));const redirectRow=el('div');redirectRow.className='redirect-row';const direction=el('textarea');direction.placeholder='Tell Nethra the new direction (keeps verified evidence)';direction.setAttribute('aria-label','Redirect objective');direction.maxLength=4000;
       redirectRow.append(direction,button('Redirect',()=>api('nethra.redirect',{id:task.id,revision:task.revision,instruction:direction.value})));redirect.append(redirectRow);detailCard.append(redirect);
       const taskMode=select('Objective type ',[['FINITE','Finish when achieved'],['ONGOING','Keep monitoring after each result']],task.mode||'FINITE');
       const profile=select('Autonomy ',[['QUIET','Quiet monitoring'],['BALANCED','Balanced initiative'],['ACTIVE','Active exploration']],task.autonomy||'BALANCED');
       const rank=select('Priority ',[[1,'1 · Highest'],[2,'2 · High'],[3,'3 · Normal'],[4,'4 · Low'],[5,'5 · Lowest']],String(task.priority||3));
       const review=select('Direction check-in ',[['DAILY','Daily'],['WEEKLY','Weekly'],['MILESTONES','At milestones or blockers'],['MANUAL','Manual only']],task.checkIn||'WEEKLY');
       const watches=checkbox(' Watch Google Calendar',(task.sources||[]).includes('calendar')),watchesMail=checkbox(' Watch Gmail',(task.sources||[]).includes('gmail')),codeWork=checkbox(' Self-improvement: Codex and Claude advice, measured experiments and development drafts (uses your plan allowances)',task.allowCodeWork===true);
       const approach=el('details');approach.append(el('summary','Approach and sources'));const controls=el('div');controls.className='objective-policy';controls.append(taskMode.wrapper,profile.wrapper,rank.wrapper,review.wrapper,watches.label,watchesMail.label,codeWork.label,el('p','Advice uses your live Codex and Claude plan usage, stopping at the reserve set in Settings. A development draft waits in Work Activity until you start it. Applying verified code to this checkout still requires your review.'),button('Save approach',()=>api('nethra.configure',{id:task.id,revision:task.revision,mode:taskMode.field.value,autonomy:profile.field.value,priority:Number(rank.field.value),checkIn:review.field.value,allowCodeWork:codeWork.input.checked,sources:[...(watches.input.checked?['calendar']:[]),...(watchesMail.input.checked?['gmail']:[])]})));approach.append(controls);detailCard.append(approach);
     }else{
       const remove=button('Delete',async()=>{if(!window.confirm('Delete this finished task, its history and its drafts? Its chat is kept.'))return;await api('nethra.delete',{id:task.id,confirm:true});selectedId=null;});remove.className='danger';
       const actions=el('div');actions.className='task-actions';actions.append(remove);detailCard.append(actions);
     }
     const record=el('details');record.append(el('summary','Full record'),details('Plan',{steps:task.plan,completed:task.completedSteps,pending:task.pendingSteps}),details('Evidence',task.evidence),details('Attention',attention||[]),details('History',events),details('Errors',task.errors));detailCard.append(record);
   }
 }catch(e){error.textContent=e.message;}finally{loading=false;if(refreshAgain){refreshAgain=false;refresh();}}}
 form.onsubmit=event=>{event.preventDefault();perform(async()=>{await api('nethra.create',{goal:goal.value,conversationId:activeConversationId||null,persistent:persistent.checked,mode:mode.field.value,readRoots:roots.value.trim()?[roots.value.trim()]:[],autonomy:autonomy.field.value,priority:Number(priority.field.value),checkIn:checkIn.field.value,continuous:continuousNew.input.checked,allowCodeWork:codeWorkNew.input.checked,sources:[...(watchCalendar.input.checked?['calendar']:[]),...(watchGmail.input.checked?['gmail']:[])]});goal.value='';watchCalendar.input.checked=watchGmail.input.checked=codeWorkNew.input.checked=false;});};
 startup.onchange=()=>perform(()=>api('nethra.settings',{persistentStartup:startup.checked}));
 openObjectives.onclick=()=>{const draft=document.getElementById('message-input').value.trim();if(draft)goal.value=draft;document.getElementById('chat-options').open=false;createDetails.open=true;setDrawerOpen(true);goal.focus();};
 objectiveStatus.onclick=()=>setDrawerOpen(!section.classList.contains('open'));
 document.querySelectorAll('[data-view="tasks"]').forEach(button=>button.addEventListener('click',()=>{section.classList.add('open');refresh();}));
 document.querySelectorAll('.nav[data-view]:not([data-view="tasks"])').forEach(button=>button.addEventListener('click',()=>section.classList.remove('open')));
 api('nethra.status',{warm:false}).then(s=>{showSettings(s.settings);modelStatus.textContent=`${s.model} · Windows host · ${s.capabilities.thinking?'native thinking supported':'thinking support unavailable'} · one inference at a time${s.modelState?` · ${s.modelState.state}`:''}`;showCalendar(s.sources.calendar);showGmail(s.sources.gmail);}).catch(e=>{modelStatus.textContent=e.message;});
 api('nethra.reunion',{since:Date.now()-86400000}).then(result=>{reunionBody.replaceChildren(el('p',`${result.objectives.length} saved objective(s) · ${result.pendingApprovals} approval(s) waiting`));for(const event of result.events.slice(0,8))reunionBody.append(el('p',`${time(event.at)} · ${event.kind} · ${event.taskId.slice(0,8)}`));}).catch(e=>{reunionBody.textContent=e.message;});
 setInterval(()=>{if(section.classList.contains('open')&&!document.querySelector('#view-tasks textarea:focus,#view-tasks input:focus,#view-tasks select:focus'))refresh();else if(document.getElementById('view-chat').classList.contains('active'))refreshBadge();},5000);refreshBadge();
})();
