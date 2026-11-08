import {z} from 'zod';
import {withRouteLogging} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {askRequestSchema,conversationReadSchema} from '@/lib/staff-zoe/contracts';
import {POST as ask} from '@/app/staff/real/(review)/zoe/ask/route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
/** Classic doctor Zoe also binds its route to a member, independently of the v2 screen flag.
 * The admitted session, conversation read and turn's DB begin retain the existing Zoe access gates.
 */
export const POST=withRouteLogging(async function POST(request:Request,context:{params:Promise<{memberId:string}>}){
 const refuse=()=>new Response(null,{status:403,headers:{'Cache-Control':'no-store'}});
 if(request.headers.get('origin')!==new URL(request.url).origin)return refuse();
 const {memberId}=await context.params;if(!z.uuid().safeParse(memberId).success)return refuse();
 const {client,identity}=await requireRealStaff();if(identity.role!=='doctor')return refuse();
 try{
  const body=askRequestSchema.safeParse(await request.clone().json());if(!body.success)return refuse();
  const read=await client.rpc('staff_zoe_read',{p_conversation:body.data.conversationId});
  const p=conversationReadSchema.safeParse(read.data);
  if(read.error||!p.success||!p.data.enabled||p.data.id!==body.data.conversationId||p.data.member.id!==memberId)return refuse();
  return ask(request,context);
 }catch{return refuse();}
});
