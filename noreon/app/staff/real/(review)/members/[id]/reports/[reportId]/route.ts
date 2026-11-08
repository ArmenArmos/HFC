import {withRouteLogging} from '@/lib/observability/with-logging';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireRealStaff,snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import {clinicalWriteClient} from '@/lib/patient-care/clinical-publication-server';
export const GET=withRouteLogging(async function GET(_request:Request,{params}:{params:Promise<{id:string;reportId:string}>}){
 const {id,reportId}=await params;
 if(!z.uuid().safeParse(id).success||!z.uuid().safeParse(reportId).success)return new NextResponse(null,{status:404});
 const {client}=await requireRealStaff();
 const result=await client.rpc('patient_clinical_case_snapshot',{p_user_id:id});
 if(result.error||!snapshotSchema.parse(result.data).evidence.reports.some(r=>r.id===reportId))return new NextResponse(null,{status:404});
 // The snapshot read above is recorded as a file open; the report open is recorded on its own.
 if((await client.rpc('staff_record_member_access',{p_member:id,p_surface:'member_report',p_object:reportId})).error)return new NextResponse('Source document unavailable.',{status:503});
 const admin=clinicalWriteClient();
 const report=await admin.from('patient_reports').select('object_path').eq('id',reportId).eq('user_id',id).is('deleted_at',null).maybeSingle();
 if(report.error||!report.data)return new NextResponse(null,{status:404});
 const signed=await admin.storage.from('patient-reports').createSignedUrl(report.data.object_path,60);
 if(signed.error)return new NextResponse('Source document unavailable.',{status:503});
 return NextResponse.redirect(signed.data.signedUrl,{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
});
