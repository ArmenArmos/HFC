import {z} from 'zod';
import {withRouteLogging} from '@/lib/observability/with-logging';
import {patientIdentity} from '@/lib/patient/auth';
import {demoEnabled} from '@/lib/patient/demo';
import {createClient} from '@/lib/supabase/server';
import {markMemberNoticeSeen,memberNoticesInChatEnabled,type MemberNoticesRpc} from '@/lib/zoe/member-notices';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const inputSchema=z.strictObject({id:z.uuid()});

/** A session-scoped acknowledgement. SQL derives the member from auth.uid(). */
export const POST=withRouteLogging(async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(demoEnabled()||!memberNoticesInChatEnabled())return Response.json({error:'unavailable'},{status:404,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'forbidden'},{status:403,headers});
 try{
  if(!await patientIdentity())return Response.json({error:'unauthorized'},{status:401,headers});
  const input=inputSchema.safeParse(await request.json().catch(()=>null));
  if(!input.success)return Response.json({error:'invalid'},{status:400,headers});
  const client=await createClient();
  const result=await markMemberNoticeSeen(client as unknown as MemberNoticesRpc,input.data.id);
  return result==='seen'?Response.json({ok:true},{headers}):Response.json({error:'unavailable'},{status:result==='failed'?503:404,headers});
 }catch{return Response.json({error:'unavailable'},{status:503,headers});}
});
