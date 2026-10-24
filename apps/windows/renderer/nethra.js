'use strict';
(()=>{
 const el=(tag,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};
 const section=el('aside');section.id='nethra-task-drawer';section.className='nethra-task-drawer';section.setAttribute('aria-label','Nethra tasks');section.setAttribute('aria-hidden','true');section.inert=true;
 const header=el('header'),title=el('h2','Nethra tasks'),close=el('button','×');close.type='button';close.setAttribute('aria-label','Close task drawer');header.append(title,close);section.append(header);
 const area=el('div');area.className='foreman-area';section.append(area);document.querySelector('#view-chat .chat-layout').append(section);
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
 const watchCalendar=checkbox(' Watch my Google Calendar (read-only)'),watchGmail=checkbox(' Watch new Gmail inbox mail (headers only)');
 const create=el('button','Create objective');create.type='submit';form.append(goal,roots,persistenceLabel,policyFields,watchCalendar.label,watchGmail.label,create);const createDetails=el('details');createDetails.className='task-create-details';createDetails.append(el('summary','New objective'),form);area.append(createDetails);
 const settings=el('article');settings.className='panel';const thinking=el('input');thinking.type='checkbox';thinking.checked=true;thinking.disabled=true;const thinkingLabel=el('label',' Thinking is always on with Qwen3 30B');thinkingLabel.prepend(thinking);
 const startup=el('input');startup.type='checkbox';const startupLabel=el('label',' Start Nethra after Windows sign-in');startupLabel.prepend(startup);const modelStatus=el('p','Checking host…');settings.append(thinkingLabel,startupLabel,modelStatus);document.querySelector('.settings').append(settings);
 // Model warm-up and proactive updates. Loading never generates a reply or touches chats.
 const warmPanel=el('article');warmPanel.className='panel';warmPanel.append(el('h2','Model readiness and updates'),el('p','Junction can load Qwen3 30B before you need it. A load uses about 10 GB of GPU memory and 9 GB of system RAM on this PC and is skipped automatically when free memory is low.'));
 const warmGrid=el('div');warmGrid.className='appearance-grid';warmPanel.append(warmGrid);
 const warmStartup=select('Load model at launch ',[['desktop','When I open Junction'],['always','Also at Windows sign-in'],['never','Only when I chat']],'desktop');
 const retention=select('Keep loaded after last use ',[['15m','15 minutes'],['30m','30 minutes'],['1h','1 hour'],['2h','2 hours (default)'],['4h','4 hours'],['8h','8 hours']],'2h');
 const proactive=select('Task updates in chat ',[['ALL','Milestones and outcomes'],['IMPORTANT','Only outcomes and requests'],['OFF','None (Tasks only)']],'ALL');
 const quietOn=checkbox(' Quiet hours (hold task updates)'),quietStart=el('input'),quietEnd=el('input');quietStart.type=quietEnd.type='time';
 const quietStartLabel=el('label','Quiet from ');quietStartLabel.append(quietStart);const quietEndLabel=el('label','until ');quietEndLabel.append(quietEnd);
 warmGrid.append(warmStartup.wrapper,retention.wrapper,proactive.wrapper,quietOn.label,quietStartLabel,quietEndLabel);document.querySelector('.settings').append(warmPanel);
 const saveSetting=patch=>perform(()=>api('nethra.settings',patch));
 warmStartup.field.onchange=()=>saveSetting({warmOnStartup:warmStartup.field.value});retention.field.onchange=()=>saveSetting({idleRetention:retention.field.value});proactive.field.onchange=()=>saveSetting({proactiveUpdates:proactive.field.value});
 const saveQuiet=()=>{if(quietStart.value&&quietEnd.value)saveSetting({quietHours:{enabled:quietOn.input.checked,start:quietStart.value,end:quietEnd.value}});};quietOn.input.onchange=saveQuiet;quietStart.onchange=saveQuiet;quietEnd.onchange=saveQuiet;
 const showSettings=value=>{if(!value)return;warmStartup.field.value=value.warmOnStartup||'desktop';retention.field.value=value.idleRetention||'2h';proactive.field.value=value.proactiveUpdates||'ALL';quietOn.input.checked=Boolean(value.quietHours?.enabled);quietStart.value=value.quietHours?.start||'22:00';quietEnd.value=value.quietHours?.end||'07:00';};
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
 const updateObjectiveStatus=objectives=>{const active=objectives.filter(visible).length;objectiveStatus.textContent=active?`${active} active`:'Tasks';objectiveStatus.classList.toggle('has-active',active>0);};
 const updateStrip=()=>{const linked=lastObjectives.filter(row=>row.conversationId&&row.conversationId===activeConversationId);strip.hidden=!linked.length;if(!linked.length)return;const row=linked[0],wake='',needs=row.tracking&&!['nothing','time','source'].includes(row.tracking.waitingFor?.kind)?' · needs you':'',progress=row.progress?.total?` · Step ${Math.min(row.progress.done+1,row.progress.total)} of ${row.progress.total}${row.step?`: ${row.step}`:''}`:'';strip.textContent=`${linked.length>1?`${linked.length} tasks · `:''}${row.goal} · ${row.live?'Working now':row.status.replaceAll('_',' ')}${needs}${wake}${progress} · ${row.nextWakeAt?`Next wake ${time(row.nextWakeAt)}`:'No wake scheduled'}`;};
 const refreshBadge=async()=>{try{lastObjectives=(await api('nethra.list')).objectives;updateObjectiveStatus(lastObjectives);updateStrip();}catch{objectiveStatus.textContent='Tasks';}};
 window.addEventListener('junction:chat-opened',refreshBadge);
 strip.onclick=()=>{const row=lastObjectives.find(item=>item.conversationId===activeConversationId);if(row)selectedId=row.id;setDrawerOpen(true);};
 const setDrawerOpen=open=>{section.classList.toggle('open',open);section.setAttribute('aria-hidden',String(!open));section.inert=!open;objectiveStatus.setAttribute('aria-expanded',String(open));if(open)refresh();};
 close.onclick=()=>setDrawerOpen(false);
 const perform=async fn=>{try{error.textContent='';await fn();}catch(e){error.textContent=e.message;}finally{await refresh();}};
 const button=(label,fn)=>{const b=el('button',label);b.type='button';b.onclick=()=>perform(fn);return b;};
 const time=value=>value?new Date(value).toLocaleString():'None scheduled';
 const details=(label,value)=>{const d=el('details');d.append(el('summary',label),el('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));return d;};
 async function refresh(){if(loading){refreshAgain=true;return;}loading=true;try{
   const result=await api('nethra.list');thinking.checked=true;startup.checked=result.settings.persistentStartup;showSettings(result.settings);lastObjectives=result.objectives;updateObjectiveStatus(result.objectives);updateStrip();
   const answerDrafts=new Map([...list.querySelectorAll('article[data-objective-id]')].map(card=>[card.dataset.objectiveId,card.querySelector('textarea[aria-label="Answer Nethra"]')?.value||'']));
   list.replaceChildren();const activeRows=result.objectives.filter(visible);if(!activeRows.length)list.append(el('p','No active tasks. Start one from the chat draft.'));
   const recentEnded=result.objectives.filter(row=>!visible(row)).slice(0,5);
   const rows=[...activeRows,...recentEnded];if((selectedId===null||(selectedId&&!rows.some(row=>row.id===selectedId)))&&activeRows.length)selectedId=activeRows[0].id;
   for(const row of rows){if(row===recentEnded[0])list.append(el('h3','Recent work'));const card=el('article');card.className='delegation-card';card.dataset.objectiveId=row.id;const heading=el('button',`${row.live?'● Working now':'○ '+row.status.replaceAll('_',' ')} · ${row.goal}`);heading.type='button';heading.className='task-index-row';heading.setAttribute('aria-expanded',String(selectedId===row.id));heading.onclick=()=>{selectedId=selectedId===row.id?'':row.id;refresh();};card.append(heading);if(row.step)card.append(el('p',row.step));
     const openChat=button(row.conversationId?'Open chat':'Create chat',async()=>{const result=await api('nethra.openChat',{id:row.id});await openConversation(result.conversationId);setDrawerOpen(false);});card.append(openChat);
     if(selectedId!==row.id){list.append(card);continue;}
     const {task,approvals,events,attention,progress}=await api('nethra.get',{id:row.id});card.append(el('strong',row.live?'Working now':task.status.replaceAll('_',' ')));
     // Host-recorded tracking first; the model's own summary is labelled as its narration.
     if(progress){const dl=el('dl');dl.className='tracking';const add=(term,value,cls)=>{if(!value)return;const dd=el('dd',value);if(cls)dd.className=cls;dl.append(el('dt',term),dd);};
       add('Doing',progress.doing);add('Last done',progress.lastAccomplished?`${progress.lastAccomplished.line} (${time(progress.lastAccomplished.at)})`:null);add('Next',progress.next);
       add('Wakes',progress.wake?`${time(progress.wake.at)} — ${progress.wake.reason}`:null);
       if(!['nothing','time','source'].includes(progress.waitingFor.kind))add('Needs you',progress.waitingFor.detail,'needs');else if(progress.waitingFor.kind!=='time')add('Waiting for',progress.waitingFor.detail);
       add('Outputs',progress.outputs.length?progress.outputs.map(item=>`${item.path}${item.current?'':' (changed since written)'}`).join('\n'):null);
       add('Evidence',progress.evidence.length?progress.evidence.map(item=>`${item.ok?'✓':'✗'} ${item.line}`).join('\n'):null);
       card.append(dl);}
     card.append(el('p',task.summary?`Nethra's note: ${task.summary}`:'Waiting for a useful next action'),el('p',`Direction review: ${time(task.nextDirectionCheckAt)}`));
     if(row.progress?.total)card.append(el('p',row.step?`Step ${Math.min(row.progress.done+1,row.progress.total)} of ${row.progress.total}: ${row.step}`:`${row.progress.done} of ${row.progress.total} steps done`));
     if(task.mode==='ONGOING')card.append(el('p','Ongoing monitoring'));
     const taskMode=select('Objective type ',[['FINITE','Finish when achieved'],['ONGOING','Keep monitoring after each result']],task.mode||'FINITE');
     const profile=select('Autonomy ',[['QUIET','Quiet monitoring'],['BALANCED','Balanced initiative'],['ACTIVE','Active exploration']],task.autonomy||'BALANCED');
     const rank=select('Priority ',[[1,'1 · Highest'],[2,'2 · High'],[3,'3 · Normal'],[4,'4 · Low'],[5,'5 · Lowest']],String(task.priority||3));
     const review=select('Direction check-in ',[['DAILY','Daily'],['WEEKLY','Weekly'],['MILESTONES','At milestones or blockers'],['MANUAL','Manual only']],task.checkIn||'WEEKLY');
     const watches=checkbox(' Watch Google Calendar',(task.sources||[]).includes('calendar')),watchesMail=checkbox(' Watch Gmail',(task.sources||[]).includes('gmail'));
     if(!['COMPLETED','CANCELLED','FAILED'].includes(task.status)){const controls=el('div');controls.className='objective-policy';controls.append(taskMode.wrapper,profile.wrapper,rank.wrapper,review.wrapper,watches.label,watchesMail.label,button('Save approach',()=>api('nethra.configure',{id:task.id,revision:task.revision,mode:taskMode.field.value,autonomy:profile.field.value,priority:Number(rank.field.value),checkIn:review.field.value,sources:[...(watches.input.checked?['calendar']:[]),...(watchesMail.input.checked?['gmail']:[])]})));card.append(controls);}
     card.append(details('Plan',{steps:task.plan,completed:task.completedSteps,pending:task.pendingSteps}),details('Evidence',task.evidence),details('Attention',attention||[]),details('History',events),details('Errors',task.errors));
     if(!['COMPLETED','CANCELLED','FAILED'].includes(task.status)){
       const action=task.status==='PAUSED'||task.status==='BLOCKED'?'resume':'pause';card.append(button(action==='pause'?'Pause':'Resume',()=>api('nethra.control',{id:task.id,action,revision:task.revision})),button('Cancel objective',()=>api('nethra.control',{id:task.id,action:'cancel',revision:task.revision})));
       if(task.status==='SLEEPING')card.append(button('Check now',()=>api('nethra.control',{id:task.id,action:'wake',revision:task.revision})));
       const redirectRow=el('div');redirectRow.className='redirect-row';const direction=el('textarea');direction.placeholder='Redirect: tell Nethra the new direction (keeps verified evidence)';direction.setAttribute('aria-label','Redirect objective');direction.maxLength=4000;
       redirectRow.append(direction,button('Redirect',()=>api('nethra.redirect',{id:task.id,revision:task.revision,instruction:direction.value})));card.append(redirectRow);
     }
     for(const approval of approvals.filter(a=>a.status==='PENDING')){const panel=el('div');panel.append(el('strong',`Approval required: ${approval.tool}`),el('p',approval.reviewReason||''),details('Exact action',approval.args),button(approval.reviewRequired?'Approve exact retry':'Approve',()=>api('nethra.approve',{id:approval.id,approved:true})),button('Reject',()=>api('nethra.approve',{id:approval.id,approved:false})));card.append(panel);}
     if(task.status==='WAITING_FOR_USER'&&!approvals.some(a=>a.status==='PENDING')){const answer=el('textarea');answer.placeholder='Answer Nethra';answer.setAttribute('aria-label','Answer Nethra');answer.value=answerDrafts.get(task.id)||'';card.append(answer,button('Send answer',()=>api('nethra.answer',{id:task.id,revision:task.revision,answer:answer.value})));}
     list.append(card);
   }
 }catch(e){error.textContent=e.message;}finally{loading=false;if(refreshAgain){refreshAgain=false;refresh();}}}
 form.onsubmit=event=>{event.preventDefault();perform(async()=>{await api('nethra.create',{goal:goal.value,conversationId:activeConversationId||null,persistent:persistent.checked,mode:mode.field.value,readRoots:roots.value.trim()?[roots.value.trim()]:[],autonomy:autonomy.field.value,priority:Number(priority.field.value),checkIn:checkIn.field.value,sources:[...(watchCalendar.input.checked?['calendar']:[]),...(watchGmail.input.checked?['gmail']:[])]});goal.value='';watchCalendar.input.checked=watchGmail.input.checked=false;});};
 startup.onchange=()=>perform(()=>api('nethra.settings',{persistentStartup:startup.checked}));
 openObjectives.onclick=()=>{const draft=document.getElementById('message-input').value.trim();if(draft)goal.value=draft;document.getElementById('chat-options').open=false;createDetails.open=true;setDrawerOpen(true);goal.focus();};
 objectiveStatus.onclick=()=>setDrawerOpen(!section.classList.contains('open'));
 api('nethra.status',{warm:false}).then(s=>{showSettings(s.settings);modelStatus.textContent=`${s.model} · Windows host · ${s.capabilities.thinking?'native thinking supported':'thinking support unavailable'} · one inference at a time${s.modelState?` · ${s.modelState.state}`:''}`;showCalendar(s.sources.calendar);showGmail(s.sources.gmail);}).catch(e=>{modelStatus.textContent=e.message;});
 api('nethra.reunion',{since:Date.now()-86400000}).then(result=>{reunionBody.replaceChildren(el('p',`${result.objectives.length} saved objective(s) · ${result.pendingApprovals} approval(s) waiting`));for(const event of result.events.slice(0,8))reunionBody.append(el('p',`${time(event.at)} · ${event.kind} · ${event.taskId.slice(0,8)}`));}).catch(e=>{reunionBody.textContent=e.message;});
 setInterval(()=>{if(section.classList.contains('open')&&!section.querySelector('textarea[aria-label="Answer Nethra"]:focus'))refresh();else if(document.getElementById('view-chat').classList.contains('active'))refreshBadge();},5000);refreshBadge();
})();
