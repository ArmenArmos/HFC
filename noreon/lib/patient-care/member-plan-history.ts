import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {readRealMemberStatus} from './clinical-case-repository';
import {publishedReviewSchema} from './published-review';
import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';
import {readMemberPlanVersions, type DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import {multiMedicineEnabled} from './regimen-config';
import {readMemberRegimens} from './regimen-runtime';

/** One publication/release boundary for the review page and chat's previous-plan viewer. */
export async function readMemberPlanHistory() {
  const result=await readRealMemberStatus();
  if(!result.enabled)return {...result,publications:[],versions:null,regimens:null};
  const client=await createClient();
  const response=await client.rpc('patient_published_clinical_reviews');
  if(response.error)throw Error('Published care history is unavailable. Please try again.');
  const publications=publishedReviewSchema.parse(response.data);
  const versions=doctorCompletionEnabled()?await readMemberPlanVersions(client as unknown as DocumentRpc):null;
  const regimens=multiMedicineEnabled()?await readMemberRegimens(client as never).catch(()=>null):null;
  return {...result,publications,versions,regimens};
}
