import {withRouteLogging} from '@/lib/observability/with-logging';
import{NextResponse}from'next/server';
import{requireClinicPortal}from'@/lib/clinic-portal/identity';
import{openClinicMemberPdf}from'@/lib/clinic-scheduling/member-file';
/** Clinic sessions cannot open lab originals. Keep the guarded refusal audit. */
export const GET=withRouteLogging(async function GET(request:Request,{params}:{params:Promise<{memberId:string;fileId:string}>}){
 const{memberId,fileId}=await params;
 const context=await requireClinicPortal(new URL(request.url).searchParams.get('clinic'));
 // Audit the authenticated attempt even when it came from an older page scope.
 await openClinicMemberPdf(context.rpc,context.identity.clinicId,memberId,fileId);
 return new NextResponse(null,{status:403,headers:{'Cache-Control':'private, no-store'}});
});
