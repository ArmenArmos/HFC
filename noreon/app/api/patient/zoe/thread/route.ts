import {memberChatOnlyEnabled} from '@/lib/patient/member-chat-config';
import {readMemberSuggestionState} from '@/lib/chat/suggestion-read';
import {withRouteLogging} from '@/lib/observability/with-logging';
import {patientIdentity} from '@/lib/patient/auth';
import {demoEnabled} from '@/lib/patient/demo';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {readIntakeState,readZoeThread} from '@/lib/zoe/app-chat';
import {zoeEmergencyCardEnabled,zoeEmergencyCheck} from '@/lib/zoe/member-screen';
export const runtime='nodejs';
export const dynamic='force-dynamic';

/**
 * The member's own Zoe thread, for the chat's polling. A GET the browser can abort, not a Server
 * Action: Next runs Server Actions one at a time, so a read frozen while a phone was locked held
 * every later read and send behind it (PR #281 review, 18 Oct). Same read as the page: the
 * member's own session, conversation_member_thread with auth.uid(). Never cached.
 */
export const GET=withRouteLogging(async function GET(){
 const headers={'Cache-Control':'no-store'};
 if(demoEnabled())return Response.json({error:'unavailable'},{status:404,headers});
 try{
  if(!await patientIdentity())return Response.json({error:'unauthorized'},{status:401,headers});
 }catch{return Response.json({error:'unavailable'},{status:503,headers});}
 const [thread,emergencyCheck]=await Promise.all([
  readZoeThread(),
  zoeEmergencyCardEnabled()?readIntakeState().catch(()=>null).then(intake=>zoeEmergencyCheck(intake)):null,
 ]);
 if(thread && (memberChatOnlyEnabled() || (zoeAppV3Enabled() && process.env.NOREON_MEMBER_CHAT_V2==='true')))thread.suggestionState=await readMemberSuggestionState(thread);
 return thread?Response.json({...thread,emergencyCheck},{headers}):Response.json({error:'unavailable'},{status:503,headers});
});
