"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const { DeviceIdentityStore } = require("./device-identity");
const { nativeGoogleFirebaseSignIn, refreshFirebaseSession, anonymousFirebaseSignIn } = require("./firebase-auth");
const { registerDevice } = require("./firebase-sync");
const { LocalDataStore } = require("./local-data");
const { sendChat } = require("./provider-client");
const { getCodexStatus, sendCodexChat } = require("./codex-client");
const { providers, estimate } = require("./model-catalog");
const { SharedStateClient } = require("./shared-state");
const { DelegationCoordinator } = require("./delegation-coordinator");
const { LocalBrainRelay } = require("./local-brain-relay");

let companion, identityStore, identity, auditPath, localData, delegation, localBrainRelay, sharedFeed=[], lastSharedSync=null, sharedSyncPromise=null, sharedSyncTimer=null;
function companionModule() { return require(app.isPackaged ? path.join(process.resourcesPath, "pc-companion", "server.js") : path.join(__dirname, "../../../services/pc-companion/src/server.js")); }
function hydrateFirebaseEnvironment() {
  if (process.env.JUNCTION_FIREBASE_API_KEY && process.env.JUNCTION_FIREBASE_PROJECT_ID) return;
  // Deployment configuration is public Firebase client metadata, kept outside
  // source so a dev build can never accidentally point at a production project.
  try {
    const config = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "firebase-runtime.json"), "utf8"));
    if (/^[A-Za-z0-9_-]{20,}$/.test(String(config.apiKey)) && /^[a-z0-9-]{6,64}$/.test(String(config.projectId))) {
      process.env.JUNCTION_FIREBASE_API_KEY = config.apiKey;
      process.env.JUNCTION_FIREBASE_PROJECT_ID = config.projectId;
    }
  } catch {}
}

