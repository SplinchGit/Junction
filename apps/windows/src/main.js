"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const QRCode = require("qrcode");
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const { DeviceIdentityStore } = require("./device-identity");
const { nativeGoogleFirebaseSignIn, refreshFirebaseSession, anonymousFirebaseSignIn } = require("./firebase-auth");
const { registerDevice } = require("./firebase-sync");
const { LocalDataStore } = require("./local-data");
const { sendChat } = require("./provider-client");
const { getCodexStatus, sendCodexChat } = require("./codex-client");
const { providers, estimate } = require("./model-catalog");
const { SharedStateClient } = require("./shared-state");
const { AppServerDelegationCoordinator } = require("./app-server-delegation-coordinator");
const { LocalBrainRelay } = require("./local-brain-relay");
const { WebResearchClient, researchContext, sourceAppendix } = require("./web-research");
const { ResearchCoordinator } = require("./research-coordinator");
const { LocalAgentRuntime } = require("./local-agent-runtime");
const { LocalAgentToolRegistry } = require("./local-agent-tools");

let companion, identityStore, identity, auditPath, localData, delegation, localBrainRelay, researchClient, researchCoordinator, localAgent, sharedFeed=[], lastSharedSync=null, sharedSyncPromise=null, sharedSyncTimer=null, mainWindow=null, windowCreation=null, isQuitting=false;
const activeAgentRuns = new Map();
const launchInBackground = process.argv.includes("--background");
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

function recordStartupIssue(component, error) {
  // Startup diagnostics must never be allowed to prevent the desktop window
  // from appearing. Keep the log local and deliberately avoid recording tokens
  // or request data.
  try {
    const directory = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, "startup.log"), `${new Date().toISOString()} ${component}: ${String(error?.stack || error?.message || error).slice(0, 2000)}\n`);
  } catch {}
}

function appendAudit(entry) {
  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    const row = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...entry };
    fs.appendFileSync(auditPath, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
    return row;
  } catch { return null; }
}

async function startCompanion() {
  const options = { token: crypto.randomBytes(32).toString("base64url"), auditPath };
  try {
    return await companionModule().startCompanion({ ...options, port: 43110 });
  } catch (error) {
    // A stale development companion or a previous Junction process can retain
    // the fixed port briefly on Windows. The desktop UI and explicit inspection
    // remain safe on a fresh loopback-only port, so do not make the whole app
    // unavailable while that process winds down.
    if (error?.code !== "EADDRINUSE") throw error;
    recordStartupIssue("pc-companion fixed-port unavailable; using an ephemeral loopback port", error);
    return companionModule().startCompanion({ ...options, port: 0 });
  }
}

async function showStartupFailure(error) {
  recordStartupIssue("window startup failed", error);
  const window = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : new BrowserWindow({ width: 760, height: 420, minWidth: 640, minHeight: 360, backgroundColor: "#090b10" });
  mainWindow = window;
  const detail = String(error?.message || error || "Unknown startup error").replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><title>Junction recovery</title><body style="margin:0;background:#090b10;color:#edf1f7;font:16px system-ui;padding:48px"><h1>Junction needs attention</h1><p>The app opened in recovery mode instead of silently failing.</p><pre style="white-space:pre-wrap;color:#ffb4ab">${detail}</pre><p>Close Junction and open it again. If this repeats, share the startup log from Junction's app-data <code>logs</code> folder with support.</p></body>`)}`);
}

