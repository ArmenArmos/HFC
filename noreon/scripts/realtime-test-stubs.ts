// WP R: isolated module boundaries for the sandboxed UI checks that load chat components (stubs only; the realtime and
// offline logic itself is checked by check-realtime-client.ts, check-offline-outbox.ts and check-sw-offline.ts).
// The realtime hook reports an idle socket, so every screen keeps exactly its existing polling; the outbox is absent,
// so every send takes the existing online path.
const idle={state:'idle',healthy:false,healthyRef:{current:false}};
const noNotices={notices:[],push:()=>{},dismiss:()=>{}};
export async function realtimeStubs():Promise<Record<string,unknown>>{
 return {
  '@/components/realtime/use-realtime-signals':{useRealtimeSignals:()=>idle,useSignalNotices:()=>noNotices},
  '@/components/realtime/signal-notices':{SignalNotices:()=>null,noticeText:()=>'',NOTICE_ACTION:{}},
  '@/lib/realtime/contracts':await import('@/lib/realtime/contracts'),
  '@/lib/realtime/poll':await import('@/lib/realtime/poll'),
  '@/components/patient/member-outbox':{memberOutbox:async()=>null},
  '@/lib/offline/outbox':await import('@/lib/offline/outbox'),
  '@/lib/offline/copy':await import('@/lib/offline/copy'),
  '@/lib/clinical/rules/bp-check':await import('@/lib/clinical/rules/bp-check'),
  './offline-banner':{OfflineBanner:()=>null,useOnline:()=>true,useMemberServiceWorker:()=>{}},
  '@/components/chat-v2/offline-banner':{OfflineBanner:()=>null,useOnline:()=>true,useMemberServiceWorker:()=>{}},
 };
}