async function createWindow() {
  hydrateFirebaseEnvironment();
  identityStore = new DeviceIdentityStore(path.join(app.getPath("userData"), "identity"), safeStorage);
  identity = identityStore.load();
  localData = new LocalDataStore(path.join(app.getPath("userData"), "local"));
  delegation = new DelegationCoordinator(path.join(app.getPath("userData"), "delegation"));
  localBrainRelay = new LocalBrainRelay({ projectId: process.env.JUNCTION_FIREBASE_PROJECT_ID, getState: freshLocalBrainState });
  localBrainRelay.start();
  auditPath = path.join(app.getPath("userData"), "audit", "pc-companion.jsonl");
  // Fixed loopback port: a private overlay can forward *only* to this local
  // gateway. The companion never binds a LAN/public interface and Ollama stays
  // on its own loopback socket.
  companion = await companionModule().startCompanion({ port: 43110, token: crypto.randomBytes(32).toString("base64url"), auditPath });
  const window = new BrowserWindow({ width: 1180, height: 780, minWidth: 900, minHeight: 620, backgroundColor: "#090b10", webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  reconcilePendingDeregistration().catch(()=>{});
  scheduleSharedSync();
}

function bindOwner(session){
  if(identity.ownerUid&&identity.ownerUid!==session.uid)throw new Error("This PC is already bound to another Junction owner. Reset local Junction data before linking a different account.");
  if(!identity.ownerUid)identity=identityStore.claimOwner(session.uid)
}
async function freshSession(){
  let session=identityStore.getSession();if(!session)throw new Error("Sign in to Junction first.");
  if(Number(session.expiresAt)<Date.now()+60_000){session=await refreshFirebaseSession(session,process.env.JUNCTION_FIREBASE_API_KEY);identityStore.setSession(session)}
  return session;
}
async function freshLocalBrainState(){
  const raw=identityStore.getSecureValue("local-brain-v1"); if(!raw)return null;
  let state=JSON.parse(raw);
  if(Number(state.session?.expiresAt)<Date.now()+60_000){state={...state,session:await refreshFirebaseSession(state.session,process.env.JUNCTION_FIREBASE_API_KEY)};identityStore.setSecureValue("local-brain-v1",JSON.stringify(state));}
  return state;
}
async function enableLocalBrain(){
  let state=await freshLocalBrainState();
  if(!state){const session=await anonymousFirebaseSignIn(process.env.JUNCTION_FIREBASE_API_KEY);state={brainId:crypto.randomBytes(32).toString("base64url"),key:crypto.randomBytes(32),session};identityStore.setSecureValue("local-brain-v1",JSON.stringify({...state,key:state.key.toString("base64url")}));state={...state,key:state.key.toString("base64url")};}
  const session=state.session, brainId=state.brainId, pairId=crypto.randomBytes(32).toString("base64url"), secret=state.key;
  await localBrainRelay.request(localBrainRelay.root(brainId),session,{method:"PATCH",body:JSON.stringify({fields:{pcUid:{stringValue:session.uid},status:{stringValue:"active"}}})});
  await localBrainRelay.create(brainId,`pairings/${pairId}`,session,{status:"pending",pcUid:session.uid,expiresAtMs:Date.now()+10*60_000});
  return { code:`JBP1.${brainId}.${pairId}.${secret}`, expiresAt:Date.now()+10*60_000, brainId };
}
async function reconcilePendingDeregistration(){
  if(!identity?.deregisterPending)return;const session=await freshSession();bindOwner(session);
  await registerDevice({projectId:process.env.JUNCTION_FIREBASE_PROJECT_ID,session,device:{...identity,appVersion:app.getVersion()},syncEnabled:false});
  identity={...identity,deregisterPending:false};identityStore.save(identity);
}

async function syncSharedState(){
  if(sharedSyncPromise)return sharedSyncPromise;
  sharedSyncPromise=(async()=>{if(!identity.syncEnabled)throw new Error("Enable account sync on this PC first.");const session=await freshSession();bindOwner(session);const client=new SharedStateClient({projectId:process.env.JUNCTION_FIREBASE_PROJECT_ID,session,deviceId:identity.deviceId});const result=await client.sync(localData);sharedFeed=result.feed;lastSharedSync={at:Date.now(),...result};return lastSharedSync})().finally(()=>{sharedSyncPromise=null});return sharedSyncPromise
}
function scheduleSharedSync(){clearTimeout(sharedSyncTimer);if(!identity?.syncEnabled||!identityStore?.getSession())return;sharedSyncTimer=setTimeout(()=>{syncSharedState().catch(()=>{})},1200)}

ipcMain.handle("junction:status", () => ({ device: identity, account: identityStore.getSession() ? { uid: identityStore.getSession().uid, email: identityStore.getSession().email, displayName: identityStore.getSession().displayName } : null, cloudConfigured: Boolean(process.env.JUNCTION_FIREBASE_API_KEY && process.env.JUNCTION_FIREBASE_PROJECT_ID && process.env.JUNCTION_GOOGLE_DESKTOP_CLIENT_ID) }));
ipcMain.handle("junction:local-brain-status",async()=>{const state=await freshLocalBrainState();return {enabled:Boolean(state),brainId:state?.brainId||null,model:"qwen3:1.7b"};});
ipcMain.handle("junction:enable-local-brain",()=>enableLocalBrain());
ipcMain.handle("junction:revoke-local-brain",()=>{identityStore.setSecureValue("local-brain-v1","");return {enabled:false};});
ipcMain.handle("junction:sign-in", async () => {
  const session = await nativeGoogleFirebaseSignIn({ shell, googleClientId: process.env.JUNCTION_GOOGLE_DESKTOP_CLIENT_ID, firebaseApiKey: process.env.JUNCTION_FIREBASE_API_KEY });
  identityStore.setSession(session); return { uid: session.uid, email: session.email, displayName: session.displayName };
});
ipcMain.handle("junction:set-sync", async (_event, enabled) => {
  if(!enabled){clearTimeout(sharedSyncTimer);identity={...identity,syncEnabled:false,deregisterPending:true};identityStore.save(identity);try{await reconcilePendingDeregistration()}catch{}return identity}
  const session=await freshSession();bindOwner(session);
  await registerDevice({ projectId: process.env.JUNCTION_FIREBASE_PROJECT_ID, session, device: { ...identity, appVersion: app.getVersion() }, syncEnabled: true });
  identity = { ...identity, syncEnabled: true, deregisterPending:false }; identityStore.save(identity);scheduleSharedSync();return identity;
});
ipcMain.handle("junction:sync-shared", async () => {
  return syncSharedState();
});
ipcMain.handle("junction:shared-status",()=>lastSharedSync);
ipcMain.handle("junction:shared-feed",()=>sharedFeed);
ipcMain.handle("junction:sign-out", async () => { clearTimeout(sharedSyncTimer);const wasLinked=identity.syncEnabled;identity={...identity,syncEnabled:false,deregisterPending:wasLinked||identity.deregisterPending};identityStore.save(identity);if(identity.deregisterPending){try{await reconcilePendingDeregistration()}catch{}}identityStore.clearSession(); });
ipcMain.handle("junction:inspect", async () => {
  const headers = { authorization: `Bearer ${companion.token}`, "content-type": "application/json" };
  const proposed = await fetch(`http://${companion.host}:${companion.port}/v1/proposals`, { method: "POST", headers, body: JSON.stringify({ capability: "inspect_windows_context", triggerProvenance: "OWNER" }) });
  const proposal = (await proposed.json()).proposal;
  if (!proposal) throw new Error("Context request was blocked.");
  const executed = await fetch(`http://${companion.host}:${companion.port}/v1/proposals/${proposal.id}/execute`, { method: "POST", headers });
  const result = await executed.json(); if (!executed.ok) throw new Error(result.message || result.error); return result.output;
});
ipcMain.handle("junction:audit", () => {
  try {
    return fs.readFileSync(auditPath, "utf8").trim().split(/\r?\n/).filter(Boolean).slice(-50).reverse().map(line => {
      const row = JSON.parse(line);
      return { id: row.id, timestamp: row.timestamp, event: row.event, capability: row.capability, decision: row.decision, outcome: row.outcome, reason: row.reason };
    });
  } catch { return []; }
});
ipcMain.handle("junction:conversations", () => localData.conversations());
ipcMain.handle("junction:conversation", (_event, id) => localData.conversation(id));
ipcMain.handle("junction:new-conversation", () => {const value=localData.createConversation();scheduleSharedSync();return value});
ipcMain.handle("junction:rename-conversation", (_event, value) => {const result=localData.renameConversation(value.id,value.title);scheduleSharedSync();return result});
ipcMain.handle("junction:delete-conversation", (_event, id) => {localData.deleteConversation(id);scheduleSharedSync()});
ipcMain.handle("junction:send-message", async (_event, request) => {
  const content=String(request.content||"").trim(); if(!content) throw new Error("Message cannot be blank."); if(content.length>20000) throw new Error("Message is too long.");
  let conversation=localData.conversation(request.conversationId); if(!conversation) conversation=localData.createConversation();
  localData.addMessage(conversation.id,"user",content,"OWNER");scheduleSharedSync(); conversation=localData.conversation(conversation.id);
  const config=localData.provider();
  const reply=config.id==="codex"
    ? await sendCodexChat({ model: config.model, messages: conversation.messages, memories: localData.memories(), context: request.context || null, workingDirectory: app.getPath("userData") })
    : await sendChat({config,key:identityStore.getProviderKey(config.id),messages:conversation.messages,memories:localData.memories(),context:request.context||null});
  const message=localData.addMessage(conversation.id,"assistant",reply.content,"JUNCTION");
  const inputTokens=Number(reply.usage?.prompt_tokens??reply.usage?.input_tokens??0),outputTokens=Number(reply.usage?.completion_tokens??reply.usage?.output_tokens??0);
  localData.addUsage({providerId:config.id,model:reply.model,inputTokens,outputTokens,estimatedUsd:estimate(config.id,reply.model,inputTokens,outputTokens)});
  scheduleSharedSync();
  return {conversationId:conversation.id,message,usage:reply.usage,model:reply.model};
});
ipcMain.handle("junction:memories", () => localData.memories());
ipcMain.handle("junction:add-memory", (_event, value) => {const result=localData.addMemory(value.content,value.category);scheduleSharedSync();return result});
ipcMain.handle("junction:delete-memory", (_event, id) => {localData.deleteMemory(id);scheduleSharedSync()});
ipcMain.handle("junction:provider", () => { const config=localData.provider(); return {...config,keyPresent:config.id==="local"||Boolean(config.id&&identityStore.getProviderKey(config.id)),usesSubscription:config.id==="codex"}; });
ipcMain.handle("junction:set-provider", (_event, value) => { const config=localData.setProvider(value); if(config.id!=="codex"&&config.id!=="local"&&String(value.apiKey||"").trim()) identityStore.setProviderKey(config.id,String(value.apiKey).trim()); return {...config,keyPresent:config.id==="local"||Boolean(identityStore.getProviderKey(config.id)),usesSubscription:config.id==="codex"}; });
ipcMain.handle("junction:codex-status", () => getCodexStatus());
ipcMain.handle("junction:model-catalog", () => providers);
ipcMain.handle("junction:usage", () => localData.usage());
ipcMain.handle("junction:open-mafioso", async () => {
  const configuredUrl = String(
    process.env.JUNCTION_MAFIOSO_URL || "https://d2t8pi3n8wgmgj.cloudfront.net"
  ).trim();
  if (configuredUrl) {
    if (!/^https?:\/\//i.test(configuredUrl)) throw new Error("JUNCTION_MAFIOSO_URL must use http or https.");
    await shell.openExternal(configuredUrl);
    return { kind: "url", target: configuredUrl };
  }
  const projectPath = path.join(app.getPath("documents"), "0Mafioso", "Mafioso");
  const openError = await shell.openPath(projectPath);
  if (openError) throw new Error(openError);
  return { kind: "folder", target: projectPath };
});
ipcMain.handle("junction:delegations",()=>delegation.list());
ipcMain.handle("junction:create-delegation",(_event,value)=>delegation.create(value));
ipcMain.handle("junction:approve-delegation",(_event,id)=>delegation.approve(id));
ipcMain.handle("junction:review-delegation",(_event,value)=>delegation.review(value.planId,value.projectId));
ipcMain.handle("junction:merge-delegation",(_event,value)=>delegation.approveMerge(value.planId,value.projectId));
ipcMain.handle("junction:answer-delegation",(_event,value)=>delegation.answer(value.planId,value.projectId,value.decision));
ipcMain.handle("junction:cancel-delegation",(_event,value)=>delegation.cancel(value.planId,value.projectId));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { localBrainRelay?.stop(); companion?.server.close(); });
