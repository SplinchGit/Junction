'use strict';
// Disposable Electron check: a task-chat turn uses the task session through desktop IPC.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const source=path.resolve(__dirname,'../src');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-unified-host-'));
app.setPath('userData',profile);
global.fetch=async()=>{throw Error('HOST_SMOKE_NETWORK_DISABLED');};
require(path.join(source,'world-host-relay')).WorldHostRelay.prototype.start=function(){};
require(path.join(source,'lan-relay-lifecycle')).LanRelayLifecycle.prototype.start=async function(){throw Error('HOST_SMOKE_LAN_DISABLED');};
require(path.join(source,'local-brain-relay')).LocalBrainRelay.prototype.start=function(){};
require(path.join(source,'nethra-scheduler')).NethraScheduler.prototype.start=function(){};
const deadline=setTimeout(()=>{console.error('Unified host smoke timed out');app.exit(1);},45_000);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  try{
    while(!fs.existsSync(path.join(profile,'nethra','nethra.sqlite')))await wait(50);
    app.emit('second-instance',{},['Junction.exe']);
    let window;
    while(!(window=BrowserWindow.getAllWindows()[0]))await wait(50);
    while(window.webContents.isLoadingMainFrame())await wait(50);
    const result=await window.webContents.executeJavaScript(`(async()=>{
      const {task}=await window.junction.nethra('nethra.create',{goal:'Inspect the approved source',persistent:true});
      const reply=await window.junction.sendMessage({conversationId:task.conversationId,content:'Use the latest figures',runId:'desktop-task-turn-1'});
      const saved=await window.junction.nethra('nethra.get',{id:task.id});
      return {reply:reply.message.content,model:reply.model,status:saved.task.status,inputs:saved.task.ownerInputs};
    })()`);
    assert.match(result.reply,/saved your message/i);
    assert.equal(result.model,'Junction foreman');
    assert.equal(result.inputs.length,1);
    assert.equal(result.inputs[0].requestId,'desktop-task-turn-1');
    assert.equal(result.status,'CREATED');
    console.log(JSON.stringify({passed:true,taskChatRouted:true,inputCount:result.inputs.length,modelInvoked:false,profile}));
    clearTimeout(deadline);app.quit();
  }catch(error){console.error(error.stack);clearTimeout(deadline);app.exit(1);}
});
require(path.join(source,'main'));
