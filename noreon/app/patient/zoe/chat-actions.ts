'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {after} from 'next/server';
import {redirect} from 'next/navigation';
import {patientIdentity} from '@/lib/patient/auth';
import {symptomRedFlagRoute,zoeTextRoute,zoeEmergencyCardEnabled} from '@/lib/zoe/member-screen';
import {requestZoeSweep} from '@/lib/zoe/sweep-trigger';
import {ZOE_CHAT_MAX,type ZoeSendResult,type ZoeThread} from '@/lib/zoe/app-chat-contracts';
import {enrolForZoeChat} from '@/lib/patient-care/enrolment';
import {readIntakeState,readZoeThread,readZoeThreadState,screenNewMessages,storeNewTopic,utf16Length} from '@/lib/zoe/app-chat';
import {storeMessageWithVoiceReceipt} from '@/lib/zoe-chat-actions/voice-message';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How long an urgent message may take to store before the 103 screen opens anyway. */
const URGENT_STORE_MS=3000;

/**
 * Stores the message; with no clinical case yet, enrols the member first and stores the same request id
 * (it was refused, so nothing is replayed twice). Used for urgent text too, inside its bounded wait.
 * Lead, 18 Oct 23:15.
 */
async function storeOrEnrol(requestId:string,text:string,toDoctor:boolean,voiceReceipt?:unknown){
 const stored=await storeMessageWithVoiceReceipt(requestId,text,toDoctor,voiceReceipt);
 if(!stored.ok&&stored.code==='needs_review_request'&&await enrolForZoeChat())return storeMessageWithVoiceReceipt(requestId,text,toDoctor,voiceReceipt);
 return stored;
}

/**
 * Red wins over everything, a malformed request id included (Fable F3); only a valid id is stored. Urgent text is stored
 * within the bounded wait and opens shared 103 guidance (inline only for a capable flagged chat); any other text comes back with its route, and nothing is stored.
 */
async function redFirst(requestId:string,text:string,toDoctor:boolean,inlineEmergency=false,voiceReceipt?:unknown){
 const route=zoeTextRoute(text);
 const symptomRed=route!=='urgent'&&symptomRedFlagRoute(text,await readIntakeState().catch(()=>null));
 if(route==='urgent'||symptomRed){
  if(typeof requestId==='string'&&uuid.test(requestId)&&utf16Length(text)<=ZOE_CHAT_MAX){
   const stored=await Promise.race([storeOrEnrol(requestId,text,toDoctor,voiceReceipt),new Promise<null>(resolve=>setTimeout(()=>resolve(null),URGENT_STORE_MS))]).catch(()=>null);
   // The sweep stops any intake and raises the care-team alert for a symptom red flag.
   if(stored?.ok){
    after(async()=>{await screenNewMessages();await requestZoeSweep();});
    // The id names this text only once it is stored or replayed. Otherwise it may be another message's, so the screen gets none.
    if(inlineEmergency&&zoeEmergencyCardEnabled())return {status:'urgent' as const,request:requestId};
    redirect(`/patient/zoe/urgent?request=${requestId}`);
   }
  }
  if(inlineEmergency&&zoeEmergencyCardEnabled())return {status:'urgent' as const,request:null};
  redirect('/patient/zoe/urgent');
 }
 return route;
}

/**
 * One member message into their one conversation (the same one as Telegram).
 * Red always wins: urgent words open 103 guidance whatever else happens, after a bounded
 * attempt to store the text so the care team's screening sees it like a Telegram message.
 * While Zoe's symptom intake is on, the symptom red flags count as red too (same deterministic rules
 * the pipeline runs first). Everything else is stored and answered by the Zoe sweep, which this
 * request asks for right after storing (through the cron endpoint): Zoe's guarded answer or next
 * symptom question, or the doctor's approved reply later. No model call happens in this request.
 */
export const sendZoeChatMessage=loggedAction("sendZoeChatMessage",async function sendZoeChatMessage(requestId:string,raw:string,toDoctor:boolean=false,inlineEmergency:boolean=false,voiceReceipt?:unknown):Promise<ZoeSendResult>{
 const text=typeof raw==='string'?raw:'';
 const validId=typeof requestId==='string'&&uuid.test(requestId);
 // Before the session check, as on a card: an ended session never costs the 103 screen.
 const route=await redFirst(requestId,text,toDoctor,inlineEmergency,voiceReceipt);
 if(typeof route==='object')return route;
 // Told in the composer, with the text kept; a redirect here would lose it (BC-05).
 if(!await patientIdentity())return {status:'sign_in_again'};
 if(route==='empty')return {status:'empty'};
 if(!validId)return {status:'failed'};
 if(utf16Length(text)>ZOE_CHAT_MAX)return {status:'too_long'};
 // The write path is dark with the read path (Fable F4): switched off, no new app text. A member
 // the thread refuses still reaches conversation_receive, which says why (review request first,
 // not eligible, sign in again) so the screen can tell them what to do.
 const state=await readZoeThreadState();
 if(state==='unavailable')return {status:'unavailable'};
 if(state==='failed')return {status:'failed'};
 const stored=await storeOrEnrol(requestId,text,toDoctor,voiceReceipt);
 if(!stored.ok)return {status:stored.code==='invalid'?'failed':stored.code};
 after(async()=>{await screenNewMessages();await requestZoeSweep();});
 return {status:'sent',thread:await readZoeThread()};
});

/**
 * The chat's red check alone, for a path that can refuse a text before it reaches the chat's send (a Zoe card that is
 * busy, closed or unavailable). No sign-in check first: a lost session must not cost the 103 screen, which opens without
 * one, and every read and store here is the caller's own session, so without one nothing is read or stored.
 */
export const openUrgentIfRed=loggedAction("openUrgentIfRed",async function openUrgentIfRed(requestId:string,raw:string,toDoctor:boolean=false):Promise<void>{
 await redFirst(requestId,typeof raw==='string'?raw:'',toDoctor);
});

/**
 * "New question" (Armen and Khikar, 20 Oct): a divider after the member's newest message in their one conversation. Zoe
 * answers the next message as a new topic, without the earlier turns; the doctor sees the divider too. No model call.
 */
export const startNewZoeQuestion=loggedAction("startNewZoeQuestion",async function startNewZoeQuestion():Promise<{ok:boolean;thread:ZoeThread|null;signedOut?:boolean}>{
 if(!await patientIdentity())return {ok:false,thread:null,signedOut:true};
 const ok=await storeNewTopic();
 return {ok,thread:ok?await readZoeThread():null};
});
