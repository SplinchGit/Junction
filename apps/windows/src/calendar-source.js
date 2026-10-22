'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');

/**
 * Opt-in, read-only Google Calendar watcher for the Windows host. It has its own
 * OAuth grant (calendar.readonly only), never shares the phone's Gmail tokens,
 * and turns changed events into deduplicated attention for objectives that
 * watch the calendar. Event text is untrusted data.
 */
const SCOPE='https://www.googleapis.com/auth/calendar.readonly';
const AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const REVOKE_URL='https://oauth2.googleapis.com/revoke';
const EVENTS_URL='https://www.googleapis.com/calendar/v3/calendars/primary/events';
const POLL_MS=10*60_000, MAX_BACKOFF_MS=60*60_000, WINDOW_MS=14*86_400_000, MAX_EVENTS=250, CONNECT_TIMEOUT_MS=5*60_000;
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
/** Only the fields Nethra may reason about; descriptions and attendees stay out. */
function compactEvent(item){
  return {id:text(item.id,200),etag:text(item.etag,200),status:text(item.status,20),summary:text(item.summary,300),location:text(item.location,300),
    start:text(item.start?.dateTime||item.start?.date,40),end:text(item.end?.dateTime||item.end?.date,40),updated:text(item.updated,40)};
}

class CalendarSource {
  constructor({vault,store,attention,fetchImpl=fetch,openExternal=async()=>{},now=Date.now,pollMs=POLL_MS,listen=(handler)=>http.createServer(handler)}){
    Object.assign(this,{vault,store,attention,fetch:fetchImpl,openExternal,now,pollMs,listen});
    this.timer=null;this.failures=0;this.lastError=null;this.access=null;this.syncing=null;
  }
  grant(){return this.vault.get('calendar-grant.bin');}
  state(){return this.vault.get('calendar-state.bin',{events:{},lastSyncAt:null,baselined:false});}
  status(){
    const grant=this.grant();if(!grant)return {status:'DISCONNECTED',scope:'calendar.readonly'};
    const {lastSyncAt}=this.state();
    if(this.lastError)return {status:'ERROR',scope:'calendar.readonly',lastSyncAt,error:this.lastError};
    if(!lastSyncAt||this.now()-lastSyncAt>3*this.pollMs)return {status:'STALE',scope:'calendar.readonly',lastSyncAt};
    return {status:'CONNECTED',scope:'calendar.readonly',lastSyncAt,events:Object.keys(this.state().events).length};
  }

