import 'server-only';
import {verifyTwilioCallback,type TwilioConfig,type VerifiedDeliveryCallback} from './twilio';
const response=(status:number)=>new Response(null,{status,headers:{'Cache-Control':'no-store'}});
export async function handleTwilioCallback(request:Request,config:TwilioConfig,record:(event:VerifiedDeliveryCallback)=>Promise<boolean>):Promise<Response>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded')return response(415);
 const url=new URL(request.url),attempts=url.searchParams.getAll('attempt');
 if(attempts.length!==1||[...url.searchParams.keys()].some(k=>k!=='attempt'))return response(400);
 const signature=request.headers.get('x-twilio-signature');
 if(!signature||signature.length>256)return response(403);
 const reader=request.body?.getReader();if(!reader)return response(400);
 let body='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 try{
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16_384){await reader.cancel();return response(413);}body+=decoder.decode(part.value,{stream:true});}
  body+=decoder.decode();
 }catch{return response(400);}finally{reader.releaseLock();}
 const event=verifyTwilioCallback(config,attempts[0],signature,body);
 if(!event)return response(403);
 try{return response(await record(event)?204:409);}catch{return response(503);}
}
