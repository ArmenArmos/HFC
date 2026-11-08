import {clinicLocale} from '@/lib/clinic-portal/locale';
import{redirect}from'next/navigation';import type{Route}from'next';import{requireClinicPortal}from'@/lib/clinic-portal/identity';import{ClinicShell}from'@/components/clinic-portal/shell';
import{readClinicPatients}from'@/lib/clinic-admin/record';import{MemberRecordsList}from'@/components/clinic-portal/member-record-forms';
/** Clinic admin full access: the clinic's members (assigned to its doctors or nurses, or booked with it).
 * The database switch and the admin role are checked in SQL; this page only renders what comes back. */
export default async function ClinicMemberRecordsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const query=await searchParams,locale=await clinicLocale(query.locale),t=(en:string,hyText:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hyText:en;
 const context=await requireClinicPortal(typeof query.clinic==='string'?query.clinic:null,{page:true}),clinicId=context.identity.clinicId;
 if(context.identity.capability!=='clinic_admin')redirect(`/clinic/real/bookings?clinic=${clinicId}&locale=${locale}` as Route);
 const result=await readClinicPatients(context.rpc,clinicId);
 return <ClinicShell identity={context.identity} locale={locale} current="records">
  <div className="space-y-2"><h1 className="text-h1">{t('Member records','Անդամների քարտեր','Карты участников')}</h1>
   <p className="text-body2 text-muted-foreground">{t('Members cared for by your clinic’s doctors and nurses, or booked with your clinic. Opening a record is recorded.','Անդամներ, որոնց խնամում են ձեր կլինիկայի բժիշկներն ու բուժքույրերը, կամ որոնք այց են գրանցել ձեր կլինիկայում։ Քարտի բացումը գրանցվում է։','Участники, которых наблюдают врачи и медсёстры вашей клиники или которые записались в неё на приём. Открытие карты фиксируется.')}</p></div>
  {result.status==='loaded'?<MemberRecordsList clinicId={clinicId} locale={locale} rows={result.patients} maskedMembers={result.maskedMembers}/>
  :<p role={result.status==='disabled'?'status':'alert'} className="rounded-lg border bg-background p-5 text-body2">{result.status==='disabled'?t('Full member records are not switched on for clinics yet.','Անդամների ամբողջական քարտերը կլինիկաների համար դեռ միացված չեն։','Полные карты участников для клиник пока не включены.'):result.status==='forbidden'?t('Only clinic admins can open member records.','Անդամների քարտերը կարող են բացել միայն կլինիկայի ադմինիստրատորները։','Открывать карты участников могут только администраторы клиники.'):t('Member records could not load. Try again.','Անդամների քարտերը չհաջողվեց բեռնել։ Նորից փորձեք։','Не удалось загрузить карты участников. Попробуйте снова.')}</p>}
 </ClinicShell>;
}
