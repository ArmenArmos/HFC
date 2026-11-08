"use client";
import {useEffect,useRef,useState} from 'react';
import {AudioLines,Square} from 'lucide-react';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {staffVoiceNeedsReview} from '@/lib/staff-zoe/typed-boundary';
import {URGENT_TEXT} from '@/lib/zoe/symptoms/intake';
import {useHydrated} from '@/components/patient/use-hydrated';
import {ConversationController,type ConversationPhase,type ConversationTranscript} from './conversation-controller';
import {captureConversation,conversationSupported,playConversation,playConversationStream,transcribeConversation} from './conversation-browser';
/** WP V: push-to-talk for every role; staff composers pass the staff endpoint. Re-exported so every chat has one voice import. */
export {Microphone as VoiceMicrophone} from './microphone';

type Options={enabled:boolean;disabled:boolean;locale:PatientLocale;audience?:'member'|'staff';contextKey?:string;onTranscript:(result:ConversationTranscript)=>void;onSend:()=>void;reply:{key:string;text:string|(()=>string);locale?:PatientLocale}|null;urgentKey:string|null;failureKey?:string|null;
 /** WP V: the server says Gemini Live streaming transcription is available for this surface. Any failure falls back to recorded turns. */
 live?:boolean;
 /** WP V: speak replies through the streaming speech route (falls back to the per-chunk route). */
 streamSpeech?:boolean;
 /** WP V: the transcript of the turn being spoken, live (Live sessions only). */
 onPartial?:(text:string)=>void};
