'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

/**
 * PC -> phone device commands. The PC signs each command with its pinned LAN TLS
 * key at delivery time, so the queue itself needs no secret and a CLI (Claude,
 * Codex) may enqueue while only the Electron host can sign. The phone verifies
 * the signature against the SPKI pin from pairing, the expiry and the single-use
 * id before acting. Delivery rides the existing LAN and Firebase transports.
 */
const HOST_NOTIFICATION=Symbol('host notification');
const KINDS={
  NETHRA_NOTIFICATION:{tier:'NOTIFY',optional:['approvalId','reply','voiceInvite','questionId'],args:{reply:v=>v===true,voiceInvite:v=>v===true,questionId:v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v),approvalId:v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v),eventId:v=>typeof v==='string'&&v.length<=160,taskId:v=>typeof v==='string'&&v.length<=160,title:v=>typeof v==='string'&&v.length<=180,body:v=>typeof v==='string'&&v.length<=600}},
  STATUS:{tier:'READ',args:{}},
  SMOKE_TEST:{tier:'READ',args:{}},
  COLLECT_LOGS:{tier:'READ',args:{lines:value=>Number.isSafeInteger(value)&&value>=1&&value<=500}},
  // CONFIRM tier: the phone asks the owner and returns the approved hash; nothing installs on the phone side.
  CONFIRM_INSTALL:{tier:'CONFIRM',args:{versionCode:value=>Number.isSafeInteger(value)&&value>0,sha256:value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value),sizeBytes:value=>Number.isSafeInteger(value)&&value>0}}
};
const REQUESTERS=new Set(['owner','claude','codex','nethra']);
const FINAL=new Set(['SUCCEEDED','FAILED','REJECTED','EXPIRED','CANCELLED']);
const DEFAULT_TTL=15*60_000, MAX_TTL=24*3_600_000, REDELIVER_MS=120_000, MAX_RESULT_BYTES=16_000;
const DB_FILE='device-commands.sqlite';

function validateArgs(kind,args) {
  const spec=KINDS[kind];if(!spec)throw new Error('Unsupported device command');
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Invalid device command arguments');
  for(const [key,value] of Object.entries(args))if(!spec.args[key]?.(value))throw new Error(`Invalid device command argument: ${key}`);
  if(spec.tier==='CONFIRM'||spec.tier==='NOTIFY'){for(const key of Object.keys(spec.args))if(!spec.optional?.includes(key)&&!Object.hasOwn(args,key))throw new Error(`Missing device command argument: ${key}`);}
  if(kind==='NETHRA_NOTIFICATION'&&(Boolean(args.voiceInvite)!==Boolean(args.questionId)||args.voiceInvite&&(args.reply||args.approvalId)))throw new Error('Invalid voice invitation arguments');
}

