"use strict";
// Real Electron renderer/preload/IPC and local persistence, isolated from owner
// data and external services. No inference, voice, sign-in or paid API requests.
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-offline-ui-"));
app.setPath("userData", directory);
global.fetch = async () => { throw new Error("OFFLINE_UI_TEST_NETWORK_DISABLED"); };
// Background transports have their own suites; never connect this test instance
// to James's phone/VM or advertise another Junction on his network.
require("../src/world-host-relay").WorldHostRelay.prototype.start = function () {};
require("../src/lan-relay-lifecycle").LanRelayLifecycle.prototype.start = async function () {
  throw new Error("OFFLINE_UI_TEST_LAN_DISABLED");
};
require("../src/local-brain-relay").LocalBrainRelay.prototype.start = function () {};
require("../src/nethra-scheduler").NethraScheduler.prototype.start = function () {};
require("../src/codex-client").getCodexStatus = async () => ({available: false});
const errors = [];
const deadline = setTimeout(() => { console.error("Offline UI test timed out"); app.exit(1); }, 45000);
app.on("browser-window-created", (_event, window) => {
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const views = [];
        for (const button of document.querySelectorAll('.nav[data-view]')) {
          button.click();
          const active = document.querySelector('.view.active');
          if (active?.id !== 'view-' + button.dataset.view) throw new Error('Navigation failed: ' + button.dataset.view);
          views.push(button.dataset.view);
        }
        const chat = await window.junction.newConversation();
        await window.junction.renameConversation({id:chat.id,title:'Offline smoke fixture'});
        const history = await window.junction.conversations();
        await window.junction.addMemory({category:'test',content:'Offline fixture fact'});
        const memory = await window.junction.memories();
        await window.junction.deleteMemory(memory.find(item=>item.content==='Offline fixture fact').id);
        const removed = !(await window.junction.memories()).some(item=>item.content==='Offline fixture fact');
        await window.junction.deleteConversation(chat.id);
        showView('chat');document.getElementById('objective-status').click();
        const goal=document.querySelector('#nethra-task-drawer textarea[aria-label="Objective"]');
        goal.value='Offline Nethra objective';goal.form.requestSubmit();
        let objective;
        for(let attempt=0;attempt<100&&!objective;attempt++){
          objective=(await window.junction.nethra('nethra.list')).objectives.find(t=>t.goal==='Offline Nethra objective');
          if(!objective)await new Promise(resolve=>setTimeout(resolve,10));
        }
        if(!objective)throw new Error('Nethra form did not create its objective');
        const paused=await window.junction.nethra('nethra.control',{id:objective.id,action:'pause',revision:objective.revision});
        const resumed=await window.junction.nethra('nethra.control',{id:objective.id,action:'resume',revision:paused.task.revision});
        const cancelled=await window.junction.nethra('nethra.control',{id:objective.id,action:'cancel',revision:resumed.task.revision});
        const detail=await window.junction.nethra('nethra.get',{id:objective.id});
        const nethra=paused.task.status==='PAUSED'&&resumed.task.status==='ACTIVE'&&cancelled.task.status==='CANCELLED'&&detail.task.status==='CANCELLED'&&detail.events.some(e=>e.kind==='CANCEL');
        document.getElementById('objective-status').click();
        document.getElementById('objective-status').click();
        for(let attempt=0;attempt<100&&document.querySelector('#nethra-task-drawer article[data-objective-id="'+objective.id+'"]');attempt++)await new Promise(resolve=>setTimeout(resolve,10));
        const completedHidden=!document.querySelector('#nethra-task-drawer article[data-objective-id="'+objective.id+'"]');
        const workControls=['refresh-delegations','plan-delegation','plan-mafioso','delegation-list','foreman-projects'].every(id=>!!document.getElementById(id));
        showView('chat');
        const options=document.getElementById('chat-options');
        const collapsed=!options.open&&['chat-provider','chat-model','research-toggle','verbose-toggle'].every(id=>options.contains(document.getElementById(id)));
        options.querySelector('summary').click();
        const expanded=options.open&&options.contains(document.querySelector('#chat-options button[aria-pressed]'));
        const primaryNavigation=[...document.querySelectorAll('nav > .nav')].map(node=>node.dataset.view);
        const standaloneObjectiveScreen=document.getElementById('view-nethra')!=null;
        const objectiveStatus=document.getElementById('objective-status')?.closest('#view-chat header')!=null;
        const input=document.getElementById('message-input');input.value='Draft a persistent research objective';
        document.querySelector('#chat-options #new-objective').click();
        const objectivePrefill=document.querySelector('#nethra-task-drawer textarea[aria-label="Objective"]').value===input.value&&document.getElementById('nethra-task-drawer').classList.contains('open');
        const thinkingFixed=document.querySelector('#chat-options #chat-thinking')?.getAttribute('aria-disabled')==='true';
        return {views,created:history.some(item=>item.id===chat.id),removed,nethra,completedHidden,workControls,collapsed,expanded,primaryNavigation,standaloneObjectiveScreen,objectiveStatus,objectivePrefill,thinkingFixed,extracted:!document.getElementById('open-mafioso'),hasPreload:typeof window.junction.audit==='function'};
      })()`);
      assert.deepEqual(result.views, ["chat", "audit", "feed", "projects", "context", "settings"]);
      assert.deepEqual(result.primaryNavigation,["chat","audit"]);
      assert.equal(result.standaloneObjectiveScreen,false,'standalone objective screen removed');
      for (const key of ["created", "removed", "nethra", "completedHidden", "workControls", "collapsed", "expanded", "objectiveStatus", "objectivePrefill", "thinkingFixed", "extracted", "hasPreload"]) assert.equal(result[key], true, key);
      assert.deepEqual(errors, [], "Renderer errors");
      const {NethraStore}=require('../src/nethra-store');
      const waitingStore=new NethraStore(path.join(directory,'nethra'));
      const waiting=waitingStore.create({goal:'Preserve typed owner answer'});
      waitingStore.update(waiting.id,{status:'WAITING_FOR_USER',summary:'Please answer'});
      waitingStore.close();
      const answerPersists=await window.webContents.executeJavaScript(`(async()=>{
        if(document.getElementById('nethra-task-drawer').classList.contains('open'))document.getElementById('objective-status').click();
        document.getElementById('objective-status').click();
        let input;
        for(let i=0;i<100&&!input;i++){input=document.querySelector('textarea[aria-label="Answer Nethra"]');if(!input)await new Promise(resolve=>setTimeout(resolve,20));}
        if(!input)throw Error('Owner answer field missing');
        input.focus();input.value='Owner answer in progress';
        await new Promise(resolve=>setTimeout(resolve,5500));
        return document.querySelector('textarea[aria-label="Answer Nethra"]')?.value==='Owner answer in progress';
      })()`);
      assert.equal(answerPersists,true,'owner answer survives background refresh');
      await window.webContents.executeJavaScript(`(async()=>{
        await window.junction.nethra('nethra.create',{goal:'Review local research tomorrow',persistent:true});
        if(document.getElementById('nethra-task-drawer').classList.contains('open'))document.getElementById('objective-status').click();
        document.getElementById('objective-status').click();
        for(let attempt=0;attempt<100;attempt++){
          if(document.querySelector('#nethra-task-drawer').textContent.includes('Review local research tomorrow'))return;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        throw new Error('Nethra objective controls did not render');
      })()`);
      const nethraOutput=path.join(__dirname,"../test-results/offline-ui-nethra.png");
      fs.writeFileSync(nethraOutput,(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`showView('chat');document.getElementById('chat-options').open=true`);
      await new Promise(resolve=>setTimeout(resolve,250));
      const output = path.join(__dirname, "../test-results/offline-ui-smoke.png");
      fs.writeFileSync(output, (await window.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({passed: true, ...result, screenshot: output,nethraScreenshot:nethraOutput}));
      clearTimeout(deadline);
      app.exit(0);
    } catch (error) {
      console.error(error.stack); clearTimeout(deadline); app.exit(1);
    }
  });
});
require("../src/main");
