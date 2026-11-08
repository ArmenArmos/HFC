import {clinicLocale} from '@/lib/clinic-portal/locale';
import {clinicConsentName} from '@/lib/clinic-portal/consent-name';
import {ClinicFileLinkedNotice} from '@/components/clinic-portal/member-masked';
import {clinicChangeDecide} from '@/lib/clinic-admin/approval-actions';
import {ChangeApprovals} from '@/components/clinic-portal/change-approvals';
import {ClinicMemberPersonalData} from '@/components/clinic-portal/member-personal-data';
import {readClinicMemberMasked} from '@/lib/clinic-portal/member-masked';
import {clinicLabFileLabel,clinicDate} from '@/lib/clinic-portal/display-time';
import type {Locale} from '@/lib/locale';
import Link from'next/link';import type{Route}from'next';import{redirect}from'next/navigation';
import{requireClinicPortal}from'@/lib/clinic-portal/identity';import{ClinicShell}from'@/components/clinic-portal/shell';
import{readClinicPatientRecord}from'@/lib/clinic-admin/record';import{clinicPatientCareTeamChange,clinicPatientProfileUpdate,clinicAdminMemberReveal}from'@/lib/clinic-admin/actions';
import{CareTeamForm}from'@/components/clinic-portal/member-record-forms';
import{MemberResultsUpload}from'@/components/clinic-portal/member-results-upload';
import{readMemberFiles}from'@/lib/clinic-admin/files';
import{clinicMemberFileAttach,clinicMemberFilesRead,clinicMemberUploadBegin,clinicMemberUploadReserve}from'@/lib/clinic-admin/actions';
import type{ClinicBooking}from'@/lib/clinic-scheduling/schema';import{bookingTimestampText}from'@/lib/real-booking/display-time';

const bookingStatus:Record<ClinicBooking['status'],[string,string,string]>={requested:['Waiting for your confirmation','Սպասում է ձեր հաստատմանը','Ожидает вашего подтверждения'],'change-requested':['Change requested','Փոփոխության հարցում','Запрошено изменение'],confirmed:['Confirmed','Հաստատված է','Подтверждено'],
 arrived:['Arrived','Ներկայացել է','Приём состоялся'],'no-show':['Did not come','Չի ներկայացել','Не явились'],completed:['Completed: results received','Ավարտված է․ արդյունքները ստացված են','Завершено: результаты получены'],declined:['Declined','Մերժված է','Отклонено'],cancelled:['Cancelled by the member','Անդամը չեղարկել է','Отменено участником'],other:['Needs Noreon','Պետք է Նորեոն Հելթի օգնությունը','Нужна помощь Нореон Хелс']};
