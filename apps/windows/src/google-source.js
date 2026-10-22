'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');

/**
 * Shared base for opt-in, read-only Google sources on the Windows host. Each
 * source holds its own narrowly scoped grant (never the phone's tokens), polls
 * with backoff, reports honest freshness, and turns verified changes into
 * deduplicated attention for objectives that watch it. Content is untrusted.
 */
const AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const REVOKE_URL='https://oauth2.googleapis.com/revoke';
const POLL_MS=10*60_000, MAX_BACKOFF_MS=60*60_000, CONNECT_TIMEOUT_MS=5*60_000;
const TERMINAL=['COMPLETED','CANCELLED','FAILED'];
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';

/** Encrypted JSON records under the user's Windows credential protection. */
class SecretVault {
  constructor(directory,safeStorage){this.directory=directory;this.safeStorage=safeStorage;}
  file(name){return path.join(this.directory,name);}
  put(name,value){
    if(!this.safeStorage?.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable');
    fs.mkdirSync(this.directory,{recursive:true});const target=this.file(name),temporary=`${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary,this.safeStorage.encryptString(JSON.stringify(value)).toString('base64'));fs.renameSync(temporary,target);
  }
  get(name,fallback=null){
    let encrypted;try{encrypted=fs.readFileSync(this.file(name),'utf8');}catch(error){if(error.code==='ENOENT')return fallback;throw error;}
    return JSON.parse(this.safeStorage.decryptString(Buffer.from(encrypted,'base64')));
  }
  clear(name){fs.rmSync(this.file(name),{force:true});}
}
function pkce(){const verifier=crypto.randomBytes(48).toString('base64url');return {verifier,challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};}

class GoogleSource {
  /** Subclasses set: name, label, scope, scopeLabel, poll(previousState) and item(id). */
  constructor({vault,store,attention,fetchImpl=fetch,openExternal=async()=>{},now=Date.now,pollMs=POLL_MS,listen=(handler)=>http.createServer(handler)}){
    Object.assign(this,{vault,store,attention,fetch:fetchImpl,openExternal,now,pollMs,listen});
    this.timer=null;this.failures=0;this.lastError=null;this.access=null;this.syncing=null;
  }
  get grantFile(){return `${this.name}-grant.bin`;}
  get stateFile(){return `${this.name}-state.bin`;}
  grant(){return this.vault.get(this.grantFile);}
  state(){return this.vault.get(this.stateFile,this.emptyState());}
  emptyState(){return {items:{},lastSyncAt:null,baselined:false};}
  status(){
    const base={scope:this.scopeLabel};if(!this.grant())return {status:'DISCONNECTED',...base};
    const state=this.state(),lastSyncAt=state.lastSyncAt;
    if(this.lastError)return {status:'ERROR',...base,lastSyncAt,error:this.lastError};
    if(!lastSyncAt||this.now()-lastSyncAt>3*this.pollMs)return {status:'STALE',...base,lastSyncAt};
    return {status:'CONNECTED',...base,lastSyncAt,items:Object.keys(state.items||{}).length};
  }

  /** Loopback + PKCE desktop flow. The owner completes consent in their own browser. */
  async connect({clientId,clientSecret=''}){
    if(typeof clientId!=='string'||!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId))throw new Error('Enter the Desktop OAuth client ID from Google Cloud Console');
    if(typeof clientSecret!=='string'||clientSecret.length>200)throw new Error('Invalid client secret');
    const {verifier,challenge}=pkce(),expected=crypto.randomBytes(24).toString('base64url');
    let server;
    const code=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`${this.label} connection timed out; try again`)),CONNECT_TIMEOUT_MS);
      server=this.listen((request,response)=>{
        const url=new URL(request.url,'http://127.0.0.1');if(url.pathname!=='/callback'){response.writeHead(404).end();return;}
        const ok=url.searchParams.get('state')===expected&&url.searchParams.get('code');
        response.writeHead(ok?200:400,{'content-type':'text/plain; charset=utf-8'}).end(ok?`Nethra now has read-only ${this.label} access. You can close this tab.`:`${this.label} connection was not completed.`);
        clearTimeout(timer);ok?resolve(url.searchParams.get('code')):reject(new Error(url.searchParams.get('error')||`${this.label} consent state mismatch`));
      });
      server.on('error',reject);
      server.listen(0,'127.0.0.1',()=>{
        const redirect=`http://127.0.0.1:${server.address().port}/callback`;this.redirect=redirect;
        const url=new URL(AUTH_URL);
        for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:this.scope,code_challenge:challenge,code_challenge_method:'S256',state:expected,access_type:'offline',prompt:'consent'}))url.searchParams.set(key,value);
        Promise.resolve(this.openExternal(url.toString())).catch(reject);
      });
    }).finally(()=>server?.close());
    const token=await this.token({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:this.redirect,client_id:clientId,...(clientSecret?{client_secret:clientSecret}:{})});
    const granted=String(token.scope||'').split(' ');
    if(!granted.includes(this.scope)){await this.revoke(token.refresh_token||token.access_token).catch(()=>{});throw new Error(`${this.label} read access was not granted`);}
    if(!token.refresh_token)throw new Error('Google did not return offline access; remove Nethra from your Google account permissions and connect again');
    this.vault.put(this.grantFile,{clientId,clientSecret,refreshToken:token.refresh_token,scope:this.scope,connectedAt:this.now()});
    this.vault.put(this.stateFile,this.emptyState());
    this.access={token:token.access_token,expiresAt:this.now()+Math.max(0,(Number(token.expires_in)||0)-60)*1000};
    this.lastError=null;this.failures=0;
    await this.sync();this.start();
    return this.status();
  }
  async disconnect(){
    const grant=this.grant();this.stop();
    if(grant)await this.revoke(grant.refreshToken).catch(()=>{});
    this.vault.clear(this.grantFile);this.vault.clear(this.stateFile);this.access=null;this.lastError=null;
    return this.status();
  }
  async token(form){
    const response=await this.fetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form).toString(),signal:AbortSignal.timeout(20_000)});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(body.error_description||body.error||`Google token request failed (${response.status})`),{code:body.error,status:response.status});
    return body;
  }
  revoke(token){return this.fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`,{method:'POST',signal:AbortSignal.timeout(10_000)});}
  async accessToken(){
    if(this.access&&this.access.expiresAt>this.now())return this.access.token;
    const grant=this.grant();if(!grant)throw new Error(`${this.label} is not connected`);
    const token=await this.token({grant_type:'refresh_token',refresh_token:grant.refreshToken,client_id:grant.clientId,...(grant.clientSecret?{client_secret:grant.clientSecret}:{})});
    this.access={token:token.access_token,expiresAt:this.now()+Math.max(0,(Number(token.expires_in)||0)-60)*1000};return this.access.token;
  }
  /** Authenticated GET returning parsed JSON; errors carry the HTTP status. */
  async get(url){
    const response=await this.fetch(url,{headers:{authorization:`Bearer ${await this.accessToken()}`},signal:AbortSignal.timeout(20_000)});
    const body=await response.json().catch(()=>({}));
    if(response.status===401)this.access=null;
    if(!response.ok)throw Object.assign(new Error(body.error?.message||`${this.label} request failed (${response.status})`),{status:response.status});
    return body;
  }
  sync(){if(!this.syncing)this.syncing=this.syncOnce().finally(()=>{this.syncing=null;});return this.syncing;}
  async syncOnce(){
    if(!this.grant())return {changes:0};
    try{
      const previous=this.state(),{state,changes,baseline}=await this.poll(previous);
      this.vault.put(this.stateFile,{...state,lastSyncAt:this.now(),baselined:true});
      let observed=0;
      // A baseline (first sync, or a reset history) never floods objectives with existing items.
      if(!baseline){
        const watchers=this.store.list().filter(task=>Array.isArray(task.sources)&&task.sources.includes(this.name)&&!TERMINAL.includes(task.status));
        for(const {kind,id,revision} of changes)for(const task of watchers){
          if(this.attention.observe({taskId:task.id,source:this.name,sourceId:id,revision,kind,evidenceRef:`${this.name}:${id}`,priority:task.priority||3}).created)observed++;
        }
      }
      this.lastError=null;this.failures=0;
      return {changes:baseline?0:changes.length,observed,baseline};
    }catch(error){
      this.failures++;
      // A revoked or expired grant needs the owner; transient failures back off.
      this.lastError=error.code==='invalid_grant'?`${this.label} access was revoked or expired; reconnect it on Windows`:String(error.message).slice(0,300);
      if(error.code==='invalid_grant')this.stop();
      throw error;
    }
  }
  start(){
    if(this.timer||!this.grant())return;
    const schedule=()=>{const delay=this.failures?Math.min(MAX_BACKOFF_MS,this.pollMs*2**Math.min(this.failures,6)):this.pollMs;this.timer=setTimeout(()=>{this.sync().catch(()=>{}).finally(()=>{if(this.timer)schedule();});},delay);this.timer.unref?.();};
    schedule();
    // After downtime (PC off or asleep) catch up now instead of waiting a full interval.
    const {lastSyncAt}=this.state();if(!lastSyncAt||this.now()-lastSyncAt>=this.pollMs)this.sync().catch(()=>{});
  }
  stop(){clearTimeout(this.timer);this.timer=null;}
}
module.exports={GoogleSource,SecretVault,text};
