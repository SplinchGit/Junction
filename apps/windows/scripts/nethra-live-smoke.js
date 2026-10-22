'use strict';
// Disposable real-model check. Does not read owner files or perform external writes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {NethraStore}=require('../src/nethra-store');
const {NethraScheduler}=require('../src/nethra-scheduler');
const {NethraRunner}=require('../src/nethra-runner');
const {LocalAgentRuntime}=require('../src/local-agent-runtime');
async function main(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-live-'));const fixture=path.join(directory,'facts.txt');fs.writeFileSync(fixture,'Acceptance witness: amber junction 47. The report must include that exact phrase.');
 const runtime=new LocalAgentRuntime(),store=new NethraStore(path.join(directory,'state'));
 const runner=new NethraRunner({store,runtime});
 const task=store.create({goal:`Read the approved facts file at ${fixture}. Create report.md in your workspace with the exact acceptance witness from that file. Use update_plan to mark steps completed after successful tools. Then finish_objective. This is a one-cycle acceptance check; do not schedule a future wake or ask questions.`,successCriteria:'report.md contains amber junction 47 and objective is complete.',readRoots:[directory],persistent:false});
 const scheduler=new NethraScheduler({store,execute:(t,options)=>runner.execute(t,options)}),started=Date.now();await scheduler.tick();
 const saved=store.get(task.id),report=path.join(task.workspace,'report.md');
 const result={live:true,model:'qwen3:30b',durationMs:Date.now()-started,status:saved.status,summary:saved.summary,tools:saved.evidence.map(e=>e.tool),reportExists:fs.existsSync(report),witness:fs.existsSync(report)&&fs.readFileSync(report,'utf8').includes('amber junction 47'),directory,events:store.events(task.id).map(e=>({kind:e.kind,at:e.at}))};
 result.success=result.status==='COMPLETED'&&result.witness&&result.tools.includes('read_file')&&result.tools.includes('write_draft');
 fs.writeFileSync(path.resolve(__dirname,'../../../artifacts/nethra-30b-live-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));store.close();if(!result.success)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
