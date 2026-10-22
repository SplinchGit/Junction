'use strict';
const {GoogleSource,text}=require('./google-source');

/**
 * Read-only Gmail watcher. gmail.metadata grants headers and labels but never
 * message bodies, so Nethra can notice new inbox mail without reading it.
 * Changes come from the history API, so unchanged mail is never re-reported.
 */
const SCOPE='https://www.googleapis.com/auth/gmail.metadata';
const API='https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_NEW_PER_SYNC=20, MAX_ITEMS=200, MAX_HISTORY_PAGES=3;
const IGNORED=new Set(['SPAM','TRASH','DRAFT','SENT','CATEGORY_PROMOTIONS','CATEGORY_SOCIAL']);

/** Only From, Subject, Date and labels; there is no body under this scope. */
function compactMessage(message){
  const header=name=>(message.payload?.headers||[]).find(item=>String(item.name).toLowerCase()===name)?.value;
  return {id:text(message.id,64),threadId:text(message.threadId,64),from:text(header('from'),300),subject:text(header('subject'),300),date:text(header('date'),80),
    receivedAt:Number(message.internalDate)||null,labels:(message.labelIds||[]).filter(label=>typeof label==='string').slice(0,12)};
}

class GmailSource extends GoogleSource {
  get name(){return 'gmail';}
  get label(){return 'Gmail';}
  get scope(){return SCOPE;}
  get scopeLabel(){return 'gmail.metadata (headers only, no message bodies)';}
  emptyState(){return {items:{},historyId:null,lastSyncAt:null,baselined:false};}
  async baseline(previous){
    const profile=await this.get(`${API}/profile`);
    return {state:{items:previous.items||{},historyId:String(profile.historyId)},changes:[],baseline:true};
  }
  async poll(previous){
    if(!previous.baselined||!previous.historyId)return this.baseline(previous);
    const added=new Map();let pageToken='',historyId=previous.historyId,pages=0;
    try{
      do{
        const url=new URL(`${API}/history`);
        for(const [key,value] of Object.entries({startHistoryId:previous.historyId,historyTypes:'messageAdded',labelId:'INBOX',maxResults:'100',...(pageToken?{pageToken}:{})}))url.searchParams.set(key,value);
        const body=await this.get(url);
        for(const record of body.history||[])for(const {message} of record.messagesAdded||[]){
          const labels=message?.labelIds||[];
          if(message?.id&&labels.includes('INBOX')&&!labels.some(label=>IGNORED.has(label)))added.set(message.id,message);
        }
        if(body.historyId)historyId=String(body.historyId);pageToken=body.nextPageToken||'';
      }while(pageToken&&++pages<MAX_HISTORY_PAGES);
    }catch(error){
      // Google expires old history cursors; restart silently rather than replaying the inbox.
      if(error.status===404)return this.baseline(previous);
      throw error;
    }
    const items={...previous.items},changes=[];
    for(const id of [...added.keys()].slice(-MAX_NEW_PER_SYNC)){
      if(items[id])continue;
      const url=new URL(`${API}/messages/${encodeURIComponent(id)}`);
      url.searchParams.set('format','metadata');for(const name of ['From','Subject','Date'])url.searchParams.append('metadataHeaders',name);
      url.searchParams.set('fields','id,threadId,labelIds,internalDate,payload/headers');
      let message;try{message=compactMessage(await this.get(url));}catch(error){if(error.status===404)continue;throw error;}
      items[id]=message;changes.push({kind:'SOURCE_ADDED',id,revision:'received'});
    }
    const kept=Object.values(items).sort((a,b)=>(b.receivedAt||0)-(a.receivedAt||0)).slice(0,MAX_ITEMS);
    return {state:{items:Object.fromEntries(kept.map(item=>[item.id,item])),historyId},changes,baseline:false};
  }
  message(id){const item=this.state().items[id];if(!item)throw new Error('That message is not among the recently watched inbox mail');return item;}
}
module.exports={GmailSource,compactMessage,GMAIL_SCOPE:SCOPE};
