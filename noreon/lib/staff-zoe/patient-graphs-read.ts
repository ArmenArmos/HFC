import 'server-only';
import {snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import {readStaffBpWeek} from '@/lib/bp-week/server';
import {readStaffLabResults} from '@/lib/lab-ai/staff-results-server';
import {readDoctorUploadOverrides} from '@/lib/staff/doctor-upload-overrides';
import {readMemberUploadApprovals} from '@/lib/lab-ai/member-approval-server';
import {readMemberHistoryForStaff} from '@/lib/member-history/server';
import {readDoctorLdl} from '@/lib/ldl/runtime';
import {readDoctorBpTarget} from '@/lib/bp-target/runtime';
import {bpTargetsEnabled} from '@/lib/clinical-review/config';
import {patientLabs} from './patient-labs';
import {buildPatientGraphs} from './patient-graphs';
import type {DocumentRpc} from '@/lib/doctor-completion/document-runtime';
/** Called only after doctor authentication. Every read uses the session client and the same route member.
 * The audited case read checks current assignment before any optional sources are requested.
 * Reads that lock the case run sequentially, matching staffRecordReader's locking discipline. */
export async function readPatientGraphs(client:DocumentRpc,memberId:string,now:Date){
 const status=await client.rpc('staff_zoe_status');if(status.error||status.data!==true)return null;
 const r=await client.rpc('patient_clinical_case_snapshot',{p_user_id:memberId});
 const parsed=snapshotSchema.safeParse(r.data);
 if(r.error||!parsed.success||parsed.data.id!==memberId)return null;
 const week=await readStaffBpWeek(client,memberId).catch(()=>null);
 const labs=await readStaffLabResults(client,memberId);
 const checks=await readDoctorUploadOverrides(client,memberId);
 const approvals=labs?.enabled?await readMemberUploadApprovals(client,memberId):undefined;
 const history=await readMemberHistoryForStaff(client,memberId);
 const ldl=await readDoctorLdl(client,memberId);
 const target=bpTargetsEnabled()?(await readDoctorBpTarget(client as never,memberId))?.current??null:null;
 // A final audited scope check prevents returning earlier points after assignment is lost mid-read.
 const end=await client.rpc('patient_clinical_case_snapshot',{p_user_id:memberId});
 const confirmed=snapshotSchema.safeParse(end.data);
 if(end.error||!confirmed.success||confirmed.data.id!==memberId)return null;
 const values=labs?.enabled&&checks!==null?patientLabs(labs,checks,approvals??undefined).values:null;
 return buildPatientGraphs(memberId,parsed.data,week,values,history?.values??null,ldl,now,target?{systolic:target.homeSystolicTarget,diastolic:target.homeDiastolicTarget}:null);
}