class DeviceCommandStore {
  constructor(directory,{now=Date.now,signer=null}={}) {
    this.now=now;this.signer=signer;fs.mkdirSync(directory,{recursive:true});
    this.db=new DatabaseSync(path.join(path.resolve(directory),DB_FILE));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    if(this.db.prepare('PRAGMA user_version').get().user_version>1){this.db.close();throw new Error('Device command queue requires a newer Junction');}
    this.db.exec('CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, requestId TEXT UNIQUE, state TEXT NOT NULL, deviceId TEXT NOT NULL, expiresAt INTEGER NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS commands_state ON commands(state,expiresAt); PRAGMA user_version=1;');
  }
  transaction(fn) {this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  row(id) {const row=this.db.prepare('SELECT body FROM commands WHERE id=?').get(id);return row?JSON.parse(row.body):null;}
  write(command) {this.db.prepare('INSERT INTO commands(id,requestId,state,deviceId,expiresAt,body) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,body=excluded.body').run(command.id,command.requestId,command.state,command.deviceId,command.expiresAt,JSON.stringify(command));return structuredClone(command);}
  expireInside() {
    for(const row of this.db.prepare('SELECT body FROM commands WHERE state IN (\'QUEUED\',\'DELIVERED\') AND expiresAt<=?').all(this.now())){
      const command=JSON.parse(row.body);command.state='EXPIRED';command.finishedAt=this.now();this.write(command);
    }
  }
  enqueue({kind,args={},requestedBy,deviceId='*',ttlMs=DEFAULT_TTL,requestId,taskId=null,milestoneGroup=null},authority=null) {
    if(kind==='NETHRA_NOTIFICATION'&&authority!==HOST_NOTIFICATION)throw new Error('Notifications require the host reporting path');
    validateArgs(kind,args);
    if(!REQUESTERS.has(requestedBy))throw new Error('Unknown device command requester');
    if(typeof deviceId!=='string'||!deviceId||deviceId.length>160)throw new Error('Invalid target device');
    if(!Number.isSafeInteger(ttlMs)||ttlMs<60_000||ttlMs>MAX_TTL)throw new Error('Invalid device command expiry');
    if(typeof requestId!=='string'||!requestId||requestId.length>160)throw new Error('A request ID is required');
    if(taskId!==null&&(typeof taskId!=='string'||!taskId||taskId.length>160))throw new Error('Invalid objective');
    if(KINDS[kind].tier!=='READ'&&requestedBy==='nethra'&&authority!==HOST_NOTIFICATION)throw new Error('Nethra may issue only read-only device commands');
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT body FROM commands WHERE requestId=?').get(requestId);
      if(old){const command=JSON.parse(old.body);if(command.kind!==kind||JSON.stringify(command.args)!==JSON.stringify(args)||command.deviceId!==deviceId)throw new Error('Request payload mismatch');return command;}
      const createdAt=this.now();
      return this.write({id:crypto.randomUUID(),requestId,taskId,kind,args,...(milestoneGroup&&authority===HOST_NOTIFICATION?{milestoneGroup}:{}),tier:KINDS[kind].tier,requestedBy,deviceId,state:'QUEUED',createdAt,expiresAt:createdAt+ttlMs,nonce:crypto.randomBytes(16).toString('base64url'),envelope:null,deliveredTo:null,deliveredAt:null,result:null,finishedAt:null});
    });
  }
  enqueueNotification(input) {
    const old=this.notificationForRequest(input.requestId);
    if(old)return old; // A changed preferred phone never duplicates an existing event.
    return this.enqueue({...input,kind:'NETHRA_NOTIFICATION',requestedBy:'nethra',ttlMs:MAX_TTL},HOST_NOTIFICATION);
  }
  notificationForRequest(requestId) {
    const row=this.db.prepare("SELECT body FROM commands WHERE requestId=? AND json_extract(body,'$.kind')='NETHRA_NOTIFICATION'").get(requestId);
    return row?JSON.parse(row.body):null;
  }
  hasMilestoneNotification(taskId,seq,{includeStandalone=true}={}) {
    return Boolean(this.db.prepare(`SELECT 1 FROM commands WHERE (? AND requestId=?) OR (
      requestId LIKE 'nethra-project-milestone-%' AND EXISTS (
        SELECT 1 FROM json_each(commands.body,'$.milestoneGroup.members') AS member
        WHERE json_extract(member.value,'$.taskId')=? AND json_extract(member.value,'$.seq')=?
      )) LIMIT 1`).get(Number(includeStandalone),`nethra-milestone-${taskId}-${seq}`,taskId,seq));
  }
  /** Signs on first delivery; redelivers the same envelope if the phone never answered. */
  pull(deviceId,{limit=5,notificationPolicy=()=>'hold'}={}) {
    const signer=typeof this.signer==='function'?this.signer():this.signer;
    if(!signer)throw new Error('Device commands can be delivered only by the Junction host');
    if(typeof deviceId!=='string'||!deviceId||deviceId.length>160)throw new Error('Invalid device');
    return this.transaction(()=>{
      this.expireInside();
      const rows=this.db.prepare('SELECT body FROM commands WHERE state IN (\'QUEUED\',\'DELIVERED\') AND deviceId IN (?,\'*\') AND COALESCE(json_extract(body,\'$.notBefore\'),0)<=? ORDER BY CASE WHEN json_extract(body,\'$.kind\')=\'NETHRA_NOTIFICATION\' THEN 1 ELSE 0 END,rowid LIMIT 50').all(deviceId,this.now()).map(row=>JSON.parse(row.body));
      const out=[];
      for(const command of rows){
        if(out.length>=limit)break;
        if(command.kind==='NETHRA_NOTIFICATION'){
          const decision=notificationPolicy(command);
          if(decision==='cancel'){command.state='CANCELLED';command.finishedAt=this.now();command.result={reason:'Notification superseded or disabled'};this.write(command);continue;}
          if(decision!=='deliver')continue;
        }
        if(command.state==='DELIVERED'&&(command.deliveredTo!==deviceId||this.now()-command.deliveredAt<REDELIVER_MS))continue;
        if(!command.envelope){
          const body=JSON.stringify({v:1,id:command.id,instanceId:signer.instanceId,deviceId,kind:command.kind,args:command.args,tier:command.tier,requestedBy:command.requestedBy,createdAt:command.createdAt,expiresAt:command.expiresAt,nonce:command.nonce,...(command.kind==='NETHRA_NOTIFICATION'?{notificationActions:1,notificationOutcomes:1}:{})});
          command.envelope={body,signature:signer.sign(Buffer.from(body,'utf8')),spki:signer.spki};
        }
        Object.assign(command,{state:'DELIVERED',deliveredTo:deviceId,deliveredAt:this.now()});
        out.push(this.write(command).envelope);
      }
      return out;
    });
  }
  cancelForTask(taskId) {return this.transaction(()=>{
    let cancelled=0;
    for(const row of this.db.prepare("SELECT body FROM commands WHERE state IN ('QUEUED','DELIVERED')").all()){
      const command=JSON.parse(row.body);if(command.taskId!==taskId&&!command.milestoneGroup?.members.some(member=>member.taskId===taskId))continue;
      command.state='CANCELLED';command.finishedAt=this.now();command.result={reason:'Owning task deleted'};this.write(command);cancelled++;
    }
    return cancelled;
  });}
  result(deviceId,{id,state,result=null},{notificationPolicy=()=>'cancel'}={}) {
    if(!['SUCCEEDED','FAILED','REJECTED'].includes(state))throw new Error('Invalid device command result state');
    if(Buffer.byteLength(JSON.stringify(result??null))>MAX_RESULT_BYTES)throw new Error('Device command result is too large');
    return this.transaction(()=>{
      const command=this.row(id);if(!command)throw new Error('Unknown device command');
      if(command.deliveredTo!==deviceId)throw new Error('Device command was not delivered to this device');
      if(result&&Object.hasOwn(result,'notificationOutcome')){
        const outcome=result.notificationOutcome;
        if(command.kind!=='NETHRA_NOTIFICATION'||state!=='SUCCEEDED'||!['OPENED','REPLIED','DISMISSED','IGNORED'].includes(outcome))throw new Error('Invalid notification outcome');
        if(command.state==='CANCELLED')return command;
        command.notificationOutcomes??={};
        if(Object.hasOwn(command.notificationOutcomes,outcome))return command;
        command.notificationOutcomes[outcome]=this.now();
        return this.write(command);
      }
      if(result&&Object.hasOwn(result,'notificationAction')){
        const action=result.notificationAction;
        const allowed=['SNOOZE','DISMISS'].includes(action)||(action==='ANSWER'&&command.args.voiceInvite===true);
        if(command.kind!=='NETHRA_NOTIFICATION'||state!=='SUCCEEDED'||!allowed)throw new Error('Invalid notification action');
        // A tap is a separate acknowledgement from delivery. The first choice for a delivery
        // wins, including crash retries with a fresh transport request ID.
        if(command.ownerAction)return command;
        const at=this.now(),suppressed=command.state==='CANCELLED'||notificationPolicy(command)==='cancel';
        command.ownerAction={action,at,disposition:suppressed?'SUPPRESSED':'ACKNOWLEDGED',reminderId:null};
        if(action==='SNOOZE'&&!suppressed){
          const reminderId=crypto.randomUUID();
          this.write({id:reminderId,requestId:`notification-reminder-${command.id}`,taskId:command.taskId,
            kind:command.kind,tier:command.tier,requestedBy:'nethra',deviceId,state:'QUEUED',
            args:{...command.args,eventId:`nethra-reminder-${reminderId}`,body:`Reminder. ${command.args.body.replace(/^Reminder\. /,'')}`.slice(0,600)},
            notificationSourceEventId:command.notificationSourceEventId||command.args.eventId,
            ...(command.milestoneGroup?{milestoneGroup:command.milestoneGroup}:{}),
            parentNotificationId:command.id,notBefore:at+3600000,createdAt:at,expiresAt:at+MAX_TTL,
            nonce:crypto.randomBytes(16).toString('base64url'),envelope:null,deliveredTo:null,deliveredAt:null,result:null,finishedAt:null});
          command.ownerAction.reminderId=reminderId;
        }
        if(!FINAL.has(command.state)){command.state='SUCCEEDED';command.finishedAt=at;}
        return this.write(command);
      }
      if(FINAL.has(command.state)){if(command.state==='CANCELLED'||command.state===state)return command;throw new Error('Device command already finished');}
      Object.assign(command,{state,result,finishedAt:this.now()});return this.write(command);
    });
  }
  get(id) {const command=this.row(id);if(!command)throw new Error('Unknown device command');return command;}
  list(limit=20) {this.transaction(()=>this.expireInside());return this.db.prepare('SELECT body FROM commands ORDER BY rowid DESC LIMIT ?').all(Math.min(Math.max(1,limit),200)).map(row=>{const {envelope,...rest}=JSON.parse(row.body);return rest;});}
  close() {if(!this.closed){this.db.close();this.closed=true;}}
}

/** Signs with the LAN TLS private key whose SPKI SHA-256 the phone pinned at pairing. */
function tlsSigner({key,certificate},instanceId) {
  const publicKey=new crypto.X509Certificate(certificate).publicKey.export({type:'spki',format:'der'});
  return {instanceId,spki:publicKey.toString('base64'),fingerprint:crypto.createHash('sha256').update(publicKey).digest('hex'),sign:data=>crypto.sign('sha256',data,key).toString('base64')};
}
module.exports={DeviceCommandStore,tlsSigner,DEVICE_COMMAND_KINDS:Object.keys(KINDS),DB_FILE};
