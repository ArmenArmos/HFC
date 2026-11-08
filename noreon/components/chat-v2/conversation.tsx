"use client";
import {useEffect,useRef,useState} from 'react';
import {AudioLines,Square} from 'lucide-react';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {staffVoiceNeedsReview} from '@/lib/staff-zoe/typed-boundary';
import {URGENT_TEXT} from '@/lib/zoe/symptoms/intake';
import {useHydrated} from '@/components/patient/use-hydrated';
import {ConversationController,type ConversationPhase,type ConversationTranscript} from './conversation-controller';
import {captureConversation,conversationSupported,playConversation,transcribeConversation} from './conversation-browser';

type Options={enabled:boolean;disabled:boolean;locale:PatientLocale;audience?:'member'|'staff';contextKey?:string;onTranscript:(result:ConversationTranscript)=>void;onSend:()=>void;reply:{key:string;text:string|(()=>string);locale?:PatientLocale}|null;urgentKey:string|null;failureKey?:string|null};
export function useConversation(options:Options){
 const callbacks=useRef(options);const [snapshot,setSnapshot]=useState<{phase:ConversationPhase;seconds:number}>({phase:'off',seconds:0});
 const [pendingSend,setPendingSend]=useState({id:0,urgent:false});const handledSend=useRef(0),replyBaseline=useRef<string|null>(null),urgentBaseline=useRef<string|null>(null),failureBaseline=useRef<string|null>(null);
 const controller=useRef<ConversationController|null>(null);
 useEffect(()=>{controller.current=new ConversationController({
  capture:captureConversation,transcribe:(blob,ms,signal)=>transcribeConversation(blob,ms,callbacks.current.locale,signal,callbacks.current.audience==='staff'?'/api/staff/zoe/voice':undefined),
  play:(text,signal)=>playConversation(text,callbacks.current.reply?.locale??callbacks.current.locale,signal,callbacks.current.audience==='staff'?'/api/staff/zoe/speech':undefined),emergencyText:()=>URGENT_TEXT[callbacks.current.locale],
  memberEmergency:options.audience!=='staff',autoSend:result=>callbacks.current.audience!=='staff'||!staffVoiceNeedsReview(result.text),
  onTranscript:result=>callbacks.current.onTranscript(result),onSend:urgent=>setPendingSend(value=>({id:value.id+1,urgent:!!urgent})),onState:(phase,seconds)=>setSnapshot({phase,seconds}),
 });return ()=>controller.current!.stop();},[options.audience]);
 useEffect(()=>{callbacks.current=options;});
 // This effect sees the committed draft/receipt. A known urgent turn must still send if playback fails or finishes first.
 useEffect(()=>{if(pendingSend.id===handledSend.current)return;handledSend.current=pendingSend.id;if(pendingSend.urgent||controller.current!.active)options.onSend();},[pendingSend,options]);
 useEffect(()=>{const c=controller.current!;const leave=()=>c.hidden(),visibility=()=>{if(document.hidden)leave();};
  window.addEventListener('pagehide',leave);window.addEventListener('cv2-local-playback',leave);document.addEventListener('visibilitychange',visibility);
  return ()=>{c.stop();window.removeEventListener('pagehide',leave);window.removeEventListener('cv2-local-playback',leave);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 useEffect(()=>{const c=controller.current!;if(!options.enabled)c.stop();else if(options.disabled){if(options.urgentKey&&c.active)c.emergency();else c.stop();}},[options.enabled,options.disabled,options.urgentKey]);
 useEffect(()=>{controller.current!.stop();},[options.locale,options.contextKey]);
 useEffect(()=>{
  if(!controller.current!.active)return;
  if(options.urgentKey&&options.urgentKey!==urgentBaseline.current){urgentBaseline.current=options.urgentKey;controller.current!.emergency();}
 },[options.urgentKey]);
 useEffect(()=>{
  if(!controller.current!.active||!options.reply||options.reply.key===replyBaseline.current)return;
  replyBaseline.current=options.reply.key;controller.current!.reply(typeof options.reply.text==='function'?options.reply.text():options.reply.text);
 },[options.reply]);
 useEffect(()=>{
  const c=controller.current!;
  if(c.active&&options.failureKey&&options.failureKey!==failureBaseline.current)c.error();
  failureBaseline.current=options.failureKey??null;
 },[options.failureKey]);
 // Questionnaire and safety-card journeys may reveal an emergency inside their own local state.
 // Observe their existing rendered marker, rather than introducing another clinical matcher.
 const running=!['off','error'].includes(snapshot.phase);
 useEffect(()=>{
  if(options.audience==='staff'||!running||typeof MutationObserver==='undefined')return;
  const root=document.querySelector('[data-chat-v2]');if(!root)return;
  const check=()=>{if(root.querySelector('[data-zoe-emergency-card]'))controller.current!.emergency();};
  const observer=new MutationObserver(check);observer.observe(root,{childList:true,subtree:true});check();
  return ()=>observer.disconnect();
 },[running,options.audience]);
 const toggle=()=>{
  const c=controller.current!;
  if(c.active)c.stop();else{
   replyBaseline.current=options.reply?.key??null;urgentBaseline.current=options.urgentKey;failureBaseline.current=options.failureKey??null;
   window.dispatchEvent(new Event('cv2-conversation-playback'));
   void c.start().then(()=>{if(options.urgentKey)c.emergency();});
  }
 };
 return {...snapshot,active:!['off','error'].includes(snapshot.phase),toggle,edit:()=>controller.current!.edit(),sent:()=>controller.current!.sent()};
}
export function ConversationToggle({locale:l,disabled,conversation}:{locale:PatientLocale;disabled:boolean;conversation:ReturnType<typeof useConversation>}){
 const hydrated=useHydrated();if(!hydrated||!conversationSupported())return null;
 const {phase,seconds,active}=conversation;
 const status=phase==='listening'?tx(l,'Լսում եմ։ Դադար տվեք՝ ուղարկելու համար։','Listening. Pause when you finish.','Слушаю. Сделайте паузу, когда закончите.'):
 phase==='transcribing'?tx(l,'Ձայնագրությունը տեքստի է վերածվում…','Turning your recording into text…','Преобразуем запись в текст…'):
 phase==='review'?tx(l,`Կուղարկվի ${seconds} վայրկյանից։ Հպեք տեքստին՝ խմբագրելու համար։`,`Sending in ${seconds} seconds. Tap your message to edit.`,`Отправка через ${seconds} сек. Нажмите на текст, чтобы изменить.`):
 phase==='paused'?tx(l,'Խմբագրեք և ուղարկեք, երբ պատրաստ լինեք։','Edit and send when you are ready.','Измените текст и отправьте, когда будете готовы.'):
 phase==='waiting'?tx(l,'Սպասում եմ Zoe-ի պատասխանին…','Waiting for Zoe’s reply…','Жду ответа Zoe…'):
 phase==='speaking'||phase==='emergency'?tx(l,'Zoe-ն խոսում է։','Zoe is speaking.','Zoe говорит.'):
 phase==='error'?tx(l,'Ձայնային զրույցը դադարեց։ Կարող եք գրել։','Voice conversation stopped. You can type your message.','Голосовой разговор остановлен. Вы можете написать сообщение.'):null;
 return <div className="cv2-voice"><button type="button" className="cv2-conversation" aria-pressed={active} disabled={disabled&&!active} onClick={conversation.toggle} aria-label={active?tx(l,'Ավարտել ձայնային զրույցը','End voice conversation','Завершить голосовой разговор'):tx(l,'Սկսել ձայնային զրույցը','Start voice conversation','Начать голосовой разговор')}>
  {active?<Square size={20} aria-hidden/>:<AudioLines size={22} aria-hidden/>}
 </button>{status&&<p className="cv2-voice-status" role={phase==='error'?'alert':'status'}>{status}</p>}</div>;
}
