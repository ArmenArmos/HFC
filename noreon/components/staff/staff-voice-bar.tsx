'use client';
import {useRef} from 'react';
import '@/components/chat-v2/chat.css';
import {ConversationToggle,useConversation,VoiceMicrophone} from '@/components/chat-v2/conversation';
import {voiceIntent,type VoiceAction} from '@/lib/voice-core/intent';
import {voiceLine} from '@/lib/voice-core/readback';
import type {AppRole} from '@/lib/rbac/roles';
import type {Locale} from '@/lib/locale';

/**
 * Voice for staff surfaces without a free-text assistant (WP V): the Noreon administrator's operations chat, the care
 * coordinator's care queue, and the clinic chat. Push-to-talk and a hands-free toggle (Live streaming transcription when
 * available, recorded turns otherwise). A finished turn is mapped deterministically (lib/voice-core/intent.ts) onto an
 * action the surface handles: it only opens a list or a card. Nothing is written by voice here, and a member is never
 * opened by name. Unrecognised words go to onText (a composer) when the surface has one, else Zoe says what she can open.
 */
export type StaffVoiceBarProps={locale:Locale;role:AppRole;available:boolean;live?:boolean;
 /** Handles an action; true when it opened something. */
 onIntent:(action:VoiceAction)=>boolean;
 /** The surface's own composer, when it has one: unrecognised words are put there and sent. */
 onText?:(text:string)=>void;onSubmit?:(text:string)=>void};
export function StaffVoiceBar({locale:l,role,available,live=false,onIntent,onText,onSubmit}:StaffVoiceBarProps){
 const heard=useRef('');
 const act=(text:string):string=>{
  const action=voiceIntent(text,l,role);
  if(action.kind!=='none'&&onIntent(action))return voiceLine(l,'staffOpened');
  if(onSubmit){onSubmit(text);return '';}
  return voiceLine(l,'staffHelp');
 };
 const conversation=useConversation({enabled:available,disabled:false,locale:l,audience:'staff',contextKey:role,live,streamSpeech:true,urgentKey:null,reply:null,
  onTranscript:result=>{heard.current=result.text;onText?.(result.text);},
  onSend:()=>{const said=act(heard.current);heard.current='';conversation.say(said);}});
 if(!available)return null;
 return <div className="cv2-voicebar" data-staff-voice-bar={role}>
  <VoiceMicrophone locale={l} endpoint="/api/staff/zoe/voice" onBusy={()=>{}} disabled={conversation.active} onTranscript={value=>{act(value);}}/>
  <ConversationToggle locale={l} disabled={false} conversation={conversation}/>
 </div>;
}
