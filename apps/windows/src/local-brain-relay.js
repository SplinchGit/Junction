"use strict";

const crypto = require("node:crypto");
const LOCAL_SOURCE = "junction_local_llm_v2";
const POLL_INTERVAL_MS = 10_000;
const MAX_RESPONSE_CHARS = 12_000;

function decode(value) { if (!value) return undefined; if ("stringValue" in value) return value.stringValue; if ("integerValue" in value) return Number(value.integerValue); return undefined; }
function decodeDocument(document) { return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)])); }
function fields(value) { return { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "number" ? { integerValue: String(Math.trunc(item)) } : { stringValue: String(item) }])) }; }
function crypt(key, aad, input, nonce, encrypt) {
  const material = Buffer.isBuffer(key) ? key : Buffer.from(key, "base64url");
  if (material.length !== 32) throw new Error("Invalid Local Junction pairing key.");
  const iv = nonce || crypto.randomBytes(12), cipher = encrypt ? crypto.createCipheriv("aes-256-gcm", material, iv) : crypto.createDecipheriv("aes-256-gcm", material, iv);
  cipher.setAAD(Buffer.from(aad)); if (!encrypt) cipher.setAuthTag(input.subarray(input.length - 16));
  const body = encrypt ? Buffer.concat([cipher.update(input), cipher.final(), cipher.getAuthTag()]) : Buffer.concat([cipher.update(input.subarray(0, -16)), cipher.final()]);
  return encrypt ? { ciphertext: body.toString("base64url"), nonce: iv.toString("base64url") } : body.toString("utf8");
}

/** PC-only endpoint for the encrypted paired Local Junction Brain. */
class LocalBrainRelay {
  constructor({ projectId, getState, fetchImpl = fetch, ollamaUrl = "http://127.0.0.1:11434", intervalMs = POLL_INTERVAL_MS }) { this.projectId=projectId;this.getState=getState;this.fetch=fetchImpl;this.ollamaUrl=ollamaUrl.replace(/\/$/,"");this.intervalMs=intervalMs;this.timer=null;this.polling=false; }
  start(){ if(this.timer||!this.projectId)return;this.timer=setInterval(()=>this.poll().catch(()=>{}),this.intervalMs);this.poll().catch(()=>{}); }
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  root(brainId){return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents/local_brains/${encodeURIComponent(brainId)}`;}
  async request(url, session, options={}) { const response=await this.fetch(url,{...options,headers:{authorization:`Bearer ${session.idToken}`,"content-type":"application/json",...(options.headers||{})}});const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(body?.error?.message||`Junction relay request failed (${response.status}).`);return body||{}; }
  async query(brainId, session, collection, status){const body={structuredQuery:{from:[{collectionId:collection}],where:{fieldFilter:{field:{fieldPath:"status"},op:"EQUAL",value:{stringValue:status}}},limit:5}};const rows=await this.request(`${this.root(brainId)}:runQuery`,session,{method:"POST",body:JSON.stringify(body)});return(rows||[]).map(x=>x.document).filter(Boolean).map(document=>({document,data:decodeDocument(document)}));}
  async update(document,session,values,expected=null){const mask=Object.keys(values).map(key=>`updateMask.fieldPaths=${encodeURIComponent(key)}`).join("&");const pre=expected?`&currentDocument.updateTime=${encodeURIComponent(expected)}`:"";return this.request(`https://firestore.googleapis.com/v1/${document.name}?${mask}${pre}`,session,{method:"PATCH",body:JSON.stringify(fields(values))});}
  async create(brainId, path, session, values){return this.request(`${this.root(brainId)}/${path}`,session,{method:"PATCH",body:JSON.stringify(fields(values))});}
  async poll(){if(this.polling)return;this.polling=true;try{const state=await this.getState();if(!state?.brainId||!state?.session||!state?.key)return;const pairs=await this.query(state.brainId,state.session,"pairings","claimed");for(const pair of pairs)await this.activatePair(state,pair);const commands=await this.query(state.brainId,state.session,"commands","pending");for(const command of commands)await this.run(state,command);}finally{this.polling=false;}}
  async activatePair(state,item){const uid=item.data.clientUid;if(!uid||uid.length>200||Number(item.data.expiresAtMs)<Date.now())return;await this.create(state.brainId,`clients/${encodeURIComponent(uid)}`,state.session,{clientUid:uid,status:"active"});await this.update(item.document,state.session,{status:"active"},item.document.updateTime);}
  async run(state,item){try{await this.update(item.document,state.session,{status:"processing"},item.document.updateTime);const id=item.data.id||item.document.name.split("/").pop();const aad=`JBP1|${state.brainId}|${id}|request`;const text=crypt(state.key,aad,Buffer.from(item.data.ciphertext,"base64url"),Buffer.from(item.data.nonce,"base64url"),false);const payload=JSON.parse(text);if(!Array.isArray(payload.messages)||typeof payload.model!=="string")throw new Error("Invalid encrypted local-model request.");const upstream=await this.fetch(`${this.ollamaUrl}/api/chat`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:payload.model,messages:payload.messages,stream:false,think:false,options:{num_predict:1024}})});const result=await upstream.json();if(!upstream.ok)throw new Error(result?.error||`Local model returned HTTP ${upstream.status}.`);const answer=String(result?.message?.content||"").trim();if(!answer)throw new Error("Local model returned an empty response.");const encrypted=crypt(state.key,`JBP1|${state.brainId}|${id}|response`,Buffer.from(answer.slice(0,MAX_RESPONSE_CHARS)),null,true);await this.update(item.document,state.session,{status:"done",responseCiphertext:encrypted.ciphertext,responseNonce:encrypted.nonce},null);}catch(error){try{await this.update(item.document,state.session,{status:"error",error:String(error.message||error).slice(0,300)},null);}catch{}}}
}
module.exports={LocalBrainRelay,LOCAL_SOURCE,decodeDocument,crypt};
