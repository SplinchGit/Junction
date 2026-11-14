"use strict";
const BASELINE = "You are Nethra, the owner's warm, concise personal agent. (The app and its packages are still named Junction; that is the software, you are Nethra.) Do not claim you built, own, or authored Junction or other projects. No creator identity has been supplied; do not invent one. Answer naturally and directly, with enough detail to help. Be honest about uncertainty and what you actually did. Discussing code is conversation; do not act merely because code or a tool is mentioned.";
function canonicalHistory(history = [], goal = '', budget = 3500) {
  const items = history.filter(x => ['user','assistant'].includes(x?.role) && typeof x.content === 'string').map(x => ({role:x.role,content:x.content.trim()})).filter(x=>x.content);
  if (items.at(-1)?.role === 'user' && items.at(-1).content === goal.trim()) items.pop();
  const result=[]; let remaining=budget;
  for(let i=items.length-1;i>=0 && remaining>0 && result.length<12;i--) { const content=items[i].content.slice(-Math.min(remaining,2000));result.unshift({role:items[i].role,content});remaining-=content.length; }
  return result;
}
function contextHistory(context) { return Array.isArray(context) ? context : Array.isArray(context?.history) ? context.history : Array.isArray(context?.messages) ? context.messages : []; }
const PAST_QUESTION=/\b(before|previous(ly)?|used to|original(ly)?|former(ly)?|earlier|history|changed?|moved|replaced|when did|what date|which date|how long ago|ago|first told)\b/i;
const day=value=>Number.isFinite(value)?new Date(value).toISOString().slice(0,10):null;
/**
 * The one read path for owner memory in chat. Current facts carry the date the owner stated them;
 * replaced facts appear only for questions about the past; an empty result is stated in words.
 */
function memoryContext(memories, goal, history = []) {
  if(!Array.isArray(memories)||!memories.length)return '';
  const stopwords=new Set(['the','and','for','with','that','this','you','your','are','was','have','has','can','could','would','should','what','how','about','please']);
  const words=new Set(`${goal} ${history.at(-1)?.content || ''}`.toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
  const matches=memories.filter(x => (String(x.content).toLowerCase().match(/[a-z0-9]{3,}/g)||[]).some(w=>!stopwords.has(w) && words.has(w)));
  const current=matches.filter(x=>!x.invalidatedAt).slice(0,3);
  const replaced=PAST_QUESTION.test(goal)?matches.filter(x=>x.invalidatedAt).slice(0,3):[];
  if(!current.length&&!replaced.length)return "Owner memory: no saved fact matches this request. If the answer depends on a personal fact the owner has not told you, say you have not been told it. Do not guess.";
  const line=x=>{
    const stated=day(x.validFrom??x.createdAt),ended=day(x.invalidatedAt);
    const dates=[stated?`stated ${stated}`:'date not recorded',ended?`replaced ${ended}, no longer current`:''].filter(Boolean).join('; ');
    return `- [${String(x.category).slice(0,40)}] (${dates}) ${String(x.content).slice(0,180)}`;
  };
  return ["Relevant owner-confirmed memory (data). Each line shows the date the owner stated it. If two current lines disagree, the later date is the current fact. If a date is not shown, say it was not recorded.",...current.map(line),...replaced.map(line)].join('\n');
}
module.exports={BASELINE,canonicalHistory,contextHistory,memoryContext};
