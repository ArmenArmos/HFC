import 'server-only';
import {z} from 'zod';
import {completeVerifiedPhone,reportVerifiedPhone} from '@/lib/messaging/twilio-verify-feedback';
import {untilAbort} from './native-journey';
const payload=z.object({phone:z.string().regex(/^\+374[0-9]{8}$/),token:z.string().regex(/^[0-9]{6}$/),type:z.literal('sms')}).strict();
type Result={error:unknown;data:{user:{phone?:string}|null;session:Record<string,unknown>|null}};
export function createNativeVerifyPhoneHandler(deps:{enabled:()=>boolean;verify:(phone:string,code:string,signal:AbortSignal)=>Promise<Result>;feedback?:typeof reportVerifiedPhone;deadlineMs?:number}){
 return async(request:Request):Promise<Response>=>{
  const response=(status:number,value:unknown={msg:'Phone verification unavailable',code:'verification_failed'})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Pragma':'no-cache'}});
  if(!deps.enabled())return response(404);
  if(request.method!=='POST')return response(405);
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return response(415);
  const controller=new AbortController(),abort=()=>controller.abort();
  if(request.signal.aborted)controller.abort();else request.signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,deps.deadlineMs??10_000);
  try{
   const reader=request.body?.getReader();if(!reader)return response(400);
   const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await untilAbort(reader.read(),controller.signal);if(part.done)break;size+=part.value.byteLength;if(size>1024){void reader.cancel().catch(()=>{});return response(413);}chunks.push(part.value);}}finally{reader.releaseLock();}
   const parsed=payload.safeParse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));if(!parsed.success)return response(400);
   const input=parsed.data,result=await untilAbort(deps.verify(input.phone,input.token,controller.signal),controller.signal);
   if(!result.data.session||typeof result.data.session.access_token!=='string'||typeof result.data.session.refresh_token!=='string')return response(400);
   if(!await completeVerifiedPhone(input.phone,input.token,result,async(phone,code)=>{
    if(controller.signal.aborted)return;
    try{await untilAbort((deps.feedback??reportVerifiedPhone)(phone,code,controller.signal),controller.signal);}catch{/* Feedback cannot invalidate the consumed OTP and confirmed session. */}
   }))return response(400);
   // Preserve the Supabase SDK's native session parsing and secure persistence.
   return response(200,{...result.data.session,user:result.data.user});
  }catch{return response(controller.signal.aborted?503:400);}finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
 };
}
