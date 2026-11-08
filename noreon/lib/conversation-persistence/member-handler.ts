import 'server-only';
import {realReviewEnabled} from '@/lib/patient-care/real-review-config';
import {memberRequestSchema,memberWorkspaceSchema,receiveResultSchema} from './contracts';
import type {ConversationRepository} from './repository';
type Env=Record<string,string|undefined>;
type Dependency={env:Env;authenticate:()=>Promise<ConversationRepository|null>};
/** Technical local harness only, deliberately not a shipped PWA inbox. */
export async function handleMemberConversation(request:Request,dep:Dependency){
 const host=new URL(request.url).host;
 const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 if(dep.env.NODE_ENV==='production'||dep.env.NOREON_CONVERSATION_HARNESS_ENABLED!=='true'||!realReviewEnabled(dep.env)||!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))return respond({error:'unavailable'},404);
 if(request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'forbidden'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return respond({error:'invalid_request'},400);
 const reader=request.body?.getReader();if(!reader)return respond({error:'invalid_request'},400);
 let bytes=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>40000){await reader.cancel();return respond({error:'request_too_large'},413);}chunks.push(value);}}finally{reader.releaseLock();}
 let input;try{input=memberRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{return respond({error:'invalid_request'},400);}
 try{
  const repo=await dep.authenticate();if(!repo)return respond({error:'unauthenticated'},401);
  const result=input.op==='receive'?receiveResultSchema.parse(await repo.receive(input.command)):memberWorkspaceSchema.parse(await repo.workspace());
  return respond(result);
 }catch{return respond({error:'temporarily_unavailable'},503);}
}
