'use strict';
// Disposable real-model check of an ongoing milestone and restart. No owner data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {NethraStore}=require('../src/nethra-store');
const {NethraScheduler}=require('../src/nethra-scheduler');
const {NethraRunner}=require('../src/nethra-runner');
const {LocalAgentRuntime}=require('../src/local-agent-runtime');

async function main(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-live-monitor-'));
  const fixture=path.join(directory,'facts.txt');
  fs.writeFileSync(fixture,'The verified monitoring marker is violet lantern 83.\n');
  const stateDirectory=path.join(directory,'state'),runtime=new LocalAgentRuntime();
  let store=new NethraStore(stateDirectory);
  const task=store.create({goal:`Keep monitoring this approved facts file for changes. First read ${fixture}, save a brief plan with update_plan, record the verified marker, mark the plan steps complete, and use finish_objective to finish this first monitoring milestone.`,successCriteria:'The first milestone cites the exact verified marker from the facts file.',readRoots:[directory],mode:'ONGOING',autonomy:'BALANCED',persistent:true});
  const started=Date.now();let modelCalls=0;
  const originalChat=runtime.chat.bind(runtime);runtime.chat=(...args)=>{modelCalls++;return originalChat(...args);};
  const runner=new NethraRunner({store,runtime});
  await new NethraScheduler({store,execute:(current,options)=>runner.execute(current,options)}).tick();
  const first=store.get(task.id),milestones=store.milestoneEvents(task.id);
  store.close();store=new NethraStore(stateDirectory);
  const reopened=store.get(task.id),callsBefore=modelCalls;
  await new NethraScheduler({store,execute:()=>{modelCalls++;throw Error('Woke before checkpoint');}}).tick();
  const result={live:true,model:'qwen3:30b',durationMs:Date.now()-started,firstStatus:first.status,reopenedStatus:reopened.status,nextWakeAt:reopened.nextWakeAt,milestoneCount:milestones.length,evidenceTools:first.evidence.map(item=>item.tool),modelCalls,earlyWakeModelCalls:modelCalls-callsBefore,markerVerified:first.summary.includes('violet lantern 83')};
  result.success=result.firstStatus==='SLEEPING'&&result.reopenedStatus==='SLEEPING'&&result.nextWakeAt>Date.now()&&result.milestoneCount===1&&result.evidenceTools.includes('read_file')&&result.markerVerified&&result.earlyWakeModelCalls===0;
  console.log(JSON.stringify(result));store.close();if(!result.success)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
