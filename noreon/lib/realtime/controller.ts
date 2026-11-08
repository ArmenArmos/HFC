import {backoffDelay,parseSignal,refreshDelay,REALTIME_TIMING,type RealtimePlane,type RealtimeToken,type SignalKind} from './contracts';

/**
 * WP R: the connection logic behind useRealtimeSignals, framework-free so a fake socket can drive it in checks.
 *
 * start -> token -> connect (postgres_changes INSERT on realtime_signals for this user) -> healthy on SUBSCRIBED.
 * The token is refreshed before it expires and handed to the live socket (setAuth). A channel error, a timeout or a
 * close reconnects with exponential backoff and jitter; the browser coming back online, or the tab becoming visible,
 * retries at once. After any reconnect `onResync` asks for one re-read, since signals sent while down are not replayed.
 * A token route that says off (feature off, signed out, wrong plane) stops for good: polling alone keeps working.
 * Tokens are never logged or kept beyond the socket.
 */
export type TokenResult={status:'ok';token:RealtimeToken}|{status:'off'}|{status:'retry'};
export type SocketStatus='subscribed'|'error'|'closed';
export type SocketHandlers={onRow(row:unknown):void;onStatus(status:SocketStatus):void};
export type SocketSubscription={setAuth(token:string):void;close():void};
export type RealtimePorts={
 token(plane:RealtimePlane,signal:AbortSignal):Promise<TokenResult>;
 connect(plane:RealtimePlane,token:RealtimeToken,handlers:SocketHandlers):SocketSubscription;
 now():number;
 setTimer(run:()=>void,ms:number):unknown;
 clearTimer(id:unknown):void;
 random():number;
};
export type RealtimeState='idle'|'connecting'|'live'|'retrying'|'off';
export type ControllerOptions={
 plane:RealtimePlane;
 onSignal(kind:SignalKind,ref:string|null):void;
 /** After a reconnect: signals sent while the socket was down are lost, so re-read once. */
 onResync?():void;
 onState?(state:RealtimeState):void;
};
export type RealtimeController={start():void;stop():void;nudge():void;state():RealtimeState;healthy():boolean};

export function createRealtimeController(ports:RealtimePorts,options:ControllerOptions):RealtimeController{
 let state:RealtimeState='idle',stopped=true,attempt=0,generation=0,everLive=false;
 let sub:SocketSubscription|null=null,token:RealtimeToken|null=null;
 let retryTimer:unknown=null,refreshTimer:unknown=null,flushTimer:unknown=null,inflight:AbortController|null=null;
 const pending=new Map<string,{kind:SignalKind;ref:string|null}>();
 const set=(next:RealtimeState)=>{if(state!==next){state=next;options.onState?.(next);}};
 const clear=(id:unknown)=>{if(id!==null)ports.clearTimer(id);};
 const closeSocket=()=>{generation++;const s=sub;sub=null;if(s){try{s.close();}catch{}}};

 async function fetchToken():Promise<TokenResult>{
  inflight?.abort();
  const controller=new AbortController();inflight=controller;
  const timer=ports.setTimer(()=>controller.abort(),REALTIME_TIMING.TOKEN_TIMEOUT_MS);
  try{return await ports.token(options.plane,controller.signal);}
  catch{return {status:'retry'};}
  finally{ports.clearTimer(timer);if(inflight===controller)inflight=null;}
 }
 function goOff(){
  closeSocket();clear(retryTimer);clear(refreshTimer);retryTimer=refreshTimer=null;token=null;set('off');
 }
 function scheduleRetry(){
  if(stopped||state==='off')return;
  clear(retryTimer);
  const delay=backoffDelay(attempt++,ports.random);
  set('retrying');
  retryTimer=ports.setTimer(()=>{retryTimer=null;void connect();},delay);
 }
 function scheduleRefresh(){
  clear(refreshTimer);
  if(!token)return;
  refreshTimer=ports.setTimer(()=>{refreshTimer=null;void refresh();},refreshDelay(token.expiresAt,ports.now()));
 }
 async function refresh(){
  if(stopped||!token)return;
  const result=await fetchToken();
  if(stopped)return;
  if(result.status==='off'){goOff();return;}
  if(result.status==='retry'){
   // Keep the socket while the current token lasts; ask again soon, then reconnect if it has expired.
   clear(refreshTimer);
   refreshTimer=ports.setTimer(()=>{refreshTimer=null;if(token&&token.expiresAt*1000<=ports.now()){closeSocket();scheduleRetry();}else void refresh();},backoffDelay(Math.min(attempt,5),ports.random));
   return;
  }
  if(result.token.userId!==token.userId){
   // Another account on this plane: a new subscription for that user only.
   token=result.token;closeSocket();open();return;
  }
  token=result.token;
  try{sub?.setAuth(token.accessToken);}catch{closeSocket();scheduleRetry();return;}
  scheduleRefresh();
 }
 function onRow(row:unknown){
  if(!token)return;
  const signal=parseSignal(row,token.userId);
  if(!signal)return;
  pending.set(`${signal.kind}\u0000${signal.ref??''}`,signal);
  if(flushTimer!==null)return;
  flushTimer=ports.setTimer(()=>{
   flushTimer=null;
   const batch=[...pending.values()];pending.clear();
   for(const s of batch){try{options.onSignal(s.kind,s.ref);}catch{}}
  },REALTIME_TIMING.COALESCE_MS);
 }
 function open(){
  if(!token)return;
  const mine=++generation;
  set('connecting');
  try{
   sub=ports.connect(options.plane,token,{
    onRow:row=>{if(mine===generation)onRow(row);},
    onStatus:status=>{
     if(mine!==generation||stopped)return;
     if(status==='subscribed'){
      const resync=everLive;
      attempt=0;everLive=true;set('live');
      if(resync){try{options.onResync?.();}catch{}}
      return;
     }
     closeSocket();scheduleRetry();
    },
   });
  }catch{sub=null;scheduleRetry();return;}
  scheduleRefresh();
 }
 async function connect(){
  if(stopped)return;
  set('connecting');
  const result=await fetchToken();
  if(stopped)return;
  if(result.status==='off'){goOff();return;}
  if(result.status==='retry'){scheduleRetry();return;}
  token=result.token;closeSocket();open();
 }
 return {
  start(){if(!stopped)return;stopped=false;attempt=0;void connect();},
  stop(){
   stopped=true;inflight?.abort();inflight=null;
   clear(retryTimer);clear(refreshTimer);clear(flushTimer);retryTimer=refreshTimer=flushTimer=null;pending.clear();
   closeSocket();token=null;set('idle');
  },
  nudge(){
   if(stopped||state==='off'||state==='live'||state==='connecting')return;
   clear(retryTimer);retryTimer=null;attempt=0;void connect();
  },
  state:()=>state,
  healthy:()=>state==='live',
 };
}
