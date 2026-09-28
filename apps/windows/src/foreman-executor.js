"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const {CodexAppServer}=require('./codex-app-server');
const exec=promisify(execFile);
const forbidden=/(^|[\\/])(\.git|\.codex|\.env(?:\..*)?|credentials?|secrets?)([\\/]|$)/i;
function relative(value){return typeof value==='string'&&value.length<500&&!path.isAbsolute(value)&&!value.split(/[\\/]/).includes('..')&&!value.includes(':');}
function validateVerification(value){
 if(!Array.isArray(value)||!value.length||value.length>12)throw new Error('Provide 1–12 owner-approved verification commands');
 return value.map(v=>{if(!relative(v.cwd||'.'))throw new Error('Invalid verification directory');if(!Array.isArray(v.command)||!v.command.length||v.command.length>30||v.command.some(a=>typeof a!=='string'||a.length>2000||a.includes('\0')))throw new Error('Invalid verification argv');return {command:v.command,cwd:v.cwd||'.',timeoutMs:Math.min(300000,Math.max(1000,Number(v.timeoutMs)||120000))};});
}
function retryDeadline(value,now=Date.now()){
 const groups=value?.rateLimitsByLimitId?Object.values(value.rateLimitsByLimitId):value?.rateLimits?[value.rateLimits]:[];
 if(!groups.length)return now+300000;
 let unknown=false;const deadlines=[];
 for(const g of groups){let reached=Boolean(g.rateLimitReachedType);for(const w of [g.primary,g.secondary].filter(Boolean))if(Number(w.usedPercent)>=95||reached){reached=true;if(Number.isFinite(w.resetsAt)&&w.resetsAt*1000>now)deadlines.push(w.resetsAt*1000+60000);else unknown=true;}if(reached&&!g.primary&&!g.secondary)unknown=true;}
 return deadlines.length?Math.max(...deadlines,unknown?now+300000:0):unknown?now+300000:null;
}
function engineeringPacket(p,t){return [
 `Objective (owner approved): ${p.objective}\nJames has explicitly started this scoped implementation task and approved ordinary reversible implementation and testing. Execute it now. Do not ask for another design/process confirmation or stop at a plan; report only genuinely missing product decisions or external authority.`, `Architecture: ${p.handoff||'Inspect only the registered project. Preserve working systems.'}\nDecisions: ${JSON.stringify(p.decisions||[])}`,
 `Exact task: ${t.title}`,`Relevant files: ${JSON.stringify(t.files||[])}; work only within the supplied checkout. Baseline: ${p.verifiedSha||p.baseSha}`,
 'Constraints: small reversible changes; no network, credentials, system changes, other repositories, push, merge, or weakened tests. Never change .git, .codex, hooks, or security controls. Do not run dependency install scripts. Do not commit: the foreman verifies and commits. If authority or a product decision is missing, finish with JUNCTION_DECISION_REQUIRED: followed by the question.',
 `Previous attempts: ${JSON.stringify(t.attempts.slice(-3)).slice(-10000)}`,`Build/test failures: ${t.attempts.filter(a=>a.error).map(a=>a.error).slice(-3).join('\n')||'None recorded'}`,
 `Acceptance criteria: ${t.acceptance}`,`Requested output: implement this one task, then a concise summary of changes and remaining risks. Verification commands are fixed by the owner: ${JSON.stringify(p.verification)}`
 ].join('\n\n');}
