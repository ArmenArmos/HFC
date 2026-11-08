import {withRouteLogging} from '@/lib/observability/with-logging';
import{NextResponse}from'next/server';
import{z}from'zod';
import{createClient}from'@/lib/supabase/server';
import{documentResponse}from'@/lib/doctor-completion/document-response';
import{doctorCompletionEnabled}from'@/lib/doctor-completion/config';
import{openMemberDocument,type DocumentRpc}from'@/lib/doctor-completion/document-runtime';
/** The member's own released clinic PDF. The database checks ownership and the
 * current release, and logs the open before returning the location; the bytes are served from this route after a hash check. */
export const GET=withRouteLogging(async function GET(_request:Request,{params}:{params:Promise<{fileId:string}>}){
 if(!doctorCompletionEnabled())return new NextResponse(null,{status:404});
 const{fileId}=await params;if(!z.uuid().safeParse(fileId).success)return new NextResponse(null,{status:404});
 const target=await openMemberDocument(await createClient() as unknown as DocumentRpc,fileId);
 if(!target)return new NextResponse(null,{status:404});
 return documentResponse(target);
});
