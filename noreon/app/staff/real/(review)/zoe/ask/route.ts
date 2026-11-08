import {notFound} from 'next/navigation';
import {withRouteLogging} from '@/lib/observability/with-logging';
import {log} from '@/lib/observability/logger';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {staffLocale} from '@/lib/staff/staff-locale';
import {askRequestSchema,type StreamEvent} from '@/lib/staff-zoe/contracts';
import {staffTurnPorts} from '@/lib/staff-zoe/server';
import {runStaffTurn} from '@/lib/staff-zoe/turn';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'no-store','Content-Type':'application/x-ndjson; charset=utf-8','X-Content-Type-Options':'nosniff'};

/**
 * One turn of Doctor Zoe as a stream of JSON lines: the cards first, then the checked answer. The session is checked here
 * and the database checks it again on every read. Only a same-origin POST: the session cookie is SameSite=Lax, and this
 * route spends money.
 */
export const POST=withRouteLogging(async function POST(request:Request,context?:{params:Promise<{memberId?:string}>}){
 if(request.headers.get('origin')!==new URL(request.url).origin)return new Response(null,{status:403});
 const {client,identity}=await requireRealStaff();
 if(identity.role==='admin')notFound();
 let body:unknown;try{body=await request.json();}catch{return new Response(null,{status:400});}
 const parsed=askRequestSchema.safeParse(body);
 if(!parsed.success)return new Response(null,{status:400});
 const locale=parsed.data.locale??await staffLocale(identity.role);
 const routeMemberId=context?(await context.params).memberId:null;
 // Doctor turns require the patient route's binding. The general home has no member context.
 if(identity.role==='doctor'&&!routeMemberId)return new Response(null,{status:403,headers:{'Cache-Control':'no-store'}});
 const ports=staffTurnPorts(client as never,locale);
 const begin=ports.begin;
 ports.begin=async req=>{
  const result=await begin(req);
  if(result.ok&&routeMemberId&&result.memberId!==routeMemberId)return {ok:false,code:'access'};
  // Only a newly accepted DB turn is logged. The member and role are authoritative DB values,
  // never browser selection state; rejected/replayed submissions do not create another event.
  if(result.ok)log.info('staff_zoe.ask.accepted',{
   actor_kind:'staff',actor_id:identity.id,staff_role:result.role,
   conversation_id:req.conversationId,member_id:result.memberId,run_id:result.runId,submission_id:req.submissionId,
  });
  return result;
 };
 const encoder=new TextEncoder();
 const send=(c:ReadableStreamDefaultController<Uint8Array>,e:StreamEvent)=>c.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
 return new Response(new ReadableStream<Uint8Array>({
  async start(controller){
   try{for await(const event of runStaffTurn(parsed.data,locale,ports))send(controller,event);}
   catch{send(controller,{type:'refused',code:'unavailable'});}
   controller.close();
  },
 }),{headers});
});