class ForemanExecutor{
 constructor(directory,{server,runGit}={}){this.directory=directory;fs.mkdirSync(directory,{recursive:true});this.server=server||new CodexAppServer({cwd:directory});this.runGit=runGit;}
 async git(cwd,args){if(this.runGit)return this.runGit(cwd,args);const r=await exec('git',['-c','core.hooksPath=NUL','-c','core.fsmonitor=false','-c','commit.gpgSign=false','-c','protocol.file.allow=never','-C',cwd,...args],{windowsHide:true,shell:false,timeout:30000,maxBuffer:8*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}});return r.stdout;}
 async inspect(input){
  const verification=validateVerification(input.verification);
  const repoPath=fs.realpathSync(input.repoPath);const root=(await this.git(repoPath,['rev-parse','--show-toplevel'])).trim();
  if(path.resolve(root).toLowerCase()!==repoPath.toLowerCase())throw new Error('Choose a Git repository root');
  for(const check of verification)if(check.command[0]==='godot'&&process.platform==='win32'){const folder=path.join(repoPath,'pc_godot');if(fs.existsSync(folder)){const found=fs.readdirSync(folder).find(n=>/^Godot_v[0-9.]+-stable_win64\.exe$/i.test(n));if(found)check.command[0]=path.join(folder,found);}}
  return {repoPath,verification,sourceHash:await this.sourceHash(repoPath),baseSha:(await this.git(repoPath,['rev-parse','HEAD'])).trim(),baseBranch:(await this.git(repoPath,['branch','--show-current'])).trim(),dirty:Boolean((await this.git(repoPath,['status','--porcelain'])).trim())};
 }
 async sourceHash(root,includeProtected=false){const names=(await this.git(root,['ls-files','-z','--cached','--others','--exclude-standard'])).split('\0').filter(n=>n&&relative(n)&&(includeProtected||!forbidden.test(n))).sort();const hash=crypto.createHash('sha256');let total=0;for(const n of new Set(names)){const f=path.join(root,n);if(!fs.existsSync(f))continue;const stat=fs.lstatSync(f);if(!stat.isFile()||stat.isSymbolicLink()||!fs.realpathSync(f).startsWith(fs.realpathSync(root)+path.sep))throw new Error('Unsupported project path');total+=stat.size;if(stat.size>32*1024*1024||total>512*1024*1024)throw new Error('Project snapshot exceeds safety limit');hash.update(n+'\0');hash.update(fs.readFileSync(f));}return hash.digest('hex');}
 async review(p){
  if(!p.worktree||!p.verifiedSha)throw new Error('No verified candidate');
  if((await this.git(p.worktree,['status','--porcelain'])).trim())throw new Error('Candidate has unverified changes');
  const head=(await this.git(p.worktree,['rev-parse','HEAD'])).trim();if(head!==p.verifiedSha)throw new Error('Candidate moved since verification');
  const diff=await this.git(p.worktree,['diff','--binary','junction/verified',head]);
  return {headSha:head,sourceHash:p.sourceHash,diffHash:crypto.createHash('sha256').update(diff).digest('hex'),summary:await this.git(p.worktree,['diff','--stat','junction/verified',head]),patch:diff};
 }
 async applyReviewed(p){
  if(!p.reviewed)throw new Error('Review the exact candidate first');const review=await this.review(p);
  if(review.headSha!==p.reviewed.headSha||review.diffHash!==p.reviewed.diffHash)throw new Error('Candidate changed; review again');
  if((await this.git(p.repoPath,['status','--porcelain'])).trim())throw new Error('Original checkout has uncommitted work. Commit it before applying; Junction will not discard it.');
  if(await this.sourceHash(p.repoPath)!==p.sourceHash)throw new Error('Original project changed; rebase and re-verify before integration');
  if(!review.patch.trim())throw new Error('No changes to apply');
  const patch=path.join(this.directory,p.id,'reviewed.patch');fs.writeFileSync(patch,review.patch);
  await this.git(p.repoPath,['apply','--check',patch]);await this.git(p.repoPath,['apply','--index',patch]);
  // Leave the exact reviewed patch staged: owner retains control of the original branch commit.
  return {summary:'Reviewed changes applied and staged in the original checkout; inspect and commit when ready.'};
 }
 async command(cwd,command,signal,timeoutMs=120000){
  if(signal?.aborted)throw new Error('Paused');await this.server.start();
  const processId=crypto.randomUUID();const abort=()=>this.server.request('command/exec/terminate',{processId}).catch(()=>this.server.stop());
  signal?.addEventListener('abort',abort,{once:true});
  try{if(signal?.aborted)throw new Error('Paused');const result=await this.server.request('command/exec',{processId,cwd,command,timeoutMs,sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false,excludeTmpdirEnvVar:true},env:{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',OPENAI_API_KEY:null,CODEX_API_KEY:null,GH_TOKEN:null,GITHUB_TOKEN:null}},timeoutMs+10000);if(signal?.aborted)throw new Error('Paused');return result;}finally{signal?.removeEventListener('abort',abort);}
 }
 async prepare(p,task,checkpoint,signal){
  const projectDir=path.join(this.directory,p.id);fs.mkdirSync(projectDir,{recursive:true});
  const workspace=path.join(projectDir,'checkout');
  let hasBaseline=false;try{hasBaseline=Boolean((await this.git(workspace,['rev-parse','HEAD'])).trim());}catch{}
  if(!hasBaseline){
   if(p.sourceHash&&await this.sourceHash(p.repoPath)!==p.sourceHash)throw new Error('Project changed since registration; register its current baseline again');
   // Fresh independent repository: source hooks/config and its working index are never copied.
   fs.mkdirSync(workspace,{recursive:true});await this.git(workspace,['init','-b','junction/verified']);
   const names=(await this.git(p.repoPath,['ls-files','-z','--cached','--others','--exclude-standard'])).split('\0').filter(Boolean);
   let size=0;
   for(const name of new Set(names)){if(signal.aborted)throw new Error('Paused');if(!relative(name)||forbidden.test(name))continue;const source=path.join(p.repoPath,name);if(!fs.existsSync(source))continue;const stat=fs.lstatSync(source);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Project contains unsupported symlink or special file');const real=fs.realpathSync(source);if(!real.startsWith(fs.realpathSync(p.repoPath)+path.sep))throw new Error('Project path escapes repository');size+=stat.size;if(stat.size>32*1024*1024||size>512*1024*1024)throw new Error('Project snapshot exceeds safety limit');const target=path.join(workspace,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}
   await this.git(workspace,['add','--all']);await this.git(workspace,['-c','user.name=Junction','-c','user.email=junction@localhost','commit','--allow-empty','-m','Owner project working-state checkpoint']);
  }
  const branch=`junction/task-${task.id}`;
  const branches=await this.git(workspace,['branch','--list',branch]);
  if(!branches.trim())await this.git(workspace,['switch','-c',branch]);
  else await this.git(workspace,['switch',branch]);
  checkpoint({worktree:workspace,branch,baselineSha:(await this.git(workspace,['rev-parse','HEAD'])).trim(),summary:'Isolated project checkpoint ready'});
  return workspace;
 }
 async run(p,t,{signal,checkpoint}){
  let stopping;const interrupt=()=>{stopping=this.server.stop();};signal.addEventListener('abort',interrupt,{once:true});
  try { return await this.runTask(p,t,{signal,checkpoint}); } finally {signal.removeEventListener('abort',interrupt);if(stopping)await stopping;}
 }
 async runTask(p,t,{signal,checkpoint}){
  const checks=validateVerification(p.verification);
  const cwd=await this.prepare(p,t,checkpoint,signal);
  if(signal.aborted)throw new Error('Paused');
  try{
   if(t.kind!=='verify'){
    let capacity;try{capacity=retryDeadline(await this.server.readRateLimits());}catch{capacity=Date.now()+300000;}
    if(signal.aborted)throw new Error('Paused');
    if(capacity)throw Object.assign(new Error('Waiting for confirmed Codex capacity'),{retryAt:capacity});
    const previous=t.attempts.slice(0,-1).reverse().find(a=>a.threadId);
    if(previous?.threadId){const state=await this.server.request('thread/read',{threadId:previous.threadId,includeTurns:true});const active=state.thread?.turns?.some(x=>x.status==='inProgress');if(active)throw new Error('Previous Codex turn is still active; reconcile before resuming');}
    const result=await this.server.run({cwd,prompt:engineeringPacket(p,t),signal,onTurnStarted:ids=>checkpoint(ids)});
    checkpoint({summary:result.text.slice(-2000)});
    if(result.text.includes('JUNCTION_DECISION_REQUIRED:'))throw new Error(result.text.slice(result.text.indexOf('JUNCTION_DECISION_REQUIRED:')).slice(0,2000));
   }
   const changed=(await this.git(cwd,['diff','--name-only',p.verifiedSha||'junction/verified'])).split(/\r?\n/).filter(Boolean);
   const added=(await this.git(cwd,['ls-files','--others','--exclude-standard'])).split(/\r?\n/).filter(Boolean);
   if([...changed,...added].some(f=>forbidden.test(f)))throw new Error('Candidate touched a protected path');
   for(const name of [...changed,...added]){const file=path.join(cwd,name);if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('Candidate contains a symlink');}
   const verificationPaths=checks.flatMap(check=>check.command.filter(arg=>!arg.startsWith('-')).map(arg=>path.relative(cwd,path.resolve(cwd,check.cwd,arg.replace(/^res:\/\//,''))).replaceAll('\\','/')));
   const protectedChecks=changed.filter(f=>verificationPaths.includes(f)||/(^|\/)(tests?|__tests__|\.github)\//i.test(f)||/(^|\/)([^/]*[._-](test|spec)[._-][^/]*|package\.json|.*lock.*|[^/]*config[^/]*|Makefile|CMakeLists\.txt|build\.gradle[^/]*)$/i.test(f));
   if(protectedChecks.length)throw new Error(`Owner review required: candidate changed verification or dependency definitions: ${protectedChecks.join(', ')}`);
   const beforeTests=await this.sourceHash(cwd,true);
   const tests=[];
   for(const profile of checks){if(signal.aborted)throw new Error('Paused');const target=fs.realpathSync(path.join(cwd,profile.cwd));if(target!==cwd&&!target.startsWith(cwd+path.sep))throw new Error('Verification directory escapes checkout');const r=await this.command(target,profile.command,signal,profile.timeoutMs);const evidence={command:profile.command,exitCode:r.exitCode,output:(r.stdout+'\n'+r.stderr).slice(-12000)};tests.push(evidence);checkpoint({tests,summary:`Verification ${tests.length}/${checks.length}: exit ${r.exitCode}`});if(r.exitCode!==0)throw new Error(`Verification failed: ${JSON.stringify(profile.command)}\n${evidence.output}`);}
   if(signal.aborted)throw new Error('Paused');
   const afterTests=await this.sourceHash(cwd,true);
   if(beforeTests!==afterTests)throw new Error('Verification changed project source or created untracked files; inspect candidate before retrying');
   const finalNames=[...(await this.git(cwd,['diff','--name-only',p.verifiedSha||'junction/verified'])).split(/\r?\n/),...(await this.git(cwd,['ls-files','--others','--exclude-standard'])).split(/\r?\n/)].filter(Boolean);if(finalNames.some(f=>forbidden.test(f)))throw new Error('Verification created a protected file');
   await this.git(cwd,['add','--all']);
   if((await this.git(cwd,['diff','--cached','--name-only'])).trim())await this.git(cwd,['-c','user.name=Junction','-c','user.email=junction@localhost','commit','-m',`Verified task ${t.id}: ${t.title}`]);
   const headSha=(await this.git(cwd,['rev-parse','HEAD'])).trim();
   checkpoint({headSha,tests,summary:'Candidate committed after verification'});
   return {headSha,tests,summary:`${t.title}: ${checks.length} verification commands passed. Commit ${headSha.slice(0,12)}.`,worktree:cwd,branch:`junction/task-${t.id}`};
  }catch(error){
   if(signal.aborted)throw error;
   if(error.retryAt)throw error;
   if(/rate.?limit|quota|usage.?limit|capacity/i.test(error.message)){let at;try{at=retryDeadline(await this.server.readRateLimits());}catch{}error.retryAt=at||Date.now()+300000;}
   else if(/timed out|connection|transport|502|503|504/i.test(error.message))error.retryAt=Date.now()+Math.min(1800000,30000*2**Math.min(t.attempts.length-1,6))*(1+Math.random()*.2);
   throw error;
  }
 }
 stop(){return this.server.stop();}
}
module.exports={ForemanExecutor,retryDeadline,engineeringPacket,validateVerification};
