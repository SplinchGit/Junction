'use strict';
(()=>{
 const el=(tag,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};
 const nav=el('button','Objectives');nav.className='nav';nav.dataset.view='nethra';document.querySelector('.nav-more-menu').prepend(nav);
 const section=el('section');section.id='view-nethra';section.className='view';document.querySelector('main').append(section);
 const header=el('header'),title=el('h1','Objectives');header.append(title);section.append(header);
 const area=el('div');area.className='foreman-area';section.append(area);
 const notice=el('p','One local agent on your Windows PC. Enabled objectives continue while the desktop window is closed.');area.append(notice);
 const reunion=el('details');reunion.append(el('summary','Since you were away'));const reunionBody=el('div','Checking saved activity…');reunion.append(reunionBody);area.append(reunion);
 const error=el('p');error.role='status';area.append(error);
 const form=el('form');form.className='panel';const goal=el('textarea');goal.placeholder='Give Nethra a goal and describe what success looks like';goal.setAttribute('aria-label','Objective');goal.rows=3;goal.required=true;goal.maxLength=8000;
 const roots=el('input');roots.placeholder='Optional approved read folder on this PC';roots.setAttribute('aria-label','Approved read folder');
 const persistent=el('input');persistent.type='checkbox';persistent.checked=true;const persistenceLabel=el('label',' Continue autonomously across restarts');persistenceLabel.prepend(persistent);
 const select=(label,values,chosen)=>{const wrapper=el('label',label);const field=el('select');for(const [value,title] of values){const option=el('option',title);option.value=value;field.append(option);}field.value=chosen;wrapper.append(field);return {wrapper,field};};
 const autonomy=select('Autonomy ',[['QUIET','Quiet monitoring'],['BALANCED','Balanced initiative'],['ACTIVE','Active exploration']],'BALANCED');
 const priority=select('Priority ',[[1,'1 · Highest'],[2,'2 · High'],[3,'3 · Normal'],[4,'4 · Low'],[5,'5 · Lowest']],'3');
 const checkIn=select('Direction check-in ',[['DAILY','Daily'],['WEEKLY','Weekly'],['MILESTONES','At milestones or blockers'],['MANUAL','Manual only']],'WEEKLY');
 const policyFields=el('div');policyFields.className='objective-policy';policyFields.append(autonomy.wrapper,priority.wrapper,checkIn.wrapper);
 const checkbox=(text,checked=false)=>{const input=el('input');input.type='checkbox';input.checked=checked;const label=el('label',text);label.prepend(input);return {label,input};};
 const watchCalendar=checkbox(' Watch my Google Calendar (read-only)');
 const create=el('button','Create objective');create.type='submit';form.append(goal,roots,persistenceLabel,policyFields,watchCalendar.label,create);area.append(form);
 const settings=el('article');settings.className='panel';const thinking=el('input');thinking.type='checkbox';thinking.checked=true;thinking.disabled=true;const thinkingLabel=el('label',' Thinking is always on with Qwen3 30B');thinkingLabel.prepend(thinking);
 const startup=el('input');startup.type='checkbox';const startupLabel=el('label',' Start Nethra after Windows sign-in');startupLabel.prepend(startup);const modelStatus=el('p','Checking host…');settings.append(thinkingLabel,startupLabel,modelStatus);area.append(settings);
 // Read-only Calendar grant owned by this PC; consent opens in the default browser.
 const calendarPanel=el('article');calendarPanel.className='panel';const calendarStatus=el('p','Google Calendar: checking…');
 const clientId=el('input');clientId.placeholder='Desktop OAuth client ID (…apps.googleusercontent.com)';clientId.setAttribute('aria-label','Google OAuth client ID');
 const clientSecret=el('input');clientSecret.type='password';clientSecret.placeholder='Client secret shown with the Desktop client';clientSecret.setAttribute('aria-label','Google OAuth client secret');
 const calendarButtons=el('div');calendarButtons.className='objective-policy';
 calendarPanel.append(el('h2','Google Calendar'),calendarStatus,clientId,clientSecret,calendarButtons);area.append(calendarPanel);
 const describeCalendar=c=>c.status==='DISCONNECTED'?'Google Calendar: not connected. Nethra cannot see your calendar.':c.status==='CONNECTED'?`Google Calendar: connected (read-only) · ${c.events} upcoming event(s) · last checked ${new Date(c.lastSyncAt).toLocaleString()}`:c.status==='STALE'?`Google Calendar: connected but not checked since ${c.lastSyncAt?new Date(c.lastSyncAt).toLocaleString():'connection'}`:`Google Calendar: ${c.error}`;
 const showCalendar=c=>{calendarStatus.textContent=describeCalendar(c);const connected=c.status!=='DISCONNECTED';clientId.hidden=clientSecret.hidden=connected;
   calendarButtons.replaceChildren(...(connected?[button('Check now',async()=>showCalendar((await api('nethra.source.calendar',{action:'sync'})).calendar)),button('Disconnect',async()=>showCalendar((await api('nethra.source.calendar',{action:'disconnect'})).calendar))]:[button('Connect read-only',async()=>{calendarStatus.textContent='Finish consent in your browser…';showCalendar((await api('nethra.source.calendar',{action:'connect',clientId:clientId.value.trim(),clientSecret:clientSecret.value.trim()})).calendar);clientSecret.value='';})]));};
 const chatThinking=el('div','Thinking on');chatThinking.id='chat-thinking';chatThinking.className='research-toggle fixed-option';chatThinking.title='Qwen3 30B uses thinking on every reply';chatThinking.setAttribute('aria-disabled','true');document.getElementById('research-toggle').after(chatThinking);
 const openObjectives=el('button','Continue as objective');openObjectives.id='new-objective';openObjectives.type='button';openObjectives.className='research-toggle';document.querySelector('.chat-options-panel').append(openObjectives);
 const objectiveStatus=el('button','Objectives');objectiveStatus.id='objective-status';objectiveStatus.type='button';objectiveStatus.title='View saved Nethra objectives and next wakes';document.getElementById('new-chat').before(objectiveStatus);
 const list=el('div');area.append(list);let loading=false,refreshAgain=false;
 const api=(type,payload={})=>window.junction.nethra(type,payload);
 const updateObjectiveStatus=objectives=>{const active=objectives.filter(task=>!['COMPLETED','CANCELLED','FAILED'].includes(task.status)).length;objectiveStatus.textContent=active?`${active} active`:'Objectives';objectiveStatus.classList.toggle('has-active',active>0);};
 const refreshBadge=async()=>{try{updateObjectiveStatus((await api('nethra.list')).objectives);}catch{objectiveStatus.textContent='Objectives';}};
 const perform=async fn=>{try{error.textContent='';await fn();}catch(e){error.textContent=e.message;}finally{await refresh();}};
 const button=(label,fn)=>{const b=el('button',label);b.type='button';b.onclick=()=>perform(fn);return b;};
 const time=value=>value?new Date(value).toLocaleString():'None scheduled';
 const details=(label,value)=>{const d=el('details');d.append(el('summary',label),el('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));return d;};
 async function refresh(){if(loading){refreshAgain=true;return;}loading=true;try{
   const result=await api('nethra.list');thinking.checked=true;startup.checked=result.settings.persistentStartup;updateObjectiveStatus(result.objectives);
   const answerDrafts=new Map([...list.querySelectorAll('article[data-objective-id]')].map(card=>[card.dataset.objectiveId,card.querySelector('textarea[aria-label="Answer Nethra"]')?.value||'']));
   list.replaceChildren();if(!result.objectives.length)list.append(el('p','No objectives yet. Describe your first goal above.'));
   for(const row of result.objectives){const {task,approvals,events,attention}=await api('nethra.get',{id:row.id});const card=el('article');card.className='delegation-card';card.dataset.objectiveId=task.id;card.append(el('h2',task.goal),el('strong',task.status.replaceAll('_',' ')),el('p',task.summary||'Waiting for a useful next action'),el('p',`Next wake: ${time(task.nextWakeAt)}`),el('p',`Direction review: ${time(task.nextDirectionCheckAt)}`));
     const profile=select('Autonomy ',[['QUIET','Quiet monitoring'],['BALANCED','Balanced initiative'],['ACTIVE','Active exploration']],task.autonomy||'BALANCED');
     const rank=select('Priority ',[[1,'1 · Highest'],[2,'2 · High'],[3,'3 · Normal'],[4,'4 · Low'],[5,'5 · Lowest']],String(task.priority||3));
     const review=select('Direction check-in ',[['DAILY','Daily'],['WEEKLY','Weekly'],['MILESTONES','At milestones or blockers'],['MANUAL','Manual only']],task.checkIn||'WEEKLY');
     const watches=checkbox(' Watch Google Calendar',(task.sources||[]).includes('calendar'));
     if(!['COMPLETED','CANCELLED','FAILED'].includes(task.status)){const controls=el('div');controls.className='objective-policy';controls.append(profile.wrapper,rank.wrapper,review.wrapper,watches.label,button('Save approach',()=>api('nethra.configure',{id:task.id,revision:task.revision,autonomy:profile.field.value,priority:Number(rank.field.value),checkIn:review.field.value,sources:watches.input.checked?['calendar']:[]})));card.append(controls);}
     card.append(details('Plan',{steps:task.plan,completed:task.completedSteps,pending:task.pendingSteps}),details('Evidence',task.evidence),details('Attention',attention||[]),details('History',events),details('Errors',task.errors));
     if(!['COMPLETED','CANCELLED','FAILED'].includes(task.status)){
       const action=task.status==='PAUSED'||task.status==='BLOCKED'?'resume':'pause';card.append(button(action==='pause'?'Pause':'Resume',()=>api('nethra.control',{id:task.id,action,revision:task.revision})),button('Cancel objective',()=>api('nethra.control',{id:task.id,action:'cancel',revision:task.revision})));
     }
     for(const approval of approvals.filter(a=>a.status==='PENDING')){const panel=el('div');panel.append(el('strong',`Approval required: ${approval.tool}`),el('p',approval.reviewReason||''),details('Exact action',approval.args),button(approval.reviewRequired?'Approve exact retry':'Approve',()=>api('nethra.approve',{id:approval.id,approved:true})),button('Reject',()=>api('nethra.approve',{id:approval.id,approved:false})));card.append(panel);}
     if(task.status==='WAITING_FOR_USER'&&!approvals.some(a=>a.status==='PENDING')){const answer=el('textarea');answer.placeholder='Answer Nethra';answer.setAttribute('aria-label','Answer Nethra');answer.value=answerDrafts.get(task.id)||'';card.append(answer,button('Send answer',()=>api('nethra.answer',{id:task.id,revision:task.revision,answer:answer.value})));}
     list.append(card);
   }
 }catch(e){error.textContent=e.message;}finally{loading=false;if(refreshAgain){refreshAgain=false;refresh();}}}
 form.onsubmit=event=>{event.preventDefault();perform(async()=>{await api('nethra.create',{goal:goal.value,persistent:persistent.checked,readRoots:roots.value.trim()?[roots.value.trim()]:[],autonomy:autonomy.field.value,priority:Number(priority.field.value),checkIn:checkIn.field.value,sources:watchCalendar.input.checked?['calendar']:[]});goal.value='';watchCalendar.input.checked=false;});};
 startup.onchange=()=>perform(()=>api('nethra.settings',{persistentStartup:startup.checked}));
 nav.onclick=()=>{document.querySelector('.nav-more').open=false;showView('nethra');refresh();};
 openObjectives.onclick=()=>{const draft=document.getElementById('message-input').value.trim();if(draft)goal.value=draft;document.getElementById('chat-options').open=false;nav.click();goal.focus();};
 objectiveStatus.onclick=()=>nav.click();
 api('nethra.status').then(s=>{modelStatus.textContent=`${s.model} · Windows host · ${s.capabilities.thinking?'native thinking supported':'thinking support unavailable'} · one inference at a time · Gmail not connected`;showCalendar(s.sources.calendar);}).catch(e=>{modelStatus.textContent=e.message;});
 api('nethra.reunion',{since:Date.now()-86400000}).then(result=>{reunionBody.replaceChildren(el('p',`${result.objectives.length} saved objective(s) · ${result.pendingApprovals} approval(s) waiting`));for(const event of result.events.slice(0,8))reunionBody.append(el('p',`${time(event.at)} · ${event.kind} · ${event.taskId.slice(0,8)}`));}).catch(e=>{reunionBody.textContent=e.message;});
 setInterval(()=>{if(section.classList.contains('active')&&!section.querySelector('textarea[aria-label="Answer Nethra"]:focus'))refresh();else if(document.getElementById('view-chat').classList.contains('active'))refreshBadge();},5000);refresh();
})();
