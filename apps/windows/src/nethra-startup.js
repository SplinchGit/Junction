'use strict';
const path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
function startupArguments(appPath=null){if(appPath&&/["\r\n]/.test(appPath))throw new Error('Invalid application path');return `${appPath?'"'+path.resolve(appPath)+'" ':''}--agent-host`;}
function startupScriptPath({packaged=false,resourcesPath=process.resourcesPath,sourceDirectory=__dirname}={}){
  return packaged ? path.join(resourcesPath,'nethra-startup.ps1') : path.join(sourceDirectory,'nethra-startup.ps1');
}
async function configureStartup({enabled,executable,appPath=null,packaged=false,resourcesPath=process.resourcesPath}){
  if(process.platform!=='win32')return {supported:false};
  if(typeof enabled!=='boolean'||!path.isAbsolute(executable)||/["\r\n]/.test(executable))throw new Error('Invalid host startup configuration');
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',startupScriptPath({packaged,resourcesPath}),'-Executable',executable,'-HostArguments',startupArguments(appPath),'-Enabled',enabled?'true':'false'];
  await promisify(execFile)('powershell.exe',args,{windowsHide:true,timeout:20000,maxBuffer:16000});
  return {supported:true,enabled};
}
module.exports={configureStartup,startupArguments,startupScriptPath};
