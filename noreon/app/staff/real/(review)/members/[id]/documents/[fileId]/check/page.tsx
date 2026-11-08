import {notFound} from 'next/navigation';
import {z} from 'zod';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {staffLocale} from '@/lib/staff/staff-locale';
import {labAiEnabled} from '@/lib/lab-ai/config';
import {readLab,labRuleBlocks,type LabRpcClient} from '@/lib/lab-ai/doctor-runtime';
import {confirmLabIdentity,requestLabReading,reviewLabValue} from '@/lib/lab-ai/actions';
import {confirmPassingLabValues} from '@/lib/staff-zoe/lab-review-actions';
import {LabAiCheck} from '@/components/staff/lab-ai-check';

/** The assigned doctor checks AI-read lab values beside the clinic PDF (dark). */
// Lab reading scheduled by upload/attach actions uses the cron worker's function budget.
export const maxDuration=300;
export default async function LabAiCheckPage({params}:{params:Promise<{id:string;fileId:string}>}){
 if(!labAiEnabled())notFound();
 const {id,fileId}=await params;
 if(!z.uuid().safeParse(id).success||!z.uuid().safeParse(fileId).success)notFound();
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')notFound();
 const locale=await staffLocale(identity.role);
 const data=await readLab(client as unknown as LabRpcClient,id,fileId);
 if(data==='access')notFound();
 if(!data)throw Error('Lab values are unavailable. Reload to check them.');
 if(!data.enabled)notFound();
 const submissionIds=Object.fromEntries(data.values.flatMap(v=>(['confirm','correct','reject']as const).map(a=>[`${v.valueId}:${a}`,crypto.randomUUID()])));
 return <LabAiCheck ruleBlocks={labRuleBlocks(data)} data={data} memberId={id} locale={locale} submissionIds={submissionIds}
  ports={{confirmPassing:confirmPassingLabValues,review:reviewLabValue.bind(null,id,fileId),confirmIdentity:confirmLabIdentity.bind(null,id,fileId),readAgain:requestLabReading.bind(null,id,fileId)}}/>;
}
