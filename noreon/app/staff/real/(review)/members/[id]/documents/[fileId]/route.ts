import {withRouteLogging} from '@/lib/observability/with-logging';
import{NextResponse}from'next/server';
import{z}from'zod';
import{requireRealStaff}from'@/lib/patient-care/clinical-case-repository';
import{documentResponse}from'@/lib/doctor-completion/document-response';
import{doctorCompletionEnabled}from'@/lib/doctor-completion/config';
import{openDoctorDocument,type DocumentRpc}from'@/lib/doctor-completion/document-runtime';
/** Audited doctor view of a member's clinic PDF: the database logs the open
 * before returning the location; the bytes are served from this route after a hash check. */
export const GET=withRouteLogging(async function GET(request:Request,{params}:{params:Promise<{id:string;fileId:string}>}){
 if(!doctorCompletionEnabled())return new NextResponse(null,{status:404});
 const{id,fileId}=await params;if(!z.uuid().safeParse(id).success||!z.uuid().safeParse(fileId).success)return new NextResponse(null,{status:404});
 const{client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return new NextResponse(null,{status:404});
 const target=await openDoctorDocument(client as unknown as DocumentRpc,id,fileId);
 if(!target)return new NextResponse(null,{status:404});
 const page=z.coerce.number().int().min(1).max(500).safeParse(new URL(request.url).searchParams.get('page'));
 return documentResponse(target,page.success?page.data:undefined);
});