type Engine={active:boolean;phase:string;start():Promise<void>;stop():void;hidden():void;error():void;edit():void;sent():void;reply(text:string):void;emergency():void};
export type ConversationSnapshotPhase=ConversationPhase|'connecting';
export function useConversation(options:Options){
 const callbacks=useRef(options);const [snapshot,setSnapshot]=useState<{phase:ConversationSnapshotPhase;seconds:number}>({phase:'off',seconds:0});
 const [partial,setPartial]=useState('');
 const [pendingSend,setPendingSend]=useState({id:0,urgent:false});const handledSend=useRef(0),replyBaseline=useRef<string|null>(null),urgentBaseline=useRef<string|null>(null),failureBaseline=useRef<string|null>(null);
 const controller=useRef<ConversationController|null>(null);
 // WP V: the Live engine, loaded only when the server offers it; null until loaded, and for good after a fallback.
 const live=useRef<Engine|null>(null),liveFailed=useRef(false);
 const engine=():Engine=>live.current&&!liveFailed.current&&live.current.active?live.current:controller.current!;
 const speechEndpoint=()=>callbacks.current.audience==='staff'?'/api/staff/zoe/speech':undefined;
 const play=(text:string,signal:AbortSignal)=>callbacks.current.streamSpeech
  ?playConversationStream(text,callbacks.current.reply?.locale??callbacks.current.locale,signal,callbacks.current.audience==='staff'?'/api/staff/zoe/speech-stream':undefined,speechEndpoint())
  :playConversation(text,callbacks.current.reply?.locale??callbacks.current.locale,signal,speechEndpoint());
 useEffect(()=>{controller.current=new ConversationController({
  capture:captureConversation,transcribe:(blob,ms,signal)=>transcribeConversation(blob,ms,callbacks.current.locale,signal,callbacks.current.audience==='staff'?'/api/staff/zoe/voice':undefined),
  play,emergencyText:()=>URGENT_TEXT[callbacks.current.locale],
  memberEmergency:options.audience!=='staff',autoSend:result=>callbacks.current.audience!=='staff'||!staffVoiceNeedsReview(result.text),
  onTranscript:result=>callbacks.current.onTranscript(result),onSend:urgent=>setPendingSend(value=>({id:value.id+1,urgent:!!urgent})),onState:(phase,seconds)=>{if(!live.current?.active)setSnapshot({phase,seconds});},
 });return ()=>controller.current!.stop();
 // play reads the latest options through the callbacks ref.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[options.audience]);
 // WP V: build the Live engine lazily, so a surface without Live never loads the Live client.
 useEffect(()=>{
  if(!options.live)return;
  let cancelled=false;
  void Promise.all([import('./live-controller'),import('./live-audio')]).then(([{LiveController},audio])=>{
   if(cancelled||!audio.liveSupported())return;
   const staff=callbacks.current.audience==='staff';
   live.current=new LiveController({
    connect:(handlers,signal)=>audio.connectLive({endpoint:staff?'/api/staff/zoe/live-token':'/api/patient/zoe/live-token',locale:callbacks.current.locale,callbacks:handlers,signal}),
    screen:async(text,signal)=>{
     if(staff)return {urgent:false};
     const {screenLiveTranscript}=await import('@/lib/zoe-chat-actions/voice-actions');
     if(signal.aborted)throw Error('Screening cancelled');
     const result=await screenLiveTranscript(text);
     if(result.status!=='ok')throw Error('Screening unavailable');
     return {urgent:result.urgent};
    },
    play,emergencyText:()=>URGENT_TEXT[callbacks.current.locale],memberEmergency:!staff,
    autoSend:result=>!staff||!staffVoiceNeedsReview(result.text),
    onPartial:text=>{setPartial(text);callbacks.current.onPartial?.(text);},
    onTranscript:result=>{setPartial('');callbacks.current.onTranscript(result);},
    onSend:urgent=>setPendingSend(value=>({id:value.id+1,urgent:!!urgent})),
    onState:(phase,seconds)=>{if(phase!=='listening')setPartial('');if(!liveFailed.current)setSnapshot({phase,seconds});},
    // Silent fallback: the recorded controller carries on with this conversation.
    fallback:()=>{liveFailed.current=true;setPartial('');if(callbacks.current.enabled&&!callbacks.current.disabled)void controller.current!.start();else setSnapshot({phase:'off',seconds:0});},
   });
  }).catch(()=>{liveFailed.current=true;});
  return ()=>{cancelled=true;live.current?.stop();live.current=null;};
 // play reads the latest options through the callbacks ref.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[options.live,options.audience]);
 useEffect(()=>{callbacks.current=options;});
 const stopAll=()=>{live.current?.stop();controller.current!.stop();};
 // This effect sees the committed draft/receipt. A known urgent turn must still send if playback fails or finishes first.
 useEffect(()=>{if(pendingSend.id===handledSend.current)return;handledSend.current=pendingSend.id;if(pendingSend.urgent||engine().active)options.onSend();},[pendingSend,options]);
 useEffect(()=>{const leave=()=>{live.current?.hidden();controller.current!.hidden();},visibility=()=>{if(document.hidden)leave();};
  window.addEventListener('pagehide',leave);window.addEventListener('cv2-local-playback',leave);document.addEventListener('visibilitychange',visibility);
  return ()=>{stopAll();window.removeEventListener('pagehide',leave);window.removeEventListener('cv2-local-playback',leave);document.removeEventListener('visibilitychange',visibility);};
  
 },[]);
 useEffect(()=>{const c=engine();if(!options.enabled)stopAll();else if(options.disabled){if(options.urgentKey&&c.active)c.emergency();else stopAll();}
  
 },[options.enabled,options.disabled,options.urgentKey]);
  
 useEffect(()=>{stopAll();},[options.locale,options.contextKey]);
 useEffect(()=>{
  const c=engine();
  if(!c.active)return;
  if(options.urgentKey&&options.urgentKey!==urgentBaseline.current){urgentBaseline.current=options.urgentKey;c.emergency();}
  
 },[options.urgentKey]);
 useEffect(()=>{
  const c=engine();
  if(!c.active||!options.reply||options.reply.key===replyBaseline.current)return;
  replyBaseline.current=options.reply.key;c.reply(typeof options.reply.text==='function'?options.reply.text():options.reply.text);
  
 },[options.reply]);
 useEffect(()=>{
  const c=engine();
  if(c.active&&options.failureKey&&options.failureKey!==failureBaseline.current)c.error();
  failureBaseline.current=options.failureKey??null;
  
 },[options.failureKey]);
 // Questionnaire and safety-card journeys may reveal an emergency inside their own local state.
 // Observe their existing rendered marker, rather than introducing another clinical matcher.
 const running=!['off','error'].includes(snapshot.phase);
 useEffect(()=>{
  if(options.audience==='staff'||!running||typeof MutationObserver==='undefined')return;
  const root=document.querySelector('[data-chat-v2]');if(!root)return;
  const check=()=>{if(root.querySelector('[data-zoe-emergency-card]'))engine().emergency();};
  const observer=new MutationObserver(check);observer.observe(root,{childList:true,subtree:true});check();
  return ()=>observer.disconnect();
  
 },[running,options.audience]);
 const toggle=()=>{
  const c=engine();
  if(c.active)stopAll();else{
   replyBaseline.current=options.reply?.key??null;urgentBaseline.current=options.urgentKey;failureBaseline.current=options.failureKey??null;
   window.dispatchEvent(new Event('cv2-conversation-playback'));
   const next:Engine=live.current&&!liveFailed.current?live.current:controller.current!;
   void next.start().then(()=>{if(options.urgentKey)engine().emergency();});
  }
 };
 /** Speaks a code-written line (a read-back or a result) while waiting, then listens again. */
 const say=(text:string)=>engine().reply(text);
 return {...snapshot,partial,active:!['off','error'].includes(snapshot.phase),toggle,edit:()=>engine().edit(),sent:()=>engine().sent(),say};
}
export function ConversationToggle({locale:l,disabled,conversation}:{locale:PatientLocale;disabled:boolean;conversation:Pick<ReturnType<typeof useConversation>,'phase'|'seconds'|'active'|'toggle'>&Partial<Pick<ReturnType<typeof useConversation>,'partial'|'edit'|'sent'|'say'>>}){
 const hydrated=useHydrated();if(!hydrated||!conversationSupported())return null;
 const {phase,seconds,active}=conversation;
 const status=phase==='connecting'?tx(l,'Միանում եմ։ Մի պահ։','Connecting. One moment.','Подключаюсь. Одну минуту.'):
 phase==='listening'?tx(l,'Լսում եմ։ Դադար տվեք՝ ուղարկելու համար։','Listening. Pause when you finish.','Слушаю. Сделайте паузу, когда закончите.'):
 phase==='transcribing'?tx(l,'Ձայնագրությունը տեքստի է վերածվում…','Turning your recording into text…','Преобразуем запись в текст…'):
 phase==='review'?tx(l,`Կուղարկվի ${seconds} վայրկյանից։ Հպեք տեքստին՝ խմբագրելու համար։`,`Sending in ${seconds} seconds. Tap your message to edit.`,`Отправка через ${seconds} сек. Нажмите на текст, чтобы изменить.`):
 phase==='paused'?tx(l,'Խմբագրեք և ուղարկեք, երբ պատրաստ լինեք։','Edit and send when you are ready.','Измените текст и отправьте, когда будете готовы.'):
 phase==='waiting'?tx(l,'Սպասում եմ Զոյայի պատասխանին…','Waiting for Zoe’s reply…','Жду ответа Зои…'):
 phase==='speaking'||phase==='emergency'?tx(l,'Զոյան խոսում է։','Zoe is speaking.','Зоя говорит.'):
 phase==='error'?tx(l,'Ձայնային զրույցը դադարեց։ Կարող եք գրել։','Voice conversation stopped. You can type your message.','Голосовой разговор остановлен. Вы можете написать сообщение.'):null;
 return <div className="cv2-voice"><button type="button" className="cv2-conversation" aria-pressed={active} disabled={disabled&&!active} onClick={conversation.toggle} aria-label={active?tx(l,'Ավարտել ձայնային զրույցը','End voice conversation','Завершить голосовой разговор'):tx(l,'Սկսել ձայնային զրույցը','Start voice conversation','Начать голосовой разговор')}>
  {active?<Square size={20} aria-hidden/>:<AudioLines size={22} aria-hidden/>}
 </button>{status&&<p className="cv2-voice-status" role={phase==='error'?'alert':'status'}>{status}</p>}
 {/* WP V: what the person is saying, as Live hears it; read politely so it never talks over the status line. */}
 {active&&phase==='listening'&&conversation.partial&&<p className="cv2-voice-caption" aria-live="polite" lang={l}>{conversation.partial}</p>}</div>;
}
