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
const KINDS={
  STATUS:{tier:'READ',args:{}},
  SMOKE_TEST:{tier:'READ',args:{}},
  COLLECT_LOGS:{tier:'READ',args:{lines:value=>Number.isSafeInteger(value)&&value>=1&&value<=500}},
  // CONFIRM tier: the phone asks the owner and returns the approved hash; nothing installs on the phone side.
  CONFIRM_INSTALL:{tier:'CONFIRM',args:{versionCode:value=>Number.isSafeInteger(value)&&value>0,sha256:value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value),sizeBytes:value=>Number.isSafeInteger(value)&&value>0}}
};
const REQUESTERS=new Set(['owner','claude','codex','nethra']);
const FINAL=new Set(['SUCCEEDED','FAILED','REJECTED','EXPIRED']);
const DEFAULT_TTL=15*60_000, MAX_TTL=24*3_600_000, REDELIVER_MS=120_000, MAX_RESULT_BYTES=16_000;
const DB_FILE='device-commands.sqlite';

function validateArgs(kind,args) {
  const spec=KINDS[kind];if(!spec)throw new Error('Unsupported device command');
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Invalid device command arguments');
  for(const [key,value] of Object.entries(args))if(!spec.args[key]?.(value))throw new Error(`Invalid device command argument: ${key}`);
  if(spec.tier==='CONFIRM'){for(const key of Object.keys(spec.args))if(!Object.hasOwn(args,key))throw new Error(`Missing device command argument: ${key}`);}
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
  enqueue({kind,args={},requestedBy,deviceId='*',ttlMs=DEFAULT_TTL,requestId,taskId=null}) {
    validateArgs(kind,args);
    if(!REQUESTERS.has(requestedBy))throw new Error('Unknown device command requester');
    if(typeof deviceId!=='string'||!deviceId||deviceId.length>160)throw new Error('Invalid target device');
    if(!Number.isSafeInteger(ttlMs)||ttlMs<60_000||ttlMs>MAX_TTL)throw new Error('Invalid device command expiry');
    if(typeof requestId!=='string'||!requestId||requestId.length>160)throw new Error('A request ID is required');
    if(taskId!==null&&(typeof taskId!=='string'||!taskId||taskId.length>160))throw new Error('Invalid objective');
    if(KINDS[kind].tier!=='READ'&&requestedBy==='nethra')throw new Error('Nethra may issue only read-only device commands');
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT body FROM commands WHERE requestId=?').get(requestId);
      if(old){const command=JSON.parse(old.body);if(command.kind!==kind||JSON.stringify(command.args)!==JSON.stringify(args)||command.deviceId!==deviceId)throw new Error('Request payload mismatch');return command;}
      return this.write({id:crypto.randomUUID(),requestId,taskId,kind,args,tier:KINDS[kind].tier,requestedBy,deviceId,state:'QUEUED',createdAt:this.now(),expiresAt:this.now()+ttlMs,nonce:crypto.randomBytes(16).toString('base64url'),envelope:null,deliveredTo:null,deliveredAt:null,result:null,finishedAt:null});
    });
  }
  /** Signs on first delivery; redelivers the same envelope if the phone never answered. */
  pull(deviceId,{limit=5}={}) {
    const signer=typeof this.signer==='function'?this.signer():this.signer;
    if(!signer)throw new Error('Device commands can be delivered only by the Junction host');
    if(typeof deviceId!=='string'||!deviceId||deviceId.length>160)throw new Error('Invalid device');
    return this.transaction(()=>{
      this.expireInside();
      const rows=this.db.prepare('SELECT body FROM commands WHERE state IN (\'QUEUED\',\'DELIVERED\') AND deviceId IN (?,\'*\') ORDER BY rowid LIMIT 50').all(deviceId).map(row=>JSON.parse(row.body));
      const out=[];
      for(const command of rows){
        if(out.length>=limit)break;
        if(command.state==='DELIVERED'&&(command.deliveredTo!==deviceId||this.now()-command.deliveredAt<REDELIVER_MS))continue;
        if(!command.envelope){
          const body=JSON.stringify({v:1,id:command.id,instanceId:signer.instanceId,deviceId,kind:command.kind,args:command.args,tier:command.tier,requestedBy:command.requestedBy,createdAt:command.createdAt,expiresAt:command.expiresAt,nonce:command.nonce});
          command.envelope={body,signature:signer.sign(Buffer.from(body,'utf8')),spki:signer.spki};
        }
        Object.assign(command,{state:'DELIVERED',deliveredTo:deviceId,deliveredAt:this.now()});
        out.push(this.write(command).envelope);
      }
      return out;
    });
  }
  result(deviceId,{id,state,result=null}) {
    if(!['SUCCEEDED','FAILED','REJECTED'].includes(state))throw new Error('Invalid device command result state');
    if(Buffer.byteLength(JSON.stringify(result??null))>MAX_RESULT_BYTES)throw new Error('Device command result is too large');
    return this.transaction(()=>{
      const command=this.row(id);if(!command)throw new Error('Unknown device command');
      if(command.deliveredTo!==deviceId)throw new Error('Device command was not delivered to this device');
      if(FINAL.has(command.state)){if(command.state===state)return command;throw new Error('Device command already finished');}
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