function bookingTime(value:string,locale:Locale){if(locale!=='ru')return bookingTimestampText(value,locale);const date=new Date(Date.parse(value)+4*3600000),months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'],pad=(n:number)=>String(n).padStart(2,'0');return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} · ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;}
// Lab reading scheduled by upload/attach actions uses the cron worker's function budget.
export const maxDuration=300;
export default async function ClinicMemberRecordPage({params,searchParams}:{params:Promise<{memberId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const{memberId}=await params,query=await searchParams,locale:Locale=await clinicLocale(query.locale),t=(en:string,hyText:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hyText:en;
 const context=await requireClinicPortal(typeof query.clinic==='string'?query.clinic:null,{page:true}),clinicId=context.identity.clinicId;
 if(context.identity.capability!=='clinic_admin')redirect(`/clinic/real/bookings?clinic=${clinicId}&locale=${locale}` as Route);
 const result=await readClinicPatientRecord(context.rpc,clinicId,memberId);
 const when=(value:string)=>`${bookingTime(value,locale)} (UTC+4)`,day=(value:string)=>clinicDate(value,locale);
 const back=<Link className="inline-flex min-h-12 items-center text-body2 underline-offset-4 hover:underline" href={`/clinic/real/records?clinic=${clinicId}&locale=${locale}` as Route}>{t('Back to member records','Վերադառնալ անդամների քարտերին','Назад к картам участников')}</Link>;
 if(result.status!=='loaded')return <ClinicShell identity={context.identity} locale={locale} current="records">{back}<p role="alert" className="rounded-lg border bg-background p-5 text-body2">{result.status==='missing'?t('This member is not one of your clinic’s members.','Այս անդամը ձեր կլինիկայի անդամներից չէ։','Этот участник не относится к вашей клинике.'):result.status==='disabled'?t('Full member records are not switched on for clinics yet.','Անդամների ամբողջական քարտերը կլինիկաների համար դեռ միացված չեն։','Полные карты участников для клиник пока не включены.'):result.status==='forbidden'?t('Only clinic admins can open member records.','Անդամների քարտերը կարող են բացել միայն կլինիկայի ադմինիստրատորները։','Открывать карты участников могут только администраторы клиники.'):t('The record could not load. Try again.','Քարտը չհաջողվեց բեռնել։ Նորից փորձեք։','Не удалось загрузить карту. Попробуйте снова.')}</p></ClinicShell>;
 const pending=result.data.pendingRequests.filter(r=>r.kind==='care_team');
 const files=await readMemberFiles(context.rpc,clinicId,memberId);
 const masks=await readClinicMemberMasked(context.rpc,clinicId,[memberId]),masked=masks.status==='loaded'?masks.members.find(m=>m.memberId===memberId):undefined;
 const r=result.data,m=r.member,team=r.careTeam,section='scroll-mt-24 space-y-3 rounded-lg border bg-background p-4',empty='text-body2 text-muted-foreground',none=t('Not given','Նշված չէ','Не указано');
 const saveProfile=clinicPatientProfileUpdate.bind(null,clinicId,context.actorScope,m.memberId),saveTeam=clinicPatientCareTeamChange.bind(null,clinicId,context.actorScope,m.memberId);
 const sections:[string,string][]=[['upload',t('Upload results','Վերբեռնել արդյունքներ','Загрузить результаты')],['personal',t('Personal data','Անձնական տվյալներ','Личные данные')],['care-team',t('Care team','Խնամքի թիմ','Медицинская команда')],['visits',t('Visits','Այցեր','Приёмы')],['files',t('Your clinic’s files','Ձեր կլինիկայի ֆայլերը','Файлы вашей клиники')]];
 const staffLine=(s:typeof team.doctor)=>s?`${s.name}${s.clinicName?` · ${s.clinicName}`:''}${s.active?'':` · ${t('inactive','ոչ ակտիվ','неактивен')}`}`:t('Not assigned','Նշանակված չէ','Не назначен');
 return <ClinicShell identity={context.identity} locale={locale} current="records">
  {back}
  <div className="space-y-2"><h1 className="break-words text-h1">{m.name||t('Name not given','Անունը նշված չէ','Имя не указано')}</h1>
   <p className="text-caption text-muted-foreground">{t('Personal data, care team, visits and your clinic\'s files. Questionnaire answers, results and the care plan are seen only by the member\'s doctor and nurse. Phone and date of birth are partly hidden. Opening this record and revealing details are recorded.','Անձնական տվյալներ, խնամքի թիմ, այցեր և ձեր կլինիկայի ֆայլերը։ Հարցաշարի պատասխանները, արդյունքները և խնամքի ծրագիրը տեսնում են միայն անդամի բժիշկն ու բուժքույրը։ Հեռախոսն ու ծննդյան ամսաթիվը մասամբ թաքցված են։ Այս քարտի բացումն ու տվյալների ցուցադրումը գրանցվում են։','Личные данные, медицинская команда, приёмы и файлы вашей клиники. Ответы на анкету, результаты и план лечения видят только врач и медсестра участника. Телефон и дата рождения частично скрыты. Открытие этой карты и показ данных фиксируются.')}</p></div>
  {pending.length>0&&<ChangeApprovals requests={pending} locale={locale} compact decide={clinicChangeDecide.bind(null,clinicId,context.actorScope)}/>}
  <nav aria-label={t('Record sections','Քարտի բաժիններ','Разделы карты')} className="flex flex-wrap gap-2">{sections.map(([id,label])=><a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center rounded-full border bg-background px-4 text-body2 hover:bg-muted">{label}</a>)}</nav>

  <section id="upload" aria-labelledby="h-upload" className={section}><h2 id="h-upload" className="text-h3">{t('Upload results','Վերբեռնել արդյունքներ','Загрузить результаты')}</h2>
   {files.status==='loaded'?<MemberResultsUpload locale={locale} clinicId={clinicId} memberId={m.memberId} actorScope={context.actorScope} initial={files.data} masked={masked}
     begin={clinicMemberUploadBegin.bind(null,clinicId,context.actorScope,m.memberId)} reserve={clinicMemberUploadReserve.bind(null,clinicId,context.actorScope)}
     read={clinicMemberFilesRead.bind(null,clinicId,context.actorScope,m.memberId)} attach={clinicMemberFileAttach.bind(null,clinicId,context.actorScope,m.memberId)}/>
   :<p role="alert" className={empty}>{t('Uploads could not load. Try again.','Վերբեռնումները չհաջողվեց բեռնել։ Նորից փորձեք։','Не удалось загрузить файлы. Попробуйте снова.')}</p>}
  </section>

  <section id="personal" aria-labelledby="h-personal" className={section}><h2 id="h-personal" className="text-h3">{t('Personal data','Անձնական տվյալներ','Личные данные')}</h2>
   <dl className="grid gap-x-4 gap-y-2 text-body2 sm:grid-cols-[auto_1fr]">
    <dt className="text-muted-foreground">{t('Full name','Անուն, ազգանուն','Имя и фамилия')}</dt><dd className="break-words">{m.name||none}</dd>
    <dt className="text-muted-foreground">{t('Sex','Սեռ','Пол')}</dt><dd>{m.sex==='female'?t('Female','Իգական','Женский'):m.sex==='male'?t('Male','Արական','Мужской'):none}</dd>
    <dt className="text-muted-foreground">{t('Language','Լեզու','Язык')}</dt><dd>{locale==='ru'?(m.locale==='en'?'Английский':'Армянский'):m.locale==='en'?'English':'Հայերեն'}</dd>
    <dt className="text-muted-foreground">{t('Joined Noreon','Միացել է Նորեոն Հելթին','Дата регистрации в Нореон Хелс')}</dt><dd>{day(m.joinedAt)}</dd>
    <dt className="text-muted-foreground">{t('Consent','Համաձայնություն','Согласие')}</dt><dd>{r.consents.length?r.consents.map(c=>`${clinicConsentName(c.version,locale)} · ${day(c.acceptedAt)}`).join(', '):t('Not given','Տրված չէ','Не указано')}</dd>
   </dl>
   <ClinicMemberPersonalData key={`${clinicId}:${context.actorScope}:${m.memberId}`} locale={locale} name={m.name} masked={masked} reveal={clinicAdminMemberReveal.bind(null,clinicId,context.actorScope,m.memberId)} save={saveProfile}/>
   {r.profileChanges.length>0&&<details className="text-body2"><summary className="min-h-11 cursor-pointer py-2">{t('Changes made by your clinic','Ձեր կլինիկայի կատարած փոփոխությունները','Изменения, внесённые вашей клиникой')} ({r.profileChanges.length})</summary>
    <ul className="divide-y">{r.profileChanges.map((c,i)=><li key={i} className="space-y-1 py-2"><p className="text-caption text-muted-foreground">{when(c.at)}{c.by?` · ${c.by}`:''}</p>
     {c.before.name!==c.after.name&&<p className="break-words">{t('Name','Անուն','Имя')}: {c.before.name||none} → {c.after.name}</p>}</li>)}</ul></details>}
  </section>

  <section id="care-team" aria-labelledby="h-team" className={section}><h2 id="h-team" className="text-h3">{t('Care team','Խնամքի թիմ','Медицинская команда')}</h2>
   <dl className="grid gap-x-4 gap-y-2 text-body2 sm:grid-cols-[auto_1fr]">
    <dt className="text-muted-foreground">{t('Doctor','Բժիշկ','Врач')}</dt><dd className="break-words">{staffLine(team.doctor)}</dd>
    <dt className="text-muted-foreground">{t('Nurse','Բուժքույր','Медсестра')}</dt><dd className="break-words">{staffLine(team.nurse)}</dd>
   </dl>
   {!team.enrolled||team.revision===null?<p className={empty}>{t('This member has not joined the care programme yet, so there is no care team to set.','Այս անդամը դեռ չի միացել խնամքի ծրագրին, ուստի խնամքի թիմ նշանակել հնարավոր չէ։','Этот участник ещё не присоединился к программе наблюдения, поэтому назначить медицинскую команду пока нельзя.')}</p>
   :!team.editable?<p className={empty}>{t('This member’s doctor is at another clinic, so your clinic cannot change the care team. Ask Noreon if they should move to your clinic.','Այս անդամի բժիշկը այլ կլինիկայից է, ուստի ձեր կլինիկան չի կարող փոխել խնամքի թիմը։ Եթե պետք է տեղափոխել ձեր կլինիկա, դիմեք Նորեոն Հելթին։','Врач этого участника работает в другой клинике, поэтому ваша клиника не может изменить медицинскую команду. Обратитесь в Нореон Хелс, если участника нужно перевести в вашу клинику.')}</p>
   :pending.some(r=>r.kind==='care_team')?null:<CareTeamForm locale={locale} revision={team.revision} doctorId={team.doctor?.id??null} nurseId={team.nurse?.id??null} doctors={team.doctors} nurses={team.nurses} save={saveTeam}/>}
  </section>

  <section id="visits" aria-labelledby="h-visits" className={section}><h2 id="h-visits" className="text-h3">{t('Visits','Այցեր','Приёмы')}</h2>
   <h3 className="text-body2 font-medium">{t('Bookings with your clinic','Այցեր ձեր կլինիկայում','Записи в вашу клинику')}</h3>
   {r.bookings.length?<ul className="divide-y">{r.bookings.map(b=><li key={`${b.appointmentId}:${b.reference}`} className="space-y-1 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-body2 font-medium">{when(b.startsAt)}</p><p className="rounded-full border px-3 py-1 text-caption">{bookingStatus[b.status][locale==='ru'?2:locale==='hy'?1:0]}</p></div>{b.tests.length>0&&<p className="break-words text-caption text-muted-foreground">{b.tests.join(', ')}</p>}</li>)}</ul>:<p className={empty}>{t('No bookings with your clinic.','Ձեր կլինիկայում այցեր չկան։','Записей в вашу клинику нет.')}</p>}
   <h3 className="text-body2 font-medium">{t('Recorded visits at your clinic','Գրանցված այցեր ձեր կլինիկայում','Зафиксированные приёмы в вашей клинике')}</h3>
   {r.visits.length?<ul className="divide-y">{r.visits.map(v=><li key={v.visitId} className="space-y-1 py-3 text-body2"><p className="font-medium">{when(v.visitedAt)}</p>
    <p className="text-caption text-muted-foreground">{t('Recorded by','Գրանցել է','Зафиксировал')} {v.recordedBy}</p>
   </li>)}</ul>:<p className={empty}>{t('No recorded visits yet.','Գրանցված այցեր դեռ չկան։','Зафиксированных приёмов пока нет.')}</p>}
  </section>

  <section id="files" aria-labelledby="h-files" className={section}><h2 id="h-files" className="text-h3">{t('Lab files from your clinic','Ձեր կլինիկայի լաբորատոր ֆայլերը','Лабораторные файлы вашей клиники')}</h2>
   {r.files.length?<ul className="divide-y">{r.files.map(file=><li key={file.fileId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-body2 font-medium">{clinicLabFileLabel(file.uploadedAt,locale)}</p><p className="text-caption text-muted-foreground">{t('Uploaded','Վերբեռնվել է','Загружено')} {day(file.uploadedAt)}</p></div>
    <ClinicFileLinkedNotice locale={locale}/></li>)}</ul>:<p className={empty}>{t('No lab files linked yet.','Կցված լաբորատոր ֆայլեր դեռ չկան։','Связанных лабораторных файлов пока нет.')}</p>}
  </section>
 </ClinicShell>;
}
