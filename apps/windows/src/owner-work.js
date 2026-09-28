"use strict";
const fs=require("node:fs"),path=require("node:path");

const DEVELOPMENT=/\b(?:work(?:ing)?\s+on|continue(?:\s+with)?|resume|implement|fix|update|change|edit|build|develop|refactor|debug|test|finish|create)\b/i;
const STOP=/\b(?:stop|pause|cancel)\b.*\b(?:work|working|project|task|this)\b|^(?:stop|pause|cancel)\s*$/i;
const DISCUSSION=/^(?:what|why|how|where|when|who|should|do you think|explain|tell me)\b/i;
const ignored=new Set(["node_modules",".git",".gradle","build","dist","Library","Temp"]);

function normal(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function associated(projects,conversationId){if(!conversationId)return null;return projects.filter(p=>p.conversationId===conversationId).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0]||null;}
function namedProject(content,projects){const words=` ${normal(content)} `;return projects.filter(p=>words.includes(` ${normal(p.name)} `)).sort((a,b)=>b.name.length-a.name.length)[0]||null;}
function explicitPath(content){
 const quoted=String(content).match(/["']([A-Za-z]:\\[^"']+|\\\\[^"']+)["']/);if(quoted)return quoted[1];
 const start=String(content).search(/(?:[A-Za-z]:\\|\\\\)/);if(start<0)return null;
 let value=String(content).slice(start).trim();
 while(value&&!fs.existsSync(value))value=value.replace(/(?:\s+(?:and|then|so|to|with|until)\b.*|[.,;!?]+)$/i,"").trim();
 return fs.existsSync(value)?value:null;
}
function findNamedFolder(content,roots,maxDepth=3){
 const words=` ${normal(content)} `,matches=[];
 function visit(folder,depth){if(depth>maxDepth)return;let entries;try{entries=fs.readdirSync(folder,{withFileTypes:true});}catch{return;}
  for(const entry of entries){if(!entry.isDirectory()||ignored.has(entry.name)||entry.name.startsWith("."))continue;const full=path.join(folder,entry.name),key=normal(entry.name);if(key&&words.includes(` ${key} `))matches.push(full);if(depth<maxDepth)visit(full,depth+1);}
 }
 for(const root of roots)if(fs.existsSync(root))visit(root,1);
 matches.sort((a,b)=>path.basename(b).length-path.basename(a).length||a.split(path.sep).length-b.split(path.sep).length);
 return matches[0]||null;
}
function resolveOwnerWork({content,conversationId,projects=[],roots=[]}){
 const message=String(content||"").trim();if(!message)return null;
 const named=namedProject(message,projects),current=named||associated(projects,conversationId);
 if(STOP.test(message))return current?{action:"stop",projectId:current.id}:null;
 if(!DEVELOPMENT.test(message)||DISCUSSION.test(message))return null;
 const supplied=explicitPath(message);if(named&&!supplied)return {action:"submit",projectId:named.id,task:message};
 if(current&&!supplied&&!/\bwork(?:ing)?\s+on\b/i.test(message))return {action:"submit",projectId:current.id,task:message};
 const candidate=supplied||findNamedFolder(message,roots);if(!candidate)return {action:"needs_scope",task:message};
 const scopePath=fs.realpathSync(candidate);return {action:"submit",scopePath,name:path.basename(scopePath),task:message};
}
module.exports={resolveOwnerWork};
