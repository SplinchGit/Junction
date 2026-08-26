"use strict";
function encode(value) { if(value===null)return{nullValue:null}; if(typeof value==="string")return{stringValue:value}; if(typeof value==="boolean")return{booleanValue:value}; if(typeof value==="number")return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value}; throw new Error("Unsupported shared-state value."); }
function fields(value) { return {fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)]))}; }
function decodeValue(value) { if("nullValue" in value)return null; if("stringValue" in value)return value.stringValue; if("booleanValue" in value)return value.booleanValue; if("integerValue" in value)return Number(value.integerValue); if("doubleValue" in value)return value.doubleValue; return undefined; }
function decodeDocument(document) { return Object.fromEntries(Object.entries(document.fields||{}).map(([key,value])=>[key,decodeValue(value)])); }
function messageContract(message,deviceId) { return {id:message.id,role:message.role,content:message.content.slice(0,20000),createdAt:message.createdAt,provenance:message.provenance,sourceRef:message.sourceRef||`shared:windows:${message.id}`,deviceId:message.deviceId||deviceId,schemaVersion:1}; }
function memoryContract(memory,deviceId) { const value={id:memory.id,content:memory.content.slice(0,2000),category:memory.category,createdAt:memory.createdAt,provenance:"OWNER",sourceRef:memory.sourceRef||`shared:windows:${memory.id}`,deviceId:memory.deviceId||deviceId,schemaVersion:1};if(memory.deletedAt)value.deletedAt=memory.deletedAt;return value; }
class SharedStateClient {
  constructor({projectId,session,deviceId,fetchImpl=fetch}) { this.session=session; this.deviceId=deviceId; this.fetch=fetchImpl; this.root=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(session.uid)}`; }
  async request(url,options={}) { const response=await this.fetch(url,{...options,headers:{authorization:`Bearer ${this.session.idToken}`,"content-type":"application/json",...(options.headers||{})}}); if(!response.ok)throw new Error(`Shared sync failed (${response.status}).`); return response.status===204?{}:response.json(); }
  put(path,value) { const mask=Object.keys(value).map(key=>`updateMask.fieldPaths=${encodeURIComponent(key)}`).join("&");return this.request(`${this.root}/${path}?${mask}`,{method:"PATCH",body:JSON.stringify(fields(value))}); }
  async list(path) { const values=[];let token="";do{const suffix=token?`&pageToken=${encodeURIComponent(token)}`:"",data=await this.request(`${this.root}/${path}?pageSize=200${suffix}`);values.push(...(data.documents||[]).map(document=>({id:document.name.split("/").pop(),...decodeDocument(document)})));token=data.nextPageToken||""}while(token);return values; }
  async sync(store) {
    // Pull/merge first. Metadata is last-write-wins by updatedAt; immutable
    // messages are a set union; any tombstone wins over live state.
    const conversations=await this.list("shared_conversations");
    for(const conversation of conversations) { const messages=conversation.deletedAt?[]:await this.list(`shared_conversations/${conversation.id}/messages`); store.mergeSharedConversation(conversation,messages); }
    const memories=await this.list("shared_memory"); for(const memory of memories)store.mergeSharedMemory(memory);
    const queuedBefore=store.pendingSharedCount(),snapshot=store.sharedSnapshot();
    for(const conversation of snapshot.conversations) {
      await this.put(`shared_conversations/${conversation.id}`,{id:conversation.id,title:conversation.title,createdAt:conversation.createdAt,updatedAt:conversation.updatedAt,createdByDeviceId:conversation.createdByDeviceId||this.deviceId,schemaVersion:1});
      store.markSharedPublished("conversations",conversation.id);
      for(const message of conversation.messages){await this.put(`shared_conversations/${conversation.id}/messages/${message.id}`,messageContract(message,this.deviceId));store.markSharedPublished("messages",`${conversation.id}/${message.id}`)}
    }
    for(const item of snapshot.conversationTombstones){await this.put(`shared_conversations/${item.id}`,{id:item.id,title:item.title||"Deleted conversation",createdAt:item.createdAt||item.deletedAt,updatedAt:item.updatedAt||item.deletedAt,createdByDeviceId:item.createdByDeviceId||this.deviceId,schemaVersion:1,deletedAt:item.deletedAt});store.markSharedPublished("conversationTombstones",item.id)}
    for(const memory of snapshot.memories){await this.put(`shared_memory/${memory.id}`,memoryContract(memory,this.deviceId));store.markSharedPublished("memories",memory.id)}
    for(const memory of snapshot.memoryTombstones){await this.put(`shared_memory/${memory.id}`,memoryContract(memory,this.deviceId));store.markSharedPublished("memoryTombstones",memory.id)}
    const feed=await this.list("feed_items"); return {conversations:conversations.length,memories:memories.length,uploaded:queuedBefore-store.pendingSharedCount(),pending:store.pendingSharedCount(),feed};
  }
}
module.exports={SharedStateClient,decodeDocument,fields,messageContract,memoryContract};
