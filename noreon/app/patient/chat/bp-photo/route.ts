import {withRouteLogging} from '@/lib/observability/with-logging';
import {createBpPhotoPost} from '@/lib/bp-photo/route';
import {readBpPhoto} from '@/lib/bp-photo/reader';
import {sessionActor} from '@/lib/zoe-chat-actions/actor';
import {serviceRpc} from '@/lib/zoe-chat-actions/server';
import {rateLimit} from '@/lib/security/rate-limit';
import {purposeRoute} from '@/lib/zoe/purpose-route';
import {parseRouteConfig} from '@/lib/zoe/route-config';
import {createLabGatewayProvider} from '@/lib/lab-ai/provider';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
// The wrapper logs path, status and duration only, never the body.
export const POST=withRouteLogging(createBpPhotoPost({env:process.env,
 member:async()=>{
  const id=(await sessionActor())?.memberId,rpc=serviceRpc();
  // A member, not a staff account, before any model call (Astra, 5 Nov).
  return id&&rpc&&await rpc('bp_photo_member_allowed',{p_member:id})===true?id:null;
 },
 limit:async member=>(await rateLimit('bp_photo',[{kind:'user',value:member}])).ok,
 read:async(bytes,mediaType)=>{
  const rpc=serviceRpc();if(!rpc)return {status:'unavailable'};
  const route=purposeRoute(parseRouteConfig(await rpc('zoe_route_config',{})),'lab_reading');
  return readBpPhoto(bytes,mediaType,{rpc,route,providerFor:model=>createLabGatewayProvider(model),download:async()=>null});
 }}));
