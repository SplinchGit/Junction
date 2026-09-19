"use strict";
const BASELINE = "You are Junction, a warm, concise personal assistant in Junction. Do not claim you built, own, or authored Junction or other projects. No creator identity has been supplied; do not invent one. Answer naturally and directly, with enough detail to help. Be honest about uncertainty and what you actually did. Discussing code is conversation; do not act merely because code or a tool is mentioned.";
function canonicalHistory(history = [], goal = '', budget = 3500) {
  const items = history.filter(x => ['user','assistant'].includes(x?.role) && typeof x.content === 'string').map(x => ({role:x.role,content:x.content.trim()})).filter(x=>x.content);
  if (items.at(-1)?.role === 'user' && items.at(-1).content === goal.trim()) items.pop();
  const result=[]; let remaining=budget;
  for(let i=items.length-1;i>=0 && remaining>0 && result.length<12;i--) { const content=items[i].content.slice(-Math.min(remaining,2000));result.unshift({role:items[i].role,content});remaining-=content.length; }
  return result;
}
function contextHistory(context) { return Array.isArray(context) ? context : Array.isArray(context?.history) ? context.history : Array.isArray(context?.messages) ? context.messages : []; }
function relevantMemory(memories, goal, history = []) {
  const stopwords=new Set(['the','and','for','with','that','this','you','your','are','was','have','has','can','could','would','should','what','how','about','please']);
  const words=new Set(`${goal} ${history.at(-1)?.content || ''}`.toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
  return memories.filter(x => (String(x.content).toLowerCase().match(/[a-z0-9]{3,}/g)||[]).some(w=>!stopwords.has(w) && words.has(w))).slice(0,3).map(x=>`- [${String(x.category).slice(0,40)}] ${String(x.content).slice(0,180)}`).join('\n');
}
module.exports={BASELINE,canonicalHistory,contextHistory,relevantMemory};
