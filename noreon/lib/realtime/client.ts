import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {REALTIME_TOKEN_URL,realtimeTokenSchema,type RealtimePlane,type RealtimeToken} from './contracts';
import type {RealtimePorts,SocketHandlers,SocketSubscription,TokenResult} from './controller';

/**
 * WP R: the browser side of the realtime ports. One Supabase client per plane, used for Realtime only (no auth client,
 * no REST reads): its `accessToken` callback returns the token the same-origin token route issued for that plane's
 * session cookie, so RLS on realtime_signals (recipient_user_id = auth.uid()) decides what the socket may receive.
 * The token lives in memory only (never storage, never logs).
 */
type Holder={client:SupabaseClient;token:string|null};
const clients=new Map<RealtimePlane,Holder>();

function holder(plane:RealtimePlane):Holder{
 const existing=clients.get(plane);
 if(existing)return existing;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)throw Error('Realtime is not configured');
 const made:Holder={token:null,client:null as unknown as SupabaseClient};
 made.client=createClient(url,key,{accessToken:async()=>made.token,realtime:{params:{eventsPerSecond:5}}});
 clients.set(plane,made);
 return made;
}

/** The token route's answer: ok, off (feature off, signed out, refused: stop) or retry (busy, offline, timeout). */
export async function fetchRealtimeToken(plane:RealtimePlane,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<TokenResult>{
 let response:Response;
 try{response=await fetcher(`${REALTIME_TOKEN_URL}?plane=${plane}`,{method:'POST',cache:'no-store',credentials:'same-origin',signal});}
 catch{return {status:'retry'};}
 if(response.status===400||response.status===401||response.status===403||response.status===404)return {status:'off'};
 if(!response.ok)return {status:'retry'};
 const parsed=realtimeTokenSchema.safeParse(await response.json().catch(()=>null));
 return parsed.success?{status:'ok',token:parsed.data}:{status:'retry'};
}

export function connectRealtime(plane:RealtimePlane,token:RealtimeToken,handlers:SocketHandlers):SocketSubscription{
 const h=holder(plane);
 h.token=token.accessToken;
 void h.client.realtime.setAuth(token.accessToken);
 const channel=h.client.channel(`signals:${token.userId}:${Math.random().toString(36).slice(2,10)}`)
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'realtime_signals',filter:`recipient_user_id=eq.${token.userId}`},payload=>handlers.onRow(payload.new))
  .subscribe(status=>{
   if(status==='SUBSCRIBED')handlers.onStatus('subscribed');
   else if(status==='CLOSED')handlers.onStatus('closed');
   else handlers.onStatus('error');
  });
 return {
  setAuth(next){h.token=next;void h.client.realtime.setAuth(next);},
  close(){void h.client.removeChannel(channel).catch(()=>undefined);},
 };
}

export const browserRealtimePorts:RealtimePorts={
 token:fetchRealtimeToken,
 connect:connectRealtime,
 now:()=>Date.now(),
 setTimer:(run,ms)=>setTimeout(run,ms),
 clearTimer:id=>clearTimeout(id as ReturnType<typeof setTimeout>),
 random:()=>Math.random(),
};
