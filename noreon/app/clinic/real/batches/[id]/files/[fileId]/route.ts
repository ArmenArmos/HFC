import {withRouteLogging} from '@/lib/observability/with-logging';
import{requireClinicPortal}from'@/lib/clinic-portal/identity';import{clinicStorageService,readClinicUploadBody}from'@/lib/clinic-portal/upload-server';import{storeClinicOriginal}from'@/lib/clinic-portal/upload-runtime';
import{clinicRequestOriginAllowed}from'@/lib/clinic-portal/config';import{CLINIC_UPLOAD_MAX_BYTES}from'@/lib/clinic-portal/upload-limits';import{rateLimit}from'@/lib/security/rate-limit';
import {scheduleLabRead} from '@/lib/lab-ai/upload-trigger';
export const runtime='nodejs';
export const maxDuration=300;
/** Uploading a file never grants the clinic permission to read it back. */
export const GET=withRouteLogging(async function GET(request:Request,{params}:{params:Promise<{id:string;fileId:string}>}){
 const context=await requireClinicPortal(new URL(request.url).searchParams.get('clinic'));
 const{fileId}=await params;
 try{await context.rpc.rpc('clinic_original_access',{p_file:fileId});}catch{/* fail closed */}
 return new Response(null,{status:403,headers:{'Cache-Control':'private, no-store'}});
});
export const PUT=withRouteLogging(async function PUT(request:Request,{params}:{params:Promise<{id:string;fileId:string}>}){
 const requestStartedAt=Date.now();
 const url=new URL(request.url);if(!clinicRequestOriginAllowed(request))return Response.json({status:'access'},{status:403});const context=await requireClinicPortal(url.searchParams.get('clinic'));if(request.headers.get('x-clinic-ui-scope')!==context.actorScope)return Response.json({status:'access'},{status:403});
 // Generous per-account ceiling: batches are pre-registered, this only stops a runaway client or a stolen session.
 try{const admitted=await rateLimit('clinic_upload',[{kind:'user',value:context.identity.userId}]);if(!admitted.ok)return Response.json({status:'unavailable'},{status:429,headers:{'Cache-Control':'private, no-store','Retry-After':String(admitted.retryAfter)}});}
 catch{return Response.json({status:'unavailable'},{status:503});}
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/pdf')return Response.json({status:'invalid'},{status:400});
 const declared=request.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>CLINIC_UPLOAD_MAX_BYTES))return Response.json({status:'invalid'},{status:413});
 const{id,fileId}=await params;let bytes:Buffer;try{bytes=await readClinicUploadBody(request.body,CLINIC_UPLOAD_MAX_BYTES);}catch{return Response.json({status:'invalid'},{status:400});}
 const result=await storeClinicOriginal({...context,service:clinicStorageService},{batchId:id,fileId,attemptId:request.headers.get('x-clinic-upload-attempt')??'',bytes});
 if(result.status==='stored')scheduleLabRead(result.fileId,requestStartedAt);
 return Response.json(result,{status:result.status==='stored'?200:result.status==='unknown'?202:result.status==='access'?403:result.status==='invalid'?400:503,headers:{'Cache-Control':'private, no-store'}});
});
