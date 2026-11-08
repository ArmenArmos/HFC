import {readClinicUploadBody} from '@/lib/clinic-portal/upload-server';
import {sameWorkspaceOrigin} from '@/lib/staff/request';
import {zoeModelCallsEnabled} from '@/lib/zoe/gateway';
import {bpPhotoEnabled,BP_PHOTO_MAX_BYTES} from './config';
import type {BpPhotoResult} from './reader';
const headers={'Cache-Control':'private, no-store'};
type Deps={env:Record<string,string|undefined>;member:()=>Promise<string|null>;limit:(member:string)=>Promise<boolean>;
 read:(bytes:Uint8Array,mediaType:'image/jpeg'|'image/png')=>Promise<BpPhotoResult>};
/** Bounded raw bytes, in memory only. Deliberately no request/body tracing or error logging. */
export function createBpPhotoPost(deps:Deps){return async(request:Request):Promise<Response>=>{
 const reply=(body:BpPhotoResult,status=200)=>Response.json(body,{status,headers});
 if(!bpPhotoEnabled(deps.env))return reply({status:'unavailable'},404);
 if(!sameWorkspaceOrigin(request))return reply({status:'unavailable'},403);
 try{
  const member=await deps.member();
  if(!member)return reply({status:'unavailable'},401);
  if(!await deps.limit(member))return reply({status:'unavailable'},429);
  if(!zoeModelCallsEnabled(deps.env))return reply({status:'unavailable'});
  const length=request.headers.get('content-length');
  if(length&&(!/^\d+$/.test(length)||Number(length)>BP_PHOTO_MAX_BYTES))return reply({status:'unclear'},413);
  let bytes:Uint8Array;
  try{bytes=await readClinicUploadBody(request.body,BP_PHOTO_MAX_BYTES);}catch{return reply({status:'unclear'},413);}
  const mediaType=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':
   bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)?'image/png':null;
  if(!mediaType)return reply({status:'unclear'},415);
  return reply(await deps.read(bytes,mediaType));
 }catch{return reply({status:'unavailable'});}
};}