  /** Loopback + PKCE desktop flow. The owner completes consent in their own browser. */
  async connect({clientId,clientSecret=''}){
    if(typeof clientId!=='string'||!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId))throw new Error('Enter the Desktop OAuth client ID from Google Cloud Console');
    if(typeof clientSecret!=='string'||clientSecret.length>200)throw new Error('Invalid client secret');
    const {verifier,challenge}=pkce(),expected=crypto.randomBytes(24).toString('base64url');
    let server;
    const code=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Calendar connection timed out; try again')),CONNECT_TIMEOUT_MS);
      server=this.listen((request,response)=>{
        const url=new URL(request.url,'http://127.0.0.1');if(url.pathname!=='/callback'){response.writeHead(404).end();return;}
        const ok=url.searchParams.get('state')===expected&&url.searchParams.get('code');
        response.writeHead(ok?200:400,{'content-type':'text/plain; charset=utf-8'}).end(ok?'Nethra can now read your calendar. You can close this tab.':'Calendar connection was not completed.');
        clearTimeout(timer);ok?resolve(url.searchParams.get('code')):reject(new Error(url.searchParams.get('error')||'Calendar consent state mismatch'));
      });
      server.on('error',reject);
      server.listen(0,'127.0.0.1',()=>{
        const redirect=`http://127.0.0.1:${server.address().port}/callback`;this.redirect=redirect;
        const url=new URL(AUTH_URL);
        for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:SCOPE,code_challenge:challenge,code_challenge_method:'S256',state:expected,access_type:'offline',prompt:'consent'}))url.searchParams.set(key,value);
        Promise.resolve(this.openExternal(url.toString())).catch(reject);
      });
    }).finally(()=>server?.close());
    const token=await this.token({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:this.redirect,client_id:clientId,...(clientSecret?{client_secret:clientSecret}:{})});
    const granted=String(token.scope||'').split(' ');
    if(!granted.includes(SCOPE)){await this.revoke(token.refresh_token||token.access_token).catch(()=>{});throw new Error('Calendar read access was not granted');}
    if(!token.refresh_token)throw new Error('Google did not return offline access; remove Nethra from your Google account permissions and connect again');
    this.vault.put('calendar-grant.bin',{clientId,clientSecret,refreshToken:token.refresh_token,scope:SCOPE,connectedAt:this.now()});
    this.vault.put('calendar-state.bin',{events:{},lastSyncAt:null,baselined:false});
    this.access={token:token.access_token,expiresAt:this.now()+Math.max(0,(Number(token.expires_in)||0)-60)*1000};
    this.lastError=null;this.failures=0;
    await this.sync();this.start();
    return this.status();
  }
  async disconnect(){
    const grant=this.grant();this.stop();
    if(grant)await this.revoke(grant.refreshToken).catch(()=>{});
    this.vault.clear('calendar-grant.bin');this.vault.clear('calendar-state.bin');this.access=null;this.lastError=null;
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
    const grant=this.grant();if(!grant)throw new Error('Google Calendar is not connected');
    const token=await this.token({grant_type:'refresh_token',refresh_token:grant.refreshToken,client_id:grant.clientId,...(grant.clientSecret?{client_secret:grant.clientSecret}:{})});
    this.access={token:token.access_token,expiresAt:this.now()+Math.max(0,(Number(token.expires_in)||0)-60)*1000};return this.access.token;
  }
  async fetchEvents(){
    const items=[];let pageToken='';
    do{
      const url=new URL(EVENTS_URL);
      for(const [key,value] of Object.entries({timeMin:new Date(this.now()-86_400_000).toISOString(),timeMax:new Date(this.now()+WINDOW_MS).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'100',fields:'items(id,etag,status,summary,location,start,end,updated),nextPageToken',...(pageToken?{pageToken}:{})}))url.searchParams.set(key,value);
      const response=await this.fetch(url,{headers:{authorization:`Bearer ${await this.accessToken()}`},signal:AbortSignal.timeout(20_000)});
      const body=await response.json().catch(()=>({}));
      if(response.status===401)this.access=null;
      if(!response.ok)throw Object.assign(new Error(body.error?.message||`Calendar request failed (${response.status})`),{status:response.status});
      items.push(...(body.items||[]));pageToken=body.nextPageToken||'';
    }while(pageToken&&items.length<MAX_EVENTS);
    return {items:items.slice(0,MAX_EVENTS).map(compactEvent).filter(item=>item.id&&item.etag),truncated:items.length>=MAX_EVENTS};
  }
  sync(){if(!this.syncing)this.syncing=this.syncOnce().finally(()=>{this.syncing=null;});return this.syncing;}
  async syncOnce(){
    if(!this.grant())return {changes:0};
    try{
      const previous=this.state(),{items,truncated}=await this.fetchEvents(),current=Object.fromEntries(items.map(item=>[item.id,item]));
      const changes=[];
      for(const item of Object.values(current)){const old=previous.events[item.id];if(!old)changes.push({kind:'SOURCE_ADDED',item});else if(old.etag!==item.etag)changes.push({kind:'SOURCE_CHANGED',item});}
      // Events leaving the window by time are not removals; only cancelled or vanished future events are.
      if(!truncated)for(const old of Object.values(previous.events))if(!current[old.id]&&Date.parse(old.end||old.start||0)>this.now())changes.push({kind:'SOURCE_REMOVED',item:{...old,etag:`removed:${old.etag}`}});
      this.vault.put('calendar-state.bin',{events:current,lastSyncAt:this.now(),baselined:true});
      let observed=0;
      // The first sync is a baseline, so connecting never floods objectives with existing events.
      if(previous.baselined){
        const watchers=this.store.list().filter(task=>Array.isArray(task.sources)&&task.sources.includes('calendar')&&!['COMPLETED','CANCELLED','FAILED'].includes(task.status));
        for(const {kind,item} of changes)for(const task of watchers){
          const result=this.attention.observe({taskId:task.id,source:'calendar',sourceId:item.id,revision:item.etag,kind,evidenceRef:`calendar:${item.id}`,priority:task.priority||3});
          if(result.created)observed++;
        }
      }
      this.lastError=null;this.failures=0;
      return {changes:previous.baselined?changes.length:0,observed,baseline:!previous.baselined};
    }catch(error){
      this.failures++;
      // A revoked or expired grant needs the owner; transient failures back off.
      this.lastError=error.code==='invalid_grant'?'Calendar access was revoked or expired; reconnect it on Windows':String(error.message).slice(0,300);
      if(error.code==='invalid_grant')this.stop();
      throw error;
    }
  }
  event(id){const item=this.state().events[id];if(!item)throw new Error('That calendar event is no longer in the watched window');return item;}
  start(){
    if(this.timer||!this.grant())return;
    const schedule=()=>{const delay=this.failures?Math.min(MAX_BACKOFF_MS,this.pollMs*2**Math.min(this.failures,6)):this.pollMs;this.timer=setTimeout(()=>{this.sync().catch(()=>{}).finally(()=>{if(this.timer)schedule();});},delay);this.timer.unref?.();};
    schedule();
    // After downtime (PC off or asleep) catch up now instead of waiting a full interval.
    const {lastSyncAt}=this.state();if(!lastSyncAt||this.now()-lastSyncAt>=this.pollMs)this.sync().catch(()=>{});
  }
  stop(){clearTimeout(this.timer);this.timer=null;}
}
module.exports={CalendarSource,SecretVault,compactEvent,CALENDAR_SCOPE:SCOPE};
