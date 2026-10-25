'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');

const execFileAsync=promisify(execFile);
const GUIDE_HEADING='## Windows host and Nethra';

/** The repository guide section, read from the owner's own map so it stays the single source. */
function repositoryGuide(root,read=fs.readFileSync){
  try{
    const text=read(path.join(root,'docs','CODEBASE_MAP.md'),'utf8').replace(/\r\n/g,'\n');
    const start=text.indexOf(GUIDE_HEADING);if(start<0)return null;
    const end=text.indexOf('\n## ',start+GUIDE_HEADING.length);
    return text.slice(start+GUIDE_HEADING.length,end<0?undefined:end).trim().slice(0,2200);
  }catch{return null;}
}

/** Recent commits, so Nethra can see changes it did not make (read-only git, bounded). */
async function recentChanges(root,{run=execFileAsync,days=7,limit=12}={}){
  try{
    const {stdout}=await run('git',['-C',root,'log',`--since=${days}.days`,'--no-merges',`-n${limit}`,'--format=%h %cI %s'],{windowsHide:true,timeout:5000});
    return String(stdout).split(/\r?\n/).filter(Boolean).map(line=>line.slice(0,140));
  }catch{return null;}
}

/**
 * Facts the host already knows, handed to Nethra at the start of each wake. Without them it
 * re-ran diagnostics and the performance report every wake (live, 25 October) and read
 * unrelated files looking for where the Windows code lives.
 */
async function objectiveBrief({task,tools,exists=fs.existsSync,read=fs.readFileSync,run}={}){
  const brief={};
  if(task.allowCodeWork){
    try{
      const [report,host]=await Promise.all([tools.performanceReport?.(task.id),tools.hostDiagnostics?.()]);
      const advisors={};
      for(const provider of ['codex','claude']){
        try{const gate=await tools.advisorLimits.check(provider);advisors[provider]=gate.available?'available':`resting until ${new Date(gate.nextAvailableAt).toISOString()}`;}catch{advisors[provider]='unknown';}
      }
      brief.hostFacts={taskModelCalls:report?{samples:report.objective.sampleCount,medianMs:report.objective.medianInferenceMs}:null,localChat:report?{samples:report.chat.sampleCount,medianMs:report.chat.medianResponseMs}:null,contextTokens:host?.contextTokens??null,freeMemoryGiB:host?.host?Math.round(host.host.freeMemoryBytes/2**30*10)/10:null,advisors,note:'Measured by the host at the start of this wake. Call performance_report or host_diagnostics only for detail beyond this.'};
    }catch{}
  }
  const root=(task.readRoots||[]).find(item=>{try{return exists(path.join(item,'.git'));}catch{return false;}});
  if(root){
    const changes=await recentChanges(root,{run});
    if(changes?.length)brief.recentCommits=changes;
    const guide=repositoryGuide(root,read);
    if(guide)brief.repositoryGuide=guide;
  }
  return brief;
}

module.exports={objectiveBrief,repositoryGuide,recentChanges};
