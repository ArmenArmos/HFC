import Link from 'next/link';
import {notFound,unstable_rethrow} from 'next/navigation';
import {z} from 'zod';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {readNurseVisit,type NurseVisitRpc} from '@/lib/nurse-visit/runtime';
import {nurseVisitSources,type NurseVisitDetail} from '@/lib/nurse-visit/schema';
import {recordNurseVisitMark,recordNurseVisitComplete,recordNurseVisitStep} from '@/lib/nurse-visit/actions';
import {NurseVisitActions} from '@/components/staff/nurse-visit-actions';

export default async function NurseVisitPage({params}:{params:Promise<{memberId:string;source:string;id:string}>}){
 const {memberId,source,id}=await params;
 const parsed=z.object({memberId:z.uuid(),source:z.enum(nurseVisitSources),id:z.uuid()}).safeParse({memberId,source,id});
 if(!parsed.success)notFound();
 const {client,identity}=await requireRealStaffForRender();
 if(identity.role!=='nurse')notFound();
 const locale=await staffLocale(identity.role);
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 let data:NurseVisitDetail|null=null;
 try{data=await readNurseVisit(client as unknown as NurseVisitRpc,parsed.data.memberId,parsed.data.source,parsed.data.id);}catch(error){unstable_rethrow(error);}
 if(data&&'status'in data&&data.status==='access')notFound();
 const back=<Link href="/staff/real/visits" className="inline-flex min-h-11 items-center text-body2 underline">{t('Back to your visits','Վերադառնալ այցերին','Вернуться к вашим визитам')}</Link>;
 if(!data||!('enabled'in data))return <div className="mx-auto max-w-3xl space-y-4">{back}<p role="status" className="rounded-xl border bg-card p-4 text-body2">{t('This visit is unavailable. Reload to check it.','Այս այցն անհասանելի է։ Թարմացրեք էջը՝ ստուգելու համար։','Этот визит недоступен. Обновите страницу, чтобы проверить его.')}</p></div>;
 if(!data.enabled)return <div className="mx-auto max-w-3xl space-y-4">{back}<p role="status" className="rounded-xl border bg-card p-4 text-body2">{t('Nurse visits are not switched on yet.','Բուժքրոջ այցերը դեռ միացված չեն։','Визиты медсестры ещё не включены.')}</p></div>;
 const v=data.visit;
 return <div className="mx-auto max-w-3xl space-y-4">
  {back}
  <header className="space-y-1">
   <p className="text-caption text-muted-foreground">{v.mode==='home'?t('Home visit','Տնային այց','Визит на дом'):v.clinic??t('Clinic visit','Այց կլինիկա','Визит в клинику')}</p>
   <h1 className="text-h1 break-words">{v.memberName}</h1>
   <p className="text-body2">{yerevanStamp(v.startsAt,locale)}{v.endsAt?` – ${yerevanStamp(v.endsAt,locale).split(', ').pop()}`:''}</p>
   {v.location&&<p className="break-words text-body2 text-muted-foreground">{v.location}</p>}
   <Link href={`/staff/real/members/${v.memberId}`} className="inline-flex min-h-11 items-center text-body2 underline">{t('Open the member file','Բացել անդամի քարտը','Открыть карту участника')}</Link>
  </header>
  <NurseVisitActions data={data} locale={locale} mark={recordNurseVisitMark} complete={recordNurseVisitComplete} step={recordNurseVisitStep}
   completeIds={{submissionId:crypto.randomUUID(),visitId:crypto.randomUUID(),openSubmissionId:crypto.randomUUID(),appendSubmissionId:crypto.randomUUID()}}/>
 </div>;
}