async function createWindowImpl() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show(); mainWindow.focus(); return mainWindow;
  }
  hydrateFirebaseEnvironment();
  identityStore = new DeviceIdentityStore(path.join(app.getPath("userData"), "identity"), safeStorage);
  identity = identityStore.load();
  localData = new LocalDataStore(path.join(app.getPath("userData"), "local"));
  delegation = new AppServerDelegationCoordinator(path.join(app.getPath("userData"), "delegation"));
  auditPath = path.join(app.getPath("userData"), "audit", "pc-companion.jsonl");
  researchClient = new WebResearchClient();
  researchCoordinator = new ResearchCoordinator(path.join(app.getPath("userData"), "research"), researchClient);
  const junctionRepository = process.env.JUNCTION_REPOSITORY || (app.isPackaged ? path.join(app.getPath("documents"), "Junction") : path.resolve(__dirname, "../../.."));
  const createCodeDelegation = async instruction => delegation.create({ instruction, projects: [{ name: "Junction", repoPath: junctionRepository }] });
  const toolRegistry = new LocalAgentToolRegistry({ researchCoordinator, createCodeDelegation, auditPath });
  localAgent = new LocalAgentRuntime({ toolRegistry });
  localBrainRelay = new LocalBrainRelay({
    projectId: process.env.JUNCTION_FIREBASE_PROJECT_ID,
    getState: freshLocalBrainState,
    workspacePath: junctionRepository,
    onCommandStarted: () => {
      if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
    },
    runLocalAgent: request => localAgent.run(request),
    // A local model can request a coding task, but never applies code itself.
    // This creates only the existing approval-gated Codex worktree draft.
    createCodeDelegation
  });
  localBrainRelay.start();
  // Prefer the fixed loopback port for the private overlay. If a stale process
  // still owns it, start a fresh loopback-only endpoint rather than failing the
  // entire desktop launch. Ollama stays on its own loopback socket.
  companion = await startCompanion();
  const window = new BrowserWindow({ width: 1180, height: 780, minWidth: 900, minHeight: 620, show: !launchInBackground, backgroundColor: "#090b10", webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow = window;
  // Only the Windows-login instance is intentionally headless. A normal
  // desktop launch must retain conventional close/open behaviour; otherwise a
  // hidden process can make Junction appear unable to open.
  window.on("close", event => {
    if (launchInBackground && !isQuitting) { event.preventDefault(); window.hide(); }
  });
  window.on("closed", () => { mainWindow = null; });
  try {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  } catch (error) {
    recordStartupIssue("renderer load failed", error);
    await showStartupFailure(error);
    return mainWindow;
  }
  reconcilePendingDeregistration().catch(()=>{});
  scheduleSharedSync();
  return window;
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show(); mainWindow.focus(); return mainWindow;
  }
  if (windowCreation) return windowCreation;
  windowCreation = createWindowImpl().catch(async error => {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
    return showStartupFailure(error);
  }).finally(() => { windowCreation = null; });
  return windowCreation;
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
  const code=`JBP1.${brainId}.${pairId}.${secret}`;
  // A conventional desktop-sized QR is easier to scan without overwhelming the
  // pairing screen. The payload is still a 256-bit secret, so error correction
  // stays intentionally low and the manual code remains available as fallback.
  return { code, qrDataUrl:await QRCode.toDataURL(code,{errorCorrectionLevel:"L",margin:4,width:360,color:{dark:"#000000",light:"#ffffff"}}), expiresAt:Date.now()+10*60_000, brainId };
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
ipcMain.handle("junction:local-brain-status",async()=>{const state=await freshLocalBrainState(),config=localData.provider();return {enabled:Boolean(state),brainId:state?.brainId||null,model:config.id==="local"&&config.model?config.model:"qwen3.5:2b",relayError:localBrainRelay?.lastError||null};});
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
      return { id: row.id, timestamp: row.timestamp, event: row.event, capability: row.capability, decision: row.decision, outcome: row.outcome, reason: row.reason, runId: row.runId, model: row.model, mode: row.mode, iteration: row.iteration, iterations: row.iterations, toolCalls: row.toolCalls, toolsExecuted: row.toolsExecuted, toolNames: row.toolNames, inputTokens: row.inputTokens, outputTokens: row.outputTokens, thinkingCharacters: row.thinkingCharacters, thinkingState: row.thinkingState, reasoningTokens: row.reasoningTokens, durationMs: row.durationMs };
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
  if (request.agent && config.id !== "local") throw new Error("Local Agent mode requires the Local LLM workflow. Codex agents live in Projects.");
  const runId=String(request.runId||crypto.randomUUID()).slice(0,100),controller=new AbortController();
  const mode=request.agent?"agent":request.research?"research":"chat",started=Date.now();
  appendAudit({event:"model_run_started",capability:"model",decision:"started",outcome:"pending",runId,model:config.model||"Default model",mode,reason:request.agent?"Native tools available to the model":request.research?"Junction Search evidence requested before inference":"No tools available to the model"});
  if(request.agent)activeAgentRuns.set(runId,controller);
  let reply,research=null;
  try {
    if(request.research){appendAudit({event:"research_requested",capability:"junction_search",decision:"requested",outcome:"pending",runId,model:config.model||"Default model",mode,reason:"Owner enabled Research; this was not selected by the model"});research=await researchCoordinator.run(content);appendAudit({event:"research_result",capability:"junction_search",decision:"executed",outcome:"success",runId,model:config.model||"Default model",mode,reason:`${research.sources?.length||0} source(s) supplied to the model`})}
    const researchInstructions = research ? researchContext(research) : null;
    reply=request.agent
      ? await localAgent.run({ goal: content, model: config.model || "qwen3.5:2b", history: conversation.messages.slice(0, -1), memories: localData.memories(), context: request.context || null, signal: controller.signal, runId })
      : config.id==="codex"
        ? await sendCodexChat({ model: config.model, messages: conversation.messages, memories: localData.memories(), context: request.context || null, research: researchInstructions, workingDirectory: app.getPath("userData") })
        : await sendChat({config,key:identityStore.getProviderKey(config.id),messages:conversation.messages,memories:localData.memories(),context:request.context||null,research:researchInstructions});
  } catch(error) {
    appendAudit({event:"model_run_completed",capability:"model",decision:"stopped",outcome:"failure",runId,model:config.model||"Default model",mode,toolCalls:0,toolsExecuted:0,toolNames:[],durationMs:Date.now()-started,reason:String(error.message||error).slice(0,500)});
    throw error;
  } finally { if(request.agent)activeAgentRuns.delete(runId); }
  const contentWithSources = research ? `${reply.content.trim()}\n\n${sourceAppendix(research)}` : reply.content;
  if (research) researchCoordinator.recordAnswer(research.jobId, reply.content);
  const message=localData.addMessage(conversation.id,"assistant",contentWithSources,"JUNCTION");
  const inputTokens=Number(reply.usage?.prompt_tokens??reply.usage?.input_tokens??0),outputTokens=Number(reply.usage?.completion_tokens??reply.usage?.output_tokens??0);
  const reasoningTokens=Number(reply.usage?.completion_tokens_details?.reasoning_tokens??reply.usage?.output_tokens_details?.reasoning_tokens??0);
  const thinkingState=reply.thinkingState||(reasoningTokens?"reported":config.id==="local"?"off":"not_reported");
  const telemetry={mode,runId,toolCalls:Number(reply.toolCalls||0),toolsExecuted:Number(reply.toolsExecuted||0),toolNames:reply.toolNames||[],iterations:Number(reply.iterations||1),thinkingCharacters:Number(reply.thinkingCharacters||0),thinkingState,reasoningTokens,durationMs:Number(reply.durationMs||Date.now()-started)};
  localData.addUsage({providerId:config.id,model:reply.model,inputTokens,outputTokens,estimatedUsd:estimate(config.id,reply.model,inputTokens,outputTokens),...telemetry});
  if(!request.agent)appendAudit({event:"model_run_completed",capability:"model",decision:"answered",outcome:"success",runId,model:reply.model||config.model||"Default model",mode,inputTokens,outputTokens,reasoningTokens,thinkingCharacters:0,thinkingState,durationMs:telemetry.durationMs,iterations:1,toolCalls:0,toolsExecuted:0,toolNames:[],reason:request.research?"Answered from owner-requested Junction Search evidence; model selected no tools":"Answered with no tool access"});
  scheduleSharedSync();
  return {conversationId:conversation.id,message,usage:reply.usage,model:reply.model};
});
ipcMain.handle("junction:cancel-agent", (_event, runId) => { const controller=activeAgentRuns.get(String(runId||"")); if(!controller)return {cancelled:false};controller.abort();return {cancelled:true}; });
ipcMain.handle("junction:memories", () => localData.memories());
ipcMain.handle("junction:add-memory", (_event, value) => {const result=localData.addMemory(value.content,value.category);scheduleSharedSync();return result});
ipcMain.handle("junction:delete-memory", (_event, id) => {localData.deleteMemory(id);scheduleSharedSync()});
ipcMain.handle("junction:provider", () => { const config=localData.provider(); return {...config,keyPresent:config.id==="local"||Boolean(config.id&&identityStore.getProviderKey(config.id)),usesSubscription:config.id==="codex"}; });
ipcMain.handle("junction:set-provider", (_event, value) => { const config=localData.setProvider(value); if(config.id!=="codex"&&config.id!=="local"&&String(value.apiKey||"").trim()) identityStore.setProviderKey(config.id,String(value.apiKey).trim()); return {...config,keyPresent:config.id==="local"||Boolean(identityStore.getProviderKey(config.id)),usesSubscription:config.id==="codex"}; });
ipcMain.handle("junction:codex-status", () => getCodexStatus());
ipcMain.handle("junction:research-status", () => researchClient.status());
ipcMain.handle("junction:research-jobs", () => researchCoordinator.list());
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { createWindow().catch(() => {}); });
  app.whenReady().then(() => {
    // A paired phone cannot wake a powered-off Windows process securely over
    // the relay. Starting at sign-in and retaining the background process is
    // the reliable recovery path while keeping all inference local to this PC.
    if (app.isPackaged && process.platform === "win32") {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ["--background"] });
    }
    return createWindow();
  });
}
app.on("activate", () => { createWindow().catch(() => {}); });
app.on("before-quit", () => { isQuitting=true; localBrainRelay?.stop(); companion?.server.close(); });
