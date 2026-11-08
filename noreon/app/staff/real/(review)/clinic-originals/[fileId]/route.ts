import {withRouteLogging} from '@/lib/observability/with-logging';
import{createHash}from'node:crypto';
import{NextResponse}from'next/server';
import{z}from'zod';
import{requireRealAdmin}from'@/lib/staff/real-admin';
import type{ClinicRpc}from'@/lib/clinic-portal/runtime';
import{openClinicOriginal}from'@/lib/clinic-portal/result-attach-runtime';
import{resultAttachEnabled}from'@/lib/clinic-portal/result-attach-schema';
import{clinicalWriteClient}from'@/lib/patient-care/clinical-publication-server';
/** Audited admin view of a clinic original (F2). The database logs the open
 * before returning the location, and the bytes are served from this route
 * rather than a signed link, so every fetch is one audited open (review CF-6).
 * The stored hash and size are checked before anything is sent. */
export const GET=withRouteLogging(async function GET(_request:Request,{params}:{params:Promise<{fileId:string}>}){
 if(!resultAttachEnabled())return new NextResponse(null,{status:404});
 const{fileId}=await params;if(!z.uuid().safeParse(fileId).success)return new NextResponse(null,{status:404});
 const context=await requireRealAdmin();
 const target=await openClinicOriginal(context.client as unknown as ClinicRpc,fileId);
 if(!target)return new NextResponse(null,{status:404});
 const download=await clinicalWriteClient().storage.from(target.bucket).download(target.objectKey);
 if(download.error||!download.data)return new NextResponse('The clinic file is unavailable.',{status:503});
 const bytes=Buffer.from(await download.data.arrayBuffer());
 if(bytes.length!==target.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==target.sha256)return new NextResponse('The clinic file is unavailable.',{status:503});
 return new NextResponse(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="clinic-lab-result.pdf"','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
});
