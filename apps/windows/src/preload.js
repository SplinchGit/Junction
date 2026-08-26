"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("junction", {
  status: () => ipcRenderer.invoke("junction:status"), signIn: () => ipcRenderer.invoke("junction:sign-in"), signOut: () => ipcRenderer.invoke("junction:sign-out"),
  setSync: enabled => ipcRenderer.invoke("junction:set-sync", enabled), inspect: () => ipcRenderer.invoke("junction:inspect"),
  audit: () => ipcRenderer.invoke("junction:audit"), conversations: () => ipcRenderer.invoke("junction:conversations"),
  conversation: id => ipcRenderer.invoke("junction:conversation", id), newConversation: () => ipcRenderer.invoke("junction:new-conversation"),
  renameConversation: value => ipcRenderer.invoke("junction:rename-conversation", value), deleteConversation: id => ipcRenderer.invoke("junction:delete-conversation", id),
  sendMessage: value => ipcRenderer.invoke("junction:send-message", value), memories: () => ipcRenderer.invoke("junction:memories"),
  addMemory: value => ipcRenderer.invoke("junction:add-memory", value), deleteMemory: id => ipcRenderer.invoke("junction:delete-memory", id),
  provider: () => ipcRenderer.invoke("junction:provider"), setProvider: value => ipcRenderer.invoke("junction:set-provider", value),
  modelCatalog: () => ipcRenderer.invoke("junction:model-catalog"), usage: () => ipcRenderer.invoke("junction:usage"),
  syncShared: () => ipcRenderer.invoke("junction:sync-shared"), sharedStatus: () => ipcRenderer.invoke("junction:shared-status"), sharedFeed: () => ipcRenderer.invoke("junction:shared-feed"),
  delegations: () => ipcRenderer.invoke("junction:delegations"), createDelegation: value => ipcRenderer.invoke("junction:create-delegation",value), approveDelegation: id => ipcRenderer.invoke("junction:approve-delegation",id),
  reviewDelegation: value => ipcRenderer.invoke("junction:review-delegation",value), mergeDelegation: value => ipcRenderer.invoke("junction:merge-delegation",value), answerDelegation: value => ipcRenderer.invoke("junction:answer-delegation",value), cancelDelegation: value => ipcRenderer.invoke("junction:cancel-delegation",value)
});
