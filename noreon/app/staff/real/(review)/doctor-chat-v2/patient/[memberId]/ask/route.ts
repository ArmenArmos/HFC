import {z} from 'zod';
import {withRouteLogging} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {doctorChatV2Enabled} from '@/lib/staff-zoe/workspace-config';
import {askRequestSchema,conversationReadSchema} from '@/lib/staff-zoe/contracts';
import {findDoctorChatQuestionMember} from '@/lib/staff-zoe/chat-v2-actions';
import {POST as ask} from '@/app/staff/real/(review)/zoe/ask/route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
/** Refuse before begin: no accepted turn, record tools or provider call for a different member. */
export const POST=withRouteLogging(async function POST(request:Request,context:{params:Promise<{memberId:string}>}){
 const refuse=()=>new Response(null,{status:403,headers:{'Cache-Control':'no-store'}});
 if(!doctorChatV2Enabled()||request.headers.get('origin')!==new URL(request.url).origin)return refuse();
 const {memberId}=await context.params;
 if(!z.uuid().safeParse(memberId).success)return refuse();
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return refuse();
 try{
  const body=askRequestSchema.safeParse(await request.clone().json());if(!body.success)return refuse();
  const read=await client.rpc('staff_zoe_read',{p_conversation:body.data.conversationId});
  const parsed=conversationReadSchema.safeParse(read.data);
  if(read.error||!parsed.success||!parsed.data.enabled||parsed.data.id!==body.data.conversationId||parsed.data.member.id!==memberId)return refuse();
  const found=await findDoctorChatQuestionMember(body.data.text,identity.id,{memberId,memberName:parsed.data.member.name??''});
  if(found.kind!=='keep'&&!(found.kind==='member'&&found.memberId===memberId))return refuse();
  return ask(request,context);
 }catch{return refuse();}
});
