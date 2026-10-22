'use strict';
const {GoogleSource,SecretVault,text}=require('./google-source');

/** Read-only Google Calendar watcher: a bounded upcoming window, etags as revisions. */
const SCOPE='https://www.googleapis.com/auth/calendar.readonly';
const EVENTS_URL='https://www.googleapis.com/calendar/v3/calendars/primary/events';
const WINDOW_MS=14*86_400_000, MAX_EVENTS=250;

/** Only the fields Nethra may reason about; descriptions and attendees stay out. */
function compactEvent(item){
  return {id:text(item.id,200),etag:text(item.etag,200),status:text(item.status,20),summary:text(item.summary,300),location:text(item.location,300),
    start:text(item.start?.dateTime||item.start?.date,40),end:text(item.end?.dateTime||item.end?.date,40),updated:text(item.updated,40)};
}

class CalendarSource extends GoogleSource {
  get name(){return 'calendar';}
  get label(){return 'Google Calendar';}
  get scope(){return SCOPE;}
  get scopeLabel(){return 'calendar.readonly';}
  async fetchEvents(){
    const items=[];let pageToken='';
    do{
      const url=new URL(EVENTS_URL);
      for(const [key,value] of Object.entries({timeMin:new Date(this.now()-86_400_000).toISOString(),timeMax:new Date(this.now()+WINDOW_MS).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'100',fields:'items(id,etag,status,summary,location,start,end,updated),nextPageToken',...(pageToken?{pageToken}:{})}))url.searchParams.set(key,value);
      const body=await this.get(url);items.push(...(body.items||[]));pageToken=body.nextPageToken||'';
    }while(pageToken&&items.length<MAX_EVENTS);
    return {items:items.slice(0,MAX_EVENTS).map(compactEvent).filter(item=>item.id&&item.etag),truncated:items.length>=MAX_EVENTS};
  }
  async poll(previous){
    const {items,truncated}=await this.fetchEvents(),current=Object.fromEntries(items.map(item=>[item.id,item])),changes=[];
    for(const item of items){const old=previous.items[item.id];if(!old)changes.push({kind:'SOURCE_ADDED',id:item.id,revision:item.etag});else if(old.etag!==item.etag)changes.push({kind:'SOURCE_CHANGED',id:item.id,revision:item.etag});}
    // Events leaving the window by time are not removals; only cancelled or vanished future events are.
    // A truncated listing cannot prove absence, so removals are skipped then.
    if(!truncated)for(const old of Object.values(previous.items))if(!current[old.id]&&Date.parse(old.end||old.start||0)>this.now())changes.push({kind:'SOURCE_REMOVED',id:old.id,revision:`removed:${old.etag}`});
    return {state:{items:current},changes,baseline:!previous.baselined};
  }
  event(id){const item=this.state().items[id];if(!item)throw new Error('That calendar event is no longer in the watched window');return item;}
}
module.exports={CalendarSource,SecretVault,compactEvent,CALENDAR_SCOPE:SCOPE};
