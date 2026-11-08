'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {browserRealtimePorts} from '@/lib/realtime/client';
import {createRealtimeController,type RealtimePorts,type RealtimeState} from '@/lib/realtime/controller';
import {isNoticeKind,type NoticeKind,type RealtimePlane,type SignalKind} from '@/lib/realtime/contracts';

/**
 * WP R: subscribe this screen to its realtime signals. A signal only calls onSignal(kind, ref), which re-reads through
 * the screen's existing read; the read stays the source of truth. `healthy` is true while the socket is subscribed, so
 * the screen relaxes its fallback polling (relaxedInterval) and goes back to its normal interval when the socket drops.
 * The token route answers "off" when realtime is switched off or the plane has no session: then nothing else happens.
 */
export function useRealtimeSignals({plane,onSignal,onResync,enabled=true,ports=browserRealtimePorts}:{
 plane:RealtimePlane;
 onSignal:(kind:SignalKind,ref:string|null)=>void;
 /** After a reconnect (signals sent while down are not replayed); defaults to nothing. */
 onResync?:()=>void;
 enabled?:boolean;
 ports?:RealtimePorts;
}){
 const [state,setState]=useState<RealtimeState>('idle');
 const callbacks=useRef({onSignal,onResync});
 useEffect(()=>{callbacks.current={onSignal,onResync};},[onSignal,onResync]);
 const healthyRef=useRef(false);
 useEffect(()=>{
  if(!enabled||typeof window==='undefined')return;
  const controller=createRealtimeController(ports,{
   plane,
   onSignal:(kind,ref)=>callbacks.current.onSignal(kind,ref),
   onResync:()=>callbacks.current.onResync?.(),
   onState:next=>{healthyRef.current=next==='live';setState(next);},
  });
  controller.start();
  const nudge=()=>{if(document.visibilityState==='visible')controller.nudge();};
  window.addEventListener('online',nudge);
  document.addEventListener('visibilitychange',nudge);
  return()=>{
   window.removeEventListener('online',nudge);
   document.removeEventListener('visibilitychange',nudge);
   controller.stop();healthyRef.current=false;
  };
 },[plane,enabled,ports]);
 return {state,healthy:state==='live',healthyRef};
}

/** In-chat notices from signals: one per kind (the newest ref), most recent first, until opened or dismissed. */
export type SignalNotice={id:string;kind:NoticeKind;ref:string|null;count:number};
export function useSignalNotices(){
 const [notices,setNotices]=useState<SignalNotice[]>([]);
 const sequence=useRef(0);
 const push=useCallback((kind:SignalKind,ref:string|null)=>{
  if(!isNoticeKind(kind))return;
  setNotices(previous=>{
   const same=previous.find(n=>n.kind===kind);
   const next={id:same?.id??`signal-${++sequence.current}`,kind,ref,count:(same?.count??0)+1};
   return [next,...previous.filter(n=>n.kind!==kind)];
  });
 },[]);
 const dismiss=useCallback((id:string)=>setNotices(previous=>previous.filter(n=>n.id!==id)),[]);
 return {notices,push,dismiss};
}
