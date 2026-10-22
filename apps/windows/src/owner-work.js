"use strict";
const fs=require("node:fs"),path=require("node:path");

const DEVELOPMENT=/^(?:keep\s+)?(?:work(?:ing)?\s+on|continue(?:\s+with)?|resume|implement|fix|repair|update|change|edit|build|develop|refactor|debug|test|finish|create)\b/i;
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
 const command=message.replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?/i,"").replace(/[.!?]+$/,"").trim();
 const status=/^(?:what (?:are you|is junction) working on|how (?:is|are) (?:the |my |our )?(?:work|tasks?|projects?) (?:going|progressing)|(?:what(?:'s| is) (?:the )?status(?: of .+)?|(?:show|list)(?: me)? (?:the |all |current |my )*(?:work|tasks?|projects?)(?: status)?|(?:give me|show me) (?:an? )?(?:update|status) on .+))$/i.test(command);
 if(status)return {action:"status",projectId:/\ball\b/i.test(command)?null:current?.id||null};
 if(DISCUSSION.test(message))return null;
 const control=command.match(/^(stop|pause|cancel|resume|continue)(?:\s+(.+))?$/i);
 if(control){
  let target=normal(control[2]||"");
  if(named)target=target.replace(normal(named.name),"").trim();
  if(!target||/^(?:(?:the|this|my|current) )?(?:work|working|project|task|queue)(?: on(?: this)?)?$/.test(target))
   return current?{action:({cancel:"stop",continue:"resume"}[control[1].toLowerCase()]||control[1].toLowerCase()),projectId:current.id}:null;
 }
 // Capability and product-wishlist questions belong in chat; only an imperative
 // development request (including a concrete polite request) can create work.
 if(/^(?:can|could|would) you\s+(?:create|build|develop)\s+(?:an? )?(?:emails?|agents?|apps?|websites?)\??$/i.test(message))return null;
 if(!DEVELOPMENT.test(command))return null;
 const supplied=explicitPath(message);if(named&&!supplied)return {action:"submit",projectId:named.id,task:message};
 if(current&&!supplied&&!/\bwork(?:ing)?\s+on\b/i.test(message))return {action:"submit",projectId:current.id,task:message};
 const candidate=supplied||findNamedFolder(message,roots);if(!candidate)return {action:"needs_scope",task:message};
 const scopePath=fs.realpathSync(candidate);return {action:"submit",scopePath,name:path.basename(scopePath),task:message};
}
module.exports={resolveOwnerWork};
