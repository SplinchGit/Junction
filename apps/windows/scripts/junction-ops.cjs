#!/usr/bin/env node
'use strict';
/**
 * Shared executor for Claude, Codex and the owner. Device commands are queued
 * here and signed/delivered by the running Junction host over LAN or the
 * Firebase relay. ADB is limited to USB and Tailscale (100.64.0.0/10) targets,
 * and installs only run after the phone approves the exact versionCode and hash.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const {parseArgs}=require('node:util');
const {DeviceCommandStore}=require('../src/device-commands');

const PACKAGE='com.splinch.junction';
const dataDir=()=>process.env.JUNCTION_NETHRA_DIR||path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'junction-windows','nethra');
const adbPath=()=>process.env.ADB||[path.join(process.env.LOCALAPPDATA||'','Android','Sdk','platform-tools','adb.exe')].find(file=>fs.existsSync(file))||'adb';
const TAILNET=host=>{const o=String(host).split('.').map(Number);return o.length===4&&o.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&o[0]===100&&o[1]>=64&&o[1]<=127;};
function parseTailnetEndpoint(value) {
  const match=String(value||'').match(/^(\d+\.\d+\.\d+\.\d+):(\d{1,5})$/);
  if(!match)throw new Error('Wireless ADB needs an explicit Tailscale host:port from Android Wireless debugging');
  const host=match[1],port=Number(match[2]);
  if(!TAILNET(host))throw new Error('Wireless ADB is limited to a Tailscale address');
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid wireless ADB port');
  return {host,port};
}
function assertTailnetPeer(host,status) {
  if(status?.BackendState!=='Running')throw new Error('Tailscale must be running');
  const peer=Object.values(status.Peer||{}).find(item=>item?.TailscaleIPs?.includes(host));
  if(!peer)throw new Error('ADB target is not a known tailnet peer');
  if(peer.Online!==true)throw new Error('ADB tailnet peer is not online');
}
function tailnetStatus() {
  const executable=process.env.TAILSCALE||'C:\\Program Files\\Tailscale\\tailscale.exe';
  return JSON.parse(execFileSync(executable,['status','--json'],{encoding:'utf8',timeout:10_000,windowsHide:true}));
}
function verifiedTailnetEndpoint(value) {
  const endpoint=parseTailnetEndpoint(value);
  assertTailnetPeer(endpoint.host,tailnetStatus());
  return `${endpoint.host}:${endpoint.port}`;
}

/** A serial is allowed when it is a USB device or an ip:port inside the tailnet. */
function allowedSerial(serial) {
  if(typeof serial!=='string'||!serial)return false;
  const match=serial.match(/^(\d+\.\d+\.\d+\.\d+):(\d{1,5})$/);
  if(match)return TAILNET(match[1]);
  return /^[A-Za-z0-9]+$/.test(serial);
}
function adb(args,{serial}={}) {
  if(serial&&!allowedSerial(serial))throw new Error(`Refusing ADB target ${serial}: only USB or Tailscale (100.64.0.0/10) devices are allowed`);
  if(serial?.includes(':'))verifiedTailnetEndpoint(serial);
  return execFileSync(adbPath(),[...(serial?['-s',serial]:[]),...args],{encoding:'utf8',timeout:600_000,windowsHide:true});
}
function installedVersion(serial) {
  const out=adb(['shell','dumpsys','package',PACKAGE],{serial});
  const match=out.match(/versionCode=(\d+)/);return match?Number(match[1]):null;
}
function apkVersion(apk) {
  const metadata=path.join(path.dirname(apk),'output-metadata.json');
  if(!fs.existsSync(metadata))throw new Error('output-metadata.json next to the APK is required to verify versionCode');
  const elements=JSON.parse(fs.readFileSync(metadata,'utf8')).elements||[];
  const entry=elements.find(item=>item.outputFile===path.basename(apk));
  if(!Number.isSafeInteger(entry?.versionCode))throw new Error('APK versionCode is not recorded in output-metadata.json');
  return entry.versionCode;
}
async function waitFor(store,id,timeoutMs) {
  const until=Date.now()+timeoutMs;
  for(;;){
    const command=store.get(id);
    if(['SUCCEEDED','FAILED','REJECTED','EXPIRED'].includes(command.state))return command;
    if(Date.now()>=until)return command;
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
}
const print=value=>process.stdout.write(`${JSON.stringify(value,null,2)}\n`);

async function main(argv) {
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{by:{type:'string',default:'owner'},device:{type:'string',default:'*'},lines:{type:'string'},timeout:{type:'string',default:'300'},serial:{type:'string'},wait:{type:'boolean',default:false},apk:{type:'string'}}});
  const [area,action,...rest]=positionals;
  if(area==='device'){
    const store=new DeviceCommandStore(dataDir());
    try{
      if(action==='list')return print(store.list(Number(rest[0])||20));
      if(action==='get')return print(store.get(rest[0]));
      if(action==='wait')return print(await waitFor(store,rest[0],Number(values.timeout)*1000));
      if(action==='send'){
        const kind=String(rest[0]||'').toUpperCase(),args=values.lines?{lines:Number(values.lines)}:{};
        const command=store.enqueue({kind,args,requestedBy:values.by,deviceId:values.device,requestId:`cli-${crypto.randomUUID()}`});
        return print(values.wait?await waitFor(store,command.id,Number(values.timeout)*1000):command);
      }
    }finally{store.close();}
  }
  if(area==='adb'){
    if(action==='devices')return print(adb(['devices','-l']).split(/\r?\n/).slice(1).filter(Boolean).map(line=>{const [serial,state]=line.split(/\s+/);return {serial,state,allowed:allowedSerial(serial)};}));
    if(action==='connect'){
      const endpoint=verifiedTailnetEndpoint(rest[0]);
      return print({output:adb(['connect',endpoint]).trim()});
    }
    if(action==='pair'){
      const endpoint=verifiedTailnetEndpoint(rest[0]);
      if(!process.stdin.isTTY)throw new Error('Pair in an interactive terminal so the pairing code never appears in arguments or logs');
      process.stderr.write('Enter the one-time code shown in Android Wireless debugging at the ADB prompt. Do not enable Always allow on hostel WiFi.\n');
      const result=spawnSync(adbPath(),['pair',endpoint],{stdio:'inherit',timeout:120_000,windowsHide:true});
      if(result.error)throw result.error;
      if(result.status!==0)throw new Error('ADB pairing failed');
      return print({paired:endpoint});
    }
    if(action==='install'){
      const apk=path.resolve(values.apk||rest[0]||'');
      if(!fs.existsSync(apk))throw new Error('APK not found');
      if(!values.serial)throw new Error('--serial is required (see: adb devices)');
      const sha256=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),versionCode=apkVersion(apk),installed=installedVersion(values.serial);
      if(installed!==null&&versionCode<installed)throw new Error(`Refusing downgrade: installed ${installed}, APK ${versionCode}`);
      // CONFIRM tier: the phone must approve this exact build before ADB touches it.
      const store=new DeviceCommandStore(dataDir());
      let consent;
      try{
        const command=store.enqueue({kind:'CONFIRM_INSTALL',args:{versionCode,sha256,sizeBytes:fs.statSync(apk).size},requestedBy:values.by,deviceId:values.device,requestId:`install-${sha256}-${values.serial}`});
        process.stderr.write(`Waiting for approval on the phone (command ${command.id.slice(0,8)})...\n`);
        consent=await waitFor(store,command.id,Number(values.timeout)*1000);
      }finally{store.close();}
      if(consent.state!=='SUCCEEDED'||consent.result?.approved!==true||consent.result?.sha256!==sha256)throw new Error(`Install not approved on the phone (${consent.state})`);
      const output=adb(['install','-r',apk],{serial:values.serial}).trim();
      return print({installed:versionCode,previous:installed,sha256,output,after:installedVersion(values.serial)});
    }
  }
  process.stderr.write(['Usage:',
    '  junction-ops device send STATUS|SMOKE_TEST|COLLECT_LOGS [--lines N] [--by claude|codex|owner] [--device ID] [--wait] [--timeout S]',
    '  junction-ops device list [N] | get ID | wait ID',
    '  junction-ops adb devices | pair 100.x.y.z:PAIR_PORT | connect 100.x.y.z:DEBUG_PORT',
    '  junction-ops adb install APK --serial SERIAL [--by ...]'].join('\n')+'\n');
  process.exitCode=2;
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
module.exports={allowedSerial,TAILNET,parseTailnetEndpoint,assertTailnetPeer,apkVersion,main};
