"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const {CodexAppServer}=require('./codex-app-server');
const {COORDINATION_CODEX_MODEL}=require('./codex-client');
const {getClaudeStatus,sendClaudeConsult}=require('./claude-client');
const exec=promisify(execFile);
const forbidden=/(^|[\\/])(\.git|\.codex|\.env(?:\..*)?|credentials?|secrets?)([\\/]|$)/i;
function relative(value){return typeof value==='string'&&value.length<500&&!path.isAbsolute(value)&&!value.split(/[\\/]/).includes('..')&&!value.includes(':');}
function validateVerification(value){
 if(!Array.isArray(value)||!value.length||value.length>12)throw new Error('Provide 1–12 owner-approved verification commands');
 return value.map(v=>{if(!relative(v.cwd||'.'))throw new Error('Invalid verification directory');if(!Array.isArray(v.command)||!v.command.length||v.command.length>30||v.command.some(a=>typeof a!=='string'||a.length>2000||a.includes('\0')))throw new Error('Invalid verification argv');const protectedPaths=Array.isArray(v.protectedPaths)?v.protectedPaths:[];if(protectedPaths.length>100||protectedPaths.some(item=>!relative(item)))throw new Error('Invalid protected verification path');return {command:v.command,cwd:v.cwd||'.',timeoutMs:Math.min(300000,Math.max(1000,Number(v.timeoutMs)||120000)),protectedPaths};});
}
function walkNames(root){const names=[];let total=0;function visit(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(['.git','.codex','node_modules','build','dist','.npm-cache','test-results'].includes(entry.name))continue;const full=path.join(folder,entry.name),name=path.relative(root,full).replaceAll('\\','/');if(!relative(name)||forbidden.test(name))continue;if(entry.isSymbolicLink())throw new Error('Project contains an unsupported symlink');if(entry.isDirectory())visit(full);else if(entry.isFile()){const size=fs.statSync(full).size;total+=size;if(size>32*1024*1024||total>512*1024*1024)throw new Error('Project snapshot exceeds safety limit');names.push(name);}}}visit(root);return names.sort();}
function detectedVerification(root){
 if(fs.existsSync(path.join(root,'package.json'))){try{const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(p.scripts?.test)return [{command:[process.platform==='win32'?'npm.cmd':'npm','test'],cwd:'.',protectedPaths:['test','tests','__tests__','package.json','package-lock.json']}];}catch{}}
 if(fs.existsSync(path.join(root,'project.godot')))return [{command:['godot','--headless','--path','.','--editor','--quit'],cwd:'.',protectedPaths:['tests','project.godot']}];
 if(fs.readdirSync(root).some(name=>name.endsWith('.sln')))return [{command:['dotnet','test','--no-restore'],cwd:'.',protectedPaths:[]}];
 return [{command:['git','diff','--check','junction/verified'],cwd:'.',protectedPaths:[]}];
}
function retryDeadline(value,now=Date.now()){
 const groups=value?.rateLimitsByLimitId?Object.values(value.rateLimitsByLimitId):value?.rateLimits?[value.rateLimits]:[];
 if(!groups.some(g=>g.primary||g.secondary||g.rateLimitReachedType))return now+300000;
 let unknown=false;const deadlines=[];
 for(const g of groups){const reached=Boolean(g.rateLimitReachedType);for(const w of [g.primary,g.secondary].filter(Boolean)){if(!Number.isFinite(w.usedPercent)){unknown=true;continue;}const reset=Number.isFinite(w.resetsAt)?w.resetsAt*1000:null;if(w.usedPercent>=95||reached){if(reset!==null&&reset+60000>now)deadlines.push(reset+60000);else unknown=true;}else if(reset!==null&&reset<=now)unknown=true;}if(reached&&!g.primary&&!g.secondary)unknown=true;}
 return deadlines.length?Math.max(...deadlines,unknown?now+300000:0):unknown?now+300000:null;
}
const CLAUDE_UNKNOWN_LIMIT_RECHECK_MS=30*60*1000;
function claudeRetryDeadline(snapshot){
 const resets=(snapshot?.windows||[]).filter(window=>window.usedPercent>=95).map(window=>window.resetsAt);
 if(snapshot?.limitReached)resets.push(snapshot.limitResetsAt);
 const deadline=Math.max(...resets.filter(Number.isFinite).map(reset=>reset+60000));
 if(deadline>(snapshot?.checkedAt||0))return deadline;
 return snapshot?.limitReached&&Number.isFinite(snapshot.checkedAt)?snapshot.checkedAt+CLAUDE_UNKNOWN_LIMIT_RECHECK_MS:null;
}
function protectedVerification(p,cwd,checks){
 const verificationPaths=checks.flatMap(check=>check.command.filter(arg=>!arg.startsWith('-')).map(arg=>path.relative(cwd,path.resolve(cwd,check.cwd,arg.replace(/^res:\/\//,''))).replaceAll('\\','/')));
 const declared=p.verificationProtected||[];const explicitlyProtected=f=>declared.some(item=>f===item||f.startsWith(`${item}/`));
 return f=>explicitlyProtected(f)||verificationPaths.includes(f)||/(^|\/)(tests?|__tests__|\.github)\//i.test(f)||/(^|\/)([^/]*[._-](test|spec)[._-][^/]*|package\.json|.*lock.*|[^/]*config[^/]*|Makefile|CMakeLists\.txt|build\.gradle[^/]*)$/i.test(f);
}
function engineeringPacket(p,t,{patchOnly=false}={}){return [
 ...(patchOnly?['PATCH AUTHORING ONLY: Your sole deliverable is a raw unified Git diff. Inspect files read-only as needed. Do not edit files, run verification commands, use GUI automation, or work around the read-only sandbox. Foreman validates and applies your diff and runs the fixed verification commands. Treat implementation below as authoring this patch, not changing files yourself. The owner authorizes this patch-only workflow without additional skill/process confirmations.']:[]),
 `Objective (owner approved): ${p.objective}\nJames has explicitly started this scoped implementation task and approved ordinary reversible implementation and testing. Execute it now. Do not ask for another design/process confirmation or stop at a plan; report only genuinely missing product decisions or external authority.`, `Architecture: ${p.handoff||'Inspect only the registered project. Preserve working systems.'}\nDecisions: ${JSON.stringify(p.decisions||[])}`,
 `Exact task: ${t.title}`,`Relevant files: ${JSON.stringify(t.files||[])}; work only within the supplied checkout. Baseline: ${p.verifiedSha||p.baseSha}`,
 ...(patchOnly?[`Protected files: Foreman rejects the whole patch if it touches any test file or folder (test/, tests/, __tests__/, *.test.*, *.spec.*), package.json, lockfiles, config or build files, or .github.${p.scopeFile?` Only ${p.scopeFile} may change.`:''} Change production source only; the owner's fixed verification commands test it.`]:[]),
 'Constraints: small reversible changes; no network, credentials, system changes, other repositories, push, merge, or weakened tests. Never change .git, .codex, hooks, or security controls. Do not run dependency install scripts. Do not commit: verification records a detached checkpoint; canonical commits remain with the authorised engineering session. If authority or a product decision is missing, finish with JUNCTION_DECISION_REQUIRED: followed by the question.',
 `Previous attempts: ${JSON.stringify(t.attempts.slice(-3)).slice(-10000)}`,`Build/test failures: ${t.attempts.filter(a=>a.error).map(a=>a.error).slice(-3).join('\n')||'None recorded'}`,
 ...(patchOnly&&t.attempts.some(a=>/patch does not apply|patch failed:/i.test(a.error||''))?['The previous patch did not match the current source. Read the exact live file contents again and generate a fresh diff with unchanged context copied verbatim. Use the current source as the baseline.']:[]),
 `Acceptance criteria: ${t.acceptance}`,patchOnly?'Requested output: return the raw unified Git diff, starting with diff --git. Foreman runs verification.':`Requested output: implement this one task, then a concise summary of changes and remaining risks. Verification commands are fixed by the owner: ${JSON.stringify(p.verification)}`
 ].join('\n\n');}
class ForemanExecutor{
 constructor(directory,{server,runGit,advisorLimits,runClaude=sendClaudeConsult,claudeStatus=getClaudeStatus,mayWrite=()=>true,processAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}}={}){this.directory=directory;fs.mkdirSync(directory,{recursive:true});this.server=server||new CodexAppServer({cwd:directory});Object.assign(this,{runGit,advisorLimits,runClaude,claudeStatus,mayWrite,processAlive});}
 async git(cwd,args){if(this.runGit)return this.runGit(cwd,args);const r=await exec('git',['-c','core.hooksPath=NUL','-c','core.fsmonitor=false','-c','commit.gpgSign=false','-c','protocol.file.allow=never','-C',cwd,...args],{windowsHide:true,shell:false,timeout:30000,maxBuffer:8*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}});return r.stdout;}
 async inspect(input){
  let requested=fs.realpathSync(input.repoPath),scopeFile=null;if(fs.statSync(requested).isFile()){scopeFile=path.basename(requested);requested=path.dirname(requested);}if(!fs.statSync(requested).isDirectory())throw new Error('Work scope must be a file or folder');
  let root,scopeKind='folder';try{root=(await this.git(requested,['rev-parse','--show-toplevel'])).trim();if(path.resolve(root).toLowerCase()!==requested.toLowerCase())root=requested;else scopeKind='git';}catch{root=requested;}
  const repoPath=fs.realpathSync(root);const verification=validateVerification(input.verification?.length?input.verification:detectedVerification(repoPath));
  for(const check of verification)if(check.command[0]==='godot'&&process.platform==='win32'){const folder=path.join(repoPath,'pc_godot');if(fs.existsSync(folder)){const found=fs.readdirSync(folder).find(n=>/^Godot_v[0-9.]+-stable_win64\.exe$/i.test(n));if(found)check.command[0]=path.join(folder,found);}}
  const verificationProtected=[...new Set(verification.flatMap(check=>check.protectedPaths.map(item=>path.join(check.cwd,item).replaceAll('\\','/').replace(/^\.\//,''))))];
  let baseSha='local-folder',baseBranch='',dirty=false;if(scopeKind==='git'){baseSha=(await this.git(repoPath,['rev-parse','HEAD'])).trim();baseBranch=(await this.git(repoPath,['branch','--show-current'])).trim();dirty=Boolean((await this.git(repoPath,['status','--porcelain'])).trim());}
  return {repoPath,scopeFile,scopeKind,verification,verificationProtected,sourceHash:await this.sourceHash(repoPath,false,scopeKind),baseSha,baseBranch,dirty};
 }
 async names(root,scopeKind){if(scopeKind==='folder')return walkNames(root);try{return (await this.git(root,['ls-files','-z','--cached','--others','--exclude-standard'])).split('\0').filter(Boolean).sort();}catch{return walkNames(root);}}
 async sourceHash(root,includeProtected=false,scopeKind=null){const names=(await this.names(root,scopeKind)).filter(n=>n&&relative(n)&&(includeProtected||!forbidden.test(n)));const hash=crypto.createHash('sha256');let total=0;for(const n of new Set(names)){const f=path.join(root,n);if(!fs.existsSync(f))continue;const stat=fs.lstatSync(f);if(!stat.isFile()||stat.isSymbolicLink()||!fs.realpathSync(f).startsWith(fs.realpathSync(root)+path.sep))throw new Error('Unsupported project path');total+=stat.size;if(stat.size>32*1024*1024||total>512*1024*1024)throw new Error('Project snapshot exceeds safety limit');hash.update(n+'\0');hash.update(fs.readFileSync(f));}return hash.digest('hex');}
 async review(p){
  if(!p.worktree||!p.verifiedSha)throw new Error('No verified candidate');
  if(p.sharedCheckout&&(!p.sharedSourceHash||await this.sourceHash(p.repoPath,false,p.scopeKind)!==p.sharedSourceHash))throw new Error('Shared checkout changed since verification; verify again before review');
  if((await this.git(p.worktree,['status','--porcelain'])).trim())throw new Error('Candidate has unverified changes');
  const head=(await this.git(p.worktree,['rev-parse','HEAD'])).trim();if(head!==p.verifiedSha)throw new Error('Candidate moved since verification');
  const diff=await this.git(p.worktree,['diff','--binary','junction/verified',head]);
  return {headSha:head,sourceHash:p.sourceHash,diffHash:crypto.createHash('sha256').update(diff).digest('hex'),summary:await this.git(p.worktree,['diff','--stat','junction/verified',head]),patch:diff};
 }
 async promoteVerified(p,result){
  const workspace=p.worktree||result.worktree,head=result.headSha,base=p.verifiedSha||'junction/verified';if(!workspace||!head)throw new Error('Verified candidate is incomplete');
  if(await this.sourceHash(p.repoPath,false,p.scopeKind)!==p.sourceHash)throw new Error('The original work scope changed during verification; the verified candidate was preserved and nothing was overwritten');
  const names=(await this.git(workspace,['diff','--name-only','-z',base,head])).split('\0').filter(Boolean);if(names.some(name=>!relative(name)||forbidden.test(name)))throw new Error('Verified candidate contains an unsafe path');if(p.scopeFile&&names.some(name=>name!==p.scopeFile))throw new Error('Verified candidate changed files outside the owner-named file scope');
  const backup=path.join(this.directory,p.id,'backups',String(Date.now()));fs.mkdirSync(backup,{recursive:true});const changes=[];
  for(const name of names){const source=path.join(workspace,name),target=path.join(p.repoPath,name),existed=fs.existsSync(target);if(existed){const saved=path.join(backup,name);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(target,saved);}changes.push({name,source,target,existed,deleted:!fs.existsSync(source)});}
  try{for(const change of changes){if(change.deleted){if(fs.existsSync(change.target))fs.unlinkSync(change.target);continue;}const stat=fs.lstatSync(change.source);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Verified candidate contains an unsupported file');fs.mkdirSync(path.dirname(change.target),{recursive:true});const temp=`${change.target}.junction-${crypto.randomUUID()}.tmp`;fs.copyFileSync(change.source,temp);fs.renameSync(temp,change.target);}}
  catch(error){for(const change of changes.reverse()){try{if(change.existed){fs.mkdirSync(path.dirname(change.target),{recursive:true});fs.copyFileSync(path.join(backup,change.name),change.target);}else if(fs.existsSync(change.target))fs.unlinkSync(change.target);}catch{}}throw error;}
  fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({project:p.id,base,head,files:changes.map(({name,existed,deleted})=>({name,existed,deleted}))},null,2));
  return {backup,sourceHash:await this.sourceHash(p.repoPath,false,p.scopeKind),files:names};
 }
 async applyReviewed(p){
  if(!p.reviewed)throw new Error('Review the exact candidate first');const review=await this.review(p);
  if(review.headSha!==p.reviewed.headSha||review.diffHash!==p.reviewed.diffHash)throw new Error('Candidate changed; review again');
  if(p.sharedCheckout)return {summary:'Verified shared-checkout changes reviewed. No files staged or committed; the authorised engineer owns integration.'};
  if((await this.git(p.repoPath,['status','--porcelain'])).trim())throw new Error('Original checkout has uncommitted work. Commit it before applying; Junction will not discard it.');
  if(await this.sourceHash(p.repoPath,false,p.scopeKind)!==p.sourceHash)throw new Error('Original project changed; rebase and re-verify before integration');
  if(!review.patch.trim())throw new Error('No changes to apply');
  const patch=path.join(this.directory,p.id,'reviewed.patch');fs.writeFileSync(patch,review.patch);
  const gitRoot=(await this.git(p.repoPath,['rev-parse','--show-toplevel'])).trim();
  const prefix=path.relative(gitRoot,p.repoPath).replaceAll('\\','/');
  if(!relative(prefix||'.'))throw new Error('Original project is outside its Git checkout');
  const directoryArg=prefix? [`--directory=${prefix}`]:[];
  await this.git(gitRoot,['apply','--check',...directoryArg,patch]);await this.git(gitRoot,['apply','--index',...directoryArg,patch]);
  // Leave the exact reviewed patch staged: owner retains control of the original branch commit.
  return {summary:'Reviewed changes applied and staged in the original checkout; inspect and commit when ready.'};
 }
 async command(cwd,command,signal,timeoutMs=120000,verificationEnv={}){
  if(signal?.aborted)throw new Error('Paused');await this.server.start();
  const processId=crypto.randomUUID();const abort=()=>this.server.request('command/exec/terminate',{processId}).catch(()=>this.server.stop());
  signal?.addEventListener('abort',abort,{once:true});
  try{if(signal?.aborted)throw new Error('Paused');const result=await this.server.request('command/exec',{processId,cwd,command,timeoutMs,sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false,excludeTmpdirEnvVar:true},env:{...verificationEnv,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',OPENAI_API_KEY:null,CODEX_API_KEY:null,GH_TOKEN:null,GITHUB_TOKEN:null}},timeoutMs+10000);if(signal?.aborted)throw new Error('Paused');return result;}finally{signal?.removeEventListener('abort',abort);}
 }
 async prepare(p,task,checkpoint,signal){
  const projectDir=path.join(this.directory,p.id);fs.mkdirSync(projectDir,{recursive:true});
  const workspace=path.join(projectDir,'checkout');
  let hasBaseline=false;try{hasBaseline=Boolean((await this.git(workspace,['rev-parse','HEAD'])).trim());}catch{}
  if(!hasBaseline){
   if(p.sourceHash&&await this.sourceHash(p.repoPath,false,p.scopeKind)!==p.sourceHash)throw new Error('Project changed since this work was requested; send the instruction again to use its current state');
   // Fresh independent repository: source hooks/config and its working index are never copied.
   fs.mkdirSync(workspace,{recursive:true});await this.git(workspace,['init','--initial-branch=main']);
   const names=await this.names(p.repoPath,p.scopeKind);
   let size=0;
   for(const name of new Set(names)){if(signal.aborted)throw new Error('Paused');if(!relative(name)||forbidden.test(name))continue;const source=path.join(p.repoPath,name);if(!fs.existsSync(source))continue;const stat=fs.lstatSync(source);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Project contains unsupported symlink or special file');const real=fs.realpathSync(source);if(!real.startsWith(fs.realpathSync(p.repoPath)+path.sep))throw new Error('Project path escapes repository');size+=stat.size;if(stat.size>32*1024*1024||size>512*1024*1024)throw new Error('Project snapshot exceeds safety limit');const target=path.join(workspace,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}
   await this.git(workspace,['add','--all']);
   const tree=(await this.git(workspace,['write-tree'])).trim();
   const baseline=(await this.git(workspace,['-c','user.name=Junction','-c','user.email=junction@localhost','commit-tree',tree,'-m','Owner project working-state checkpoint'])).trim();
   await this.git(workspace,['update-ref','refs/tags/junction/verified',baseline]);
   await this.git(workspace,['switch','--detach',baseline]);
  }
  const activeBranch=(await this.git(workspace,['branch','--show-current'])).trim();
  if(activeBranch)await this.git(workspace,['switch','--detach']);
  checkpoint({worktree:workspace,branch:null,baselineSha:(await this.git(workspace,['rev-parse','HEAD'])).trim(),summary:'Isolated project checkpoint ready'});
  return workspace;
 }
 async handoff(cwd,p,t,summary){
  const base=p.verifiedSha||'junction/verified';
  const changed=(await this.workingGit(p,cwd,['diff','--name-only',base])).trim().split(/\r?\n/).filter(Boolean);
  const untracked=(await this.git(cwd,['ls-files','--others','--exclude-standard'])).trim().split(/\r?\n/).filter(Boolean);
  if([...changed,...untracked].some(file=>!relative(file)||forbidden.test(file)))throw new Error('Handoff contains a protected path');
  return {base,head:(await this.workingGit(p,cwd,['rev-parse','HEAD'])).trim(),sourceHash:await this.sourceHash(cwd,true),
    changed,untracked,summary:String(summary).slice(0,2000),verification:'Pending on the candidate'};
 }
 workingGit(p,cwd,args){return p.sharedCheckout?this.git(p.worktree,[`--work-tree=${cwd}`,...args]):this.git(cwd,args);}
 async applySharedPatch(p,cwd,patch,checks,before,signal){
  if(await this.sourceHash(cwd,true)!==before)throw new Error('Shared source changed while the provider was reasoning; reconcile before applying');
  // Providers see the whole repository, so a patch may name files from the Git root. Accept that form
  // only when every file lies inside the approved scope folder, and rewrite it relative to that folder.
  const prefix=path.relative((await this.git(cwd,['rev-parse','--show-toplevel'])).trim(),cwd).replaceAll('\\','/');
  const named=[...String(patch).matchAll(/^(?:\+\+\+ b|--- a)\/(.+?)\r?$/gm)].map(m=>m[1].trimEnd());
  if(prefix&&named.length&&named.every(name=>name.startsWith(prefix+'/'))){
   const strip=name=>name.startsWith(prefix+'/')?name.slice(prefix.length+1):name;
   patch=String(patch).replace(/^(diff --git a\/|--- a\/|\+\+\+ b\/)(\S+)(?: b\/(\S+))?/gm,(line,head,first,second)=>head+strip(first)+(second?' b/'+strip(second):''));
  }
  const files=[...String(patch).matchAll(/^\+\+\+ b\/(.+)\r?$/gm)].map(m=>m[1].trimEnd());
  const protectedPath=protectedVerification(p,cwd,checks);
  // Name the offending relative paths (never contents) so the owner and both engineers can see what to trim.
  const outside=files.filter(name=>!relative(name)||forbidden.test(name)||protectedPath(name)||(p.scopeFile&&name!==p.scopeFile));
  if(!files.length||outside.length)throw new Error('Owner review required: patch exceeds approved source scope or changes protected verification'+(outside.length?` (${outside.slice(0,3).map(name=>name.replace(/[^\w.\-\/ ]/g,'?').slice(0,120)).join(', ')}${outside.length>3?`, and ${outside.length-3} more`:''})`:''));
  const sources=await this.claudeSources(cwd,{files},{changed:[],untracked:[]},protectedPath,{maxBytes:512*1024});
  if(files.some(name=>!Object.hasOwn(sources,name)))throw new Error('Patch requires additional file scope; no source changed');
  await this.applyClaudePatch(cwd,patch,sources,signal,()=>{if(!this.mayWrite(p))throw new Error('Owner direction or permission changed; no patch applied');});
 }
 async acquireWriter(p){
  const root=(await this.git(p.repoPath,['rev-parse','--show-toplevel'])).trim();
  if((await this.git(root,['branch','--show-current'])).trim()!=='main')throw new Error('Shared engineering requires the canonical main checkout');
  const common=(await this.git(root,['rev-parse','--git-common-dir'])).trim();
  const file=path.resolve(root,common,'nethra-writer.lock');
  const identity={pid:process.pid,project:p.id,nonce:crypto.randomUUID(),at:Date.now()};
  const claim=()=>fs.writeFileSync(file,JSON.stringify(identity),{flag:'wx'});
  try{claim();}catch(error){
   if(error.code!=='EEXIST')throw error;
   const held=new Error('The shared checkout has a writer lock. Wait for its provider to stop; reconcile a crashed writer before removing its lock.');
   const holder=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
   // Shared patches are applied by the Foreman host itself, so a lock recorded by a host
   // process that has exited has no writer. Any other lock stays until a person reconciles it.
   const crashed=lock=>Number.isSafeInteger(lock?.pid)&&lock.pid>0&&lock.pid!==process.pid&&typeof lock.nonce==='string'&&!this.processAlive(lock.pid);
   const stale=holder();if(!crashed(stale))throw held;
   const reclaim=`${file}.reclaim`;
   try{fs.writeFileSync(reclaim,JSON.stringify(identity),{flag:'wx'});}catch{throw held;}
   try{
    const current=holder();if(current?.nonce!==stale.nonce||!crashed(current))throw held;
    fs.unlinkSync(file);claim();
   }catch(inner){if(inner===held||inner.code==='EEXIST')throw held;throw inner;}finally{fs.unlinkSync(reclaim);}
  }
  return ()=>{if(JSON.parse(fs.readFileSync(file,'utf8')).nonce!==identity.nonce)throw new Error('Shared checkout writer ownership changed');fs.unlinkSync(file);};
 }
 async claudeSources(cwd,t,handoff,protectedPath,{maxBytes=96000}={}){
  const files=[...new Set([...(t.files||[]),...handoff.changed,...handoff.untracked])];
  const sources=Object.create(null);let bytes=0;
  for(const name of files){
   if(!relative(name)||forbidden.test(name)||protectedPath(name)||/(^|\/)(tests?|__tests__|\.github)\/|(^|\/)(package\.json|[^/]*lock[^/]*|[^/]*config[^/]*|AGENTS\.md)$/i.test(name))continue;
   const file=path.join(cwd,name);
   if(!fs.existsSync(file))continue;
   const stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.isSymbolicLink()||!fs.realpathSync(file).startsWith(cwd+path.sep)||stat.size>48000||bytes+stat.size>maxBytes)continue;
   const buffer=fs.readFileSync(file);if(buffer.includes(0))continue;
   sources[name]=buffer.toString('utf8');bytes+=stat.size;
  }
  return sources;
 }
 async applyClaudePatch(cwd,patch,sources,signal,authorize=()=>{}){
  const output=patch.trimStart().replace(/[\r\n]+$/,'');
  const fenced=/^```(?:diff|patch)?\r?\n([\s\S]*?)\r?\n```[\t ]*$/i.exec(output);
  let clean=(fenced?.[1]||output)+'\n';
  if(!clean.startsWith('diff --git ')||Buffer.byteLength(clean)>96000||/^(?:old mode|new mode|new file mode|deleted file mode|rename |copy |GIT binary patch)/m.test(clean))throw new Error('Claude did not return a scoped textual patch');
  const directory=fs.mkdtempSync(path.join(this.directory,'claude-patch-'));
  const file=path.join(directory,'candidate.diff');
  try{
   const root=(await this.git(cwd,['rev-parse','--show-toplevel'])).trim();
   const prefix=path.relative(root,cwd).replaceAll('\\','/');
   if(!relative(prefix||'.'))throw new Error('Patch scope escapes the canonical checkout');
   const directoryArg=prefix?[`--directory=${prefix}`]:[];
   // Diff metadata uses LF; only hunk payloads follow the supplied source EOL.
   let crlf=false,inHunk=false;
   clean=clean.split('\n').map(line=>{
    line=line.replace(/\r$/,'');
    if(line.startsWith('diff --git ')){inHunk=false;crlf=false;}
    if(line.startsWith('+++ b/')){const source=sources[line.slice(6)];crlf=typeof source==='string'&&source.includes('\r\n')&&!/(?<!\r)\n/.test(source);}
    if(line.startsWith('@@ ')){inHunk=true;return line;}
    return crlf&&inHunk&&/^[ +\-]/.test(line)?line+'\r':line;
   }).join('\n');
   fs.writeFileSync(file,clean,{flag:'wx'});
   const stats=(await this.git(root,['apply','--numstat','-z',...directoryArg,'--',file])).split('\0').filter(Boolean);
   if(!stats.length||stats.some(line=>{const match=/^\d+\t\d+\t([^\r\n\t]+)$/.exec(line);const name=match?.[1];return !name||(prefix&&!name.startsWith(prefix+'/'))||!Object.hasOwn(sources,prefix?name.slice(prefix.length+1):name);}))throw new Error('Claude patch exceeds the handoff file scope');
   await this.git(root,['apply','--check',...directoryArg,'--',file]);
   signal?.throwIfAborted();
   authorize();
   await this.git(root,['apply',...directoryArg,'--',file]);
  }finally{fs.unlinkSync(file);fs.rmdirSync(directory);}
 }
 async claudeCapacity({probe=false,signal}={}){
  const snap=await this.advisorLimits?.snapshot('claude');
  const now=Date.now();
  const retryAt=claudeRetryDeadline(snap);
  if(retryAt>now)return {ready:false,retryAt};
  const windows=(snap?.windows||[]).filter(window=>window.resetsAt>now);
  const ready=Boolean(snap&&!snap.limitReached&&now-snap.checkedAt<=300000&&windows.some(window=>/five.hour|5h|300_minutes/i.test(window.name)));
  if(ready||!probe||!this.advisorLimits)return {ready};
  const lastProbe=this.lastClaudeProbeAt||0;
  const nextProbe=lastProbe+3600000;
  const rejectionRecheckDue=snap?.limitReached&&retryAt&&snap.checkedAt>lastProbe;
  if(nextProbe>now&&!rejectionRecheckDue)return {ready:false,retryAt:nextProbe};
  this.lastClaudeProbeAt=now;
  signal?.throwIfAborted();
  if(!(await this.claudeStatus()).subscription)return {ready:false,retryAt:now+3600000};
  signal?.throwIfAborted();
  try{
   await this.runClaude({prompt:'Reply with READY only.',subscriptionOnly:true,signal,
     onRateLimit:snapshot=>this.advisorLimits.recordClaude(snapshot)});
  }catch(error){
   signal?.throwIfAborted();
   if(!error.rateLimit)return {ready:false,retryAt:now+3600000};
  }
  const confirmed=await this.claudeCapacity();
  return confirmed.ready?confirmed:{ready:false,retryAt:confirmed.retryAt||now+3600000};
 }
 runCapacityWait(p,t,options){return this.run(p,t,options);}
 async run(p,t,{signal,checkpoint,claimDispatch}){
  const release=p.sharedCheckout?await this.acquireWriter(p):null;
  let stopping;const interrupt=()=>{stopping=this.server.stop();};signal.addEventListener('abort',interrupt,{once:true});
  try { signal.throwIfAborted();return await this.runTask(p,t,{signal,checkpoint,claimDispatch}); } finally {signal.removeEventListener('abort',interrupt);if(stopping)await stopping;release?.();}
 }
 async runTask(p,t,{signal,checkpoint,claimDispatch}){
  const checks=validateVerification(p.verification);
  const candidate=await this.prepare(p,t,checkpoint,signal);
  p={...p,worktree:candidate};
  let cwd=p.sharedCheckout?fs.realpathSync(p.repoPath):candidate;
  if(signal.aborted)throw new Error('Paused');
  try{
   if(t.kind!=='verify'){
    let capacity,codexSnapshot;
    try{codexSnapshot=await this.server.readRateLimits();capacity=retryDeadline(codexSnapshot);}catch{capacity=Date.now()+300000;}
    if(p.autoHandoff){
     const groups=codexSnapshot?.rateLimitsByLimitId?Object.values(codexSnapshot.rateLimitsByLimitId):[codexSnapshot?.rateLimits];
     const windows=groups.flatMap(group=>[group?.primary,group?.secondary]).filter(w=>Number.isFinite(w?.usedPercent)&&Number.isFinite(w?.resetsAt)).slice(0,4).map(w=>({usedPercent:w.usedPercent,resetsAt:w.resetsAt*1000,minutes:w.windowDurationMins}));
     const claude=await this.advisorLimits?.snapshot('claude');
     checkpoint({capacity:{codex:{checkedAt:codexSnapshot?Date.now():null,windows},claude:{checkedAt:claude?.checkedAt||null,windows:(claude?.windows||[]).slice(0,4)}}});
    }
    if(signal.aborted)throw new Error('Paused');
    const lastHandoffOrVerification=t.attempts.slice(0,-1).reverse().find(a=>a.engineeringHandoff?.codexRetryAt||a.phase==='verifying');
    const previousHandoff=lastHandoffOrVerification?.phase==='verifying'?null:lastHandoffOrVerification?.engineeringHandoff;
    // A fresh live account reading supersedes a saved reset deadline (owner may reset usage).
    if(!codexSnapshot&&p.autoHandoff&&previousHandoff?.codexRetryAt>Date.now())capacity=Math.max(capacity||0,previousHandoff.codexRetryAt);
    if(capacity&&!p.autoHandoff)throw Object.assign(new Error('Waiting for confirmed Codex capacity'),{retryAt:capacity});
    if(previousHandoff&&previousHandoff.sourceHash!==await this.sourceHash(cwd,true))throw new Error('Candidate differs from the saved handoff; inspect before resuming');
    const previous=t.attempts.slice(0,-1).reverse().find(a=>a.threadId);
    if(previous?.threadId){const state=await this.server.request('thread/read',{threadId:previous.threadId,includeTurns:true});const active=state.thread?.turns?.some(x=>x.status==='inProgress');if(active)throw new Error('Previous Codex turn is still active; reconcile before resuming');}
    if(capacity){
     const handoff=await this.handoff(cwd,p,t,previousHandoff?.summary||'Codex is waiting for capacity');
     const protectedPath=protectedVerification(p,cwd,checks);
     if([...handoff.changed,...handoff.untracked].some(protectedPath))throw new Error('Owner review required: handoff changed a verification or dependency definition');
     const sources=await this.claudeSources(cwd,p.scopeFile?{files:[p.scopeFile]}:t,p.scopeFile?{changed:[],untracked:[]}:handoff,protectedPath);
     const claude=await this.claudeCapacity({probe:Object.keys(sources).length>0,signal});
     if(!claude.ready||!Object.keys(sources).length){
      const retryAt=Math.min(capacity,claude.retryAt||Date.now()+300000);
      const detail=!Object.keys(sources).length?'Waiting for Codex to establish the handoff file scope':'Waiting for confirmed provider capacity';
      throw Object.assign(new Error(detail),{retryAt,capacityDetail:detail});
     }
     if(!(await this.claudeStatus()).subscription)throw Object.assign(new Error('Claude subscription sign-in is unavailable'),{retryAt:Math.min(capacity,Date.now()+300000),capacityDetail:'Waiting for Claude subscription sign-in or Codex capacity'});
     signal.throwIfAborted();
     if(claimDispatch&&!claimDispatch('claude'))return;
     checkpoint({provider:'claude',engineeringHandoff:handoff,summary:'Claude continuing the scoped candidate'});
     let result;
     try{
      result=await this.runClaude({workingDirectory:cwd,prompt:engineeringPacket(p,t,{patchOnly:true})+'\nHandoff: '+JSON.stringify(handoff)+'\nApproved editable source: '+JSON.stringify(sources),
        subscriptionOnly:true,systemPrompt:'Implement the approved task as a unified Git diff only. Edit only the supplied files. You have no tools. Return JUNCTION_DECISION_REQUIRED if more files or authority are required.',signal,
        onRateLimit:snapshot=>this.advisorLimits?.recordClaude(snapshot)});
     }catch(error){
      if(signal.aborted)throw error;
      const rejection=error.rateLimit||(/\b(?:usage limit reached|rate limit exceeded|you(?:'ve| have) hit your limit)\b/i.test(error.message)?{limitReached:true,limitResetsAt:null,windows:[]}:null);
      if(!rejection)throw error;
      if(!error.rateLimit)this.advisorLimits?.recordClaude(rejection);
      const now=Date.now();
      const claudeRetryAt=claudeRetryDeadline({...rejection,checkedAt:now})||now+CLAUDE_UNKNOWN_LIMIT_RECHECK_MS;
      checkpoint({engineeringHandoff:{...handoff,codexRetryAt:capacity},summary:'Claude reached its limit; handoff checkpoint saved'});
      throw Object.assign(error,{retryAt:Math.min(capacity,claudeRetryAt),capacityDetail:'Waiting for confirmed provider capacity'});
     }
     signal.throwIfAborted();
     if(result.content.startsWith('JUNCTION_DECISION_REQUIRED:'))throw new Error(result.content.slice(0,2000));
     if((await this.sourceHash(cwd,true))!==handoff.sourceHash)throw new Error('Worktree changed during Claude handoff; reconcile before applying the candidate');
     if(p.sharedCheckout)await this.applySharedPatch(p,cwd,result.content,checks,handoff.sourceHash,signal);
     else await this.applyClaudePatch(cwd,result.content,sources,signal);
    }else{
     if(p.autoHandoff&&(await this.server.request('account/read',{refreshToken:false})).account?.type!=='chatgpt')throw Object.assign(new Error('Codex subscription sign-in is unavailable'),{retryAt:Date.now()+300000,capacityDetail:'Waiting for Codex subscription sign-in'});
     signal.throwIfAborted();
     try{
      const before=p.sharedCheckout?await this.sourceHash(cwd,true):null;
      const model=p.sharedCheckout?COORDINATION_CODEX_MODEL:undefined;
      signal.throwIfAborted();
      if(claimDispatch&&!claimDispatch('codex'))return;
      checkpoint({provider:'codex',summary:'Codex implementing the approved task'});
      const result=await this.server.run({cwd,model,readOnly:p.sharedCheckout===true,prompt:engineeringPacket(p,t,{patchOnly:p.sharedCheckout===true}),signal,onTurnStarted:ids=>checkpoint({...ids,...(model?{model}:{})}),handoffAtCapacity:p.autoHandoff?retryDeadline:undefined});
      if(p.sharedCheckout&&(!result.handoffRetryAt||result.text.trim().startsWith('diff --git ')))await this.applySharedPatch(p,cwd,result.text,checks,before,signal);
      if(result.handoffRetryAt){
       const handoff=await this.handoff(cwd,p,t,result.text);
       checkpoint({engineeringHandoff:{...handoff,codexRetryAt:result.handoffRetryAt},summary:'Codex handoff saved'});
       throw Object.assign(new Error('Codex handoff is ready'),{retryAt:Date.now()+1000});
      }
      checkpoint({summary:result.text.slice(-2000)});
      if(result.text.includes('JUNCTION_DECISION_REQUIRED:'))throw new Error(result.text.slice(result.text.indexOf('JUNCTION_DECISION_REQUIRED:')).slice(0,2000));
     }catch(error){
      if(p.autoHandoff&&!error.retryAt&&!signal.aborted&&/rate.?limit|quota|usage.?limit|capacity/i.test(error.message)){
       const handoff=await this.handoff(cwd,p,t,error.message);
       checkpoint({engineeringHandoff:{...handoff,codexRetryAt:Date.now()+300000},summary:'Codex stopped; worktree checkpoint saved'});
       error.retryAt=Date.now()+1000;
      }
      throw error;
     }
    }
   }
   // Shared patches have already been checked against the live source and approved paths.
   // The detached baseline can predate legitimate canonical commits and uses different ignore rules.
   const changed=p.sharedCheckout?[]:(await this.git(cwd,['diff','--name-only',p.verifiedSha||'junction/verified'])).split(/\r?\n/).filter(Boolean);
   const added=p.sharedCheckout?[]:(await this.git(cwd,['ls-files','--others','--exclude-standard'])).split(/\r?\n/).filter(Boolean);
   if(p.scopeFile&&[...changed,...added].some(f=>f!==p.scopeFile))throw new Error('Candidate changed files outside the owner-named file scope');
   if([...changed,...added].some(f=>forbidden.test(f)))throw new Error('Candidate touched a protected path');
   for(const name of [...changed,...added]){const file=path.join(cwd,name);if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('Candidate contains a symlink');}
   const protectedChecks=[...changed,...added].filter(protectedVerification(p,cwd,checks));
   if(protectedChecks.length)throw new Error(`Owner review required: candidate changed verification or dependency definitions: ${protectedChecks.join(', ')}`);
   let sharedSourceHash;
   if(p.sharedCheckout){
    sharedSourceHash=await this.sourceHash(cwd,false,p.scopeKind);
    const sourceNames=(await this.names(cwd,p.scopeKind)).filter(name=>!forbidden.test(name)&&fs.existsSync(path.join(cwd,name)));
    const candidateNames=(await this.names(candidate,p.scopeKind)).filter(name=>!forbidden.test(name));
    // Replace the entire verification manifest, including untracked files left by a failed check.
    for(const name of new Set([...sourceNames,...candidateNames])){
     if(!relative(name)||forbidden.test(name))throw new Error('Unsafe shared change');
     const from=path.join(cwd,name),to=path.join(candidate,name);
     if(sourceNames.includes(name)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}else if(fs.existsSync(to))fs.unlinkSync(to);
    }
    cwd=candidate;
   }
   checkpoint({phase:'verifying',summary:'Verifying candidate'});
   const beforeTests=await this.sourceHash(cwd,true);
   const tests=[];
   for(const profile of checks){if(signal.aborted)throw new Error('Paused');const target=fs.realpathSync(path.join(cwd,profile.cwd));if(target!==cwd&&!target.startsWith(cwd+path.sep))throw new Error('Verification directory escapes checkout');const r=await this.command(target,profile.command,signal,profile.timeoutMs,p.sharedCheckout?{NODE_PATH:path.join(p.repoPath,'node_modules')}:{});const evidence={command:profile.command,exitCode:r.exitCode,output:(r.stdout+'\n'+r.stderr).slice(-12000)};tests.push(evidence);checkpoint({tests,summary:`Verification ${tests.length}/${checks.length}: exit ${r.exitCode}`});if(r.exitCode!==0)throw new Error(`Verification failed: ${JSON.stringify(profile.command)}\n${evidence.output}`);}
   if(signal.aborted)throw new Error('Paused');
   const afterTests=await this.sourceHash(cwd,true);
   if(beforeTests!==afterTests)throw new Error('Verification changed project source or created untracked files; inspect candidate before retrying');
   const finalNames=[...(await this.git(cwd,['diff','--name-only',p.verifiedSha||'junction/verified'])).split(/\r?\n/),...(await this.git(cwd,['ls-files','--others','--exclude-standard'])).split(/\r?\n/)].filter(Boolean);if(finalNames.some(f=>forbidden.test(f)))throw new Error('Verification created a protected file');
   await this.git(cwd,['add','--all']);
   if((await this.git(cwd,['diff','--cached','--name-only'])).trim())await this.git(cwd,['-c','user.name=Junction','-c','user.email=junction@localhost','commit','-m',`Verified task ${t.id}: ${t.title}`]);
   const headSha=(await this.git(cwd,['rev-parse','HEAD'])).trim();
   checkpoint({headSha,tests,summary:'Candidate committed after verification'});
   if(p.sharedCheckout&&sharedSourceHash!==await this.sourceHash(p.repoPath,false,p.scopeKind))throw new Error('Shared source changed during verification; verify again before reporting success');
   return {headSha,tests,...(p.sharedCheckout?{sharedSourceHash}:{}),summary:`${t.title}: ${checks.length} verification commands passed. Checkpoint ${headSha.slice(0,12)}.`,worktree:cwd,branch:null};
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
