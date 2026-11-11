'use strict';
// Actual renderer, preload, IPC and SQLite; isolated profile and no network/inference.
const {app}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'junction-p0-ui-'));
app.setPath('userData',directory);
global.fetch=async()=>{throw new Error('P0_UI_NETWORK_DISABLED');};
require('../src/world-host-relay').WorldHostRelay.prototype.start=function(){};
require('../src/lan-relay-lifecycle').LanRelayLifecycle.prototype.start=async function(){throw new Error('P0_UI_LAN_DISABLED');};
require('../src/local-brain-relay').LocalBrainRelay.prototype.start=function(){};
require('../src/nethra-scheduler').NethraScheduler.prototype.start=function(){};
require('../src/codex-client').getCodexStatus=async()=>({available:false});
const deadline=setTimeout(()=>{console.error('P0 UI timeout');app.exit(1);},60000);
app.on('browser-window-created',(_event,window)=>{
  window.webContents.once('did-finish-load',async()=>{
    try{
      const task=await window.webContents.executeJavaScript(`(async()=>{
        const {task}=await window.junction.nethra('nethra.create',{goal:'P0 deletion fixture: funding research',persistent:false});
        showView('tasks');document.querySelector('.nav[data-view="tasks"]').click();
        return task;
      })()`);
      const inspection=await window.webContents.executeJavaScript(`(async()=>{
        const wait=ms=>new Promise(r=>setTimeout(r,ms));
        for(let i=0;i<200;i++){
          const detail=document.querySelector('.task-detail');
          const diagnostics=[...(detail?.querySelectorAll('summary')||[])].find(e=>e.textContent==='Diagnostics');
          if(diagnostics){
            const remove=[...detail.querySelector('.task-head').querySelectorAll('button')].find(e=>e.textContent==='Delete');
            const progress=detail.querySelector('.task-progress-overview');
            return {deleteVisible:!!remove&&remove.getBoundingClientRect().height>0&&remove.getBoundingClientRect().top<innerHeight,
              aboveProgress:!!remove&&remove.getBoundingClientRect().top<progress.getBoundingClientRect().top,
              diagnosticsClosed:!diagnostics.parentElement.open};
          }
          await wait(25);
        }
        throw new Error('Task detail did not render');
      })()`);
      assert.deepEqual(inspection,{deleteVisible:true,aboveProgress:true,diagnosticsClosed:true});
      const screenshot=path.join(__dirname,'../test-results/p0-delete-visible.png');
      fs.writeFileSync(screenshot,(await window.webContents.capturePage()).toPNG());
      const result=await window.webContents.executeJavaScript(`(async()=>{
        let confirms=0;window.confirm=()=>{confirms++;return true;};
        const detail=document.querySelector('.task-detail');
        [...detail.querySelector('.task-head').querySelectorAll('button')].find(e=>e.textContent==='Delete').click();
        for(let i=0;i<200;i++){
          const list=await window.junction.nethra('nethra.list');
          if(!list.objectives.some(item=>item.id===${JSON.stringify(task.id)}))return {deleted:true,confirms};
          await new Promise(r=>setTimeout(r,25));
        }
        throw new Error('Task did not delete');
      })()`);
      assert.deepEqual(result,{deleted:true,confirms:1});
      const {NethraStore}=require('../src/nethra-store');
      const store=new NethraStore(path.join(directory,'nethra'));
      assert.equal(store.list().length,0);assert.equal(store.deletion(task.id).deleted,true);store.close();
      const retained=await window.webContents.executeJavaScript(`window.junction.conversations()`);
      assert.ok(retained.some(item=>item.id===task.conversationId));
      console.log(JSON.stringify({passed:true,...inspection,...result,conversationRetained:true,reopenedStoreStillDeleted:true,screenshot}));
      clearTimeout(deadline);app.exit(0);
    }catch(error){console.error(error.stack);clearTimeout(deadline);app.exit(1);}
  });
});
require('../src/main');
