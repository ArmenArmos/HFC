'use client';
import type {ClinicMemberMasked} from '@/lib/clinic-portal/member-masked-schema';
import {ClinicMemberMaskedSummary} from './member-masked';
import type{Locale}from'@/lib/locale';
import{useMemo,useRef,useState,type FormEvent}from'react';
import Link from'next/link';
import type{Route}from'next';
import{useRouter}from'next/navigation';
import type{ClinicPatientRow,EditOutcome}from'@/lib/clinic-admin/schema';
const tr=(locale:Locale,en:string,hy:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hy:en;
const input='min-h-12 w-full min-w-0 rounded-md border bg-background px-3 text-body2';
const primary='inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground disabled:opacity-60';
const secondary='inline-flex min-h-12 items-center justify-center rounded-md border px-4 text-body2';
function outcomeText(locale:Locale,outcome:EditOutcome){
 const copy:Record<EditOutcome,[string,string,string]>={
  pending:['Sent for approval. Another clinic admin or Noreon needs to approve it.','Ուղարկված է հաստատման։ Այն պետք է հաստատի կլինիկայի մեկ այլ ադմինիստրատոր կամ Noreon-ը։','Отправлено на согласование. Изменение должен одобрить другой администратор клиники или Noreon.'],
  pending_exists:['A change is already waiting for approval.','Փոփոխությունն արդեն սպասում է հաստատման։','Изменение уже ожидает согласования.'],
  disabled:['Changes are not switched on yet.','Փոփոխությունները դեռ միացված չեն։','Изменения пока не включены.'],
  saved:['Saved.','Պահպանված է։','Сохранено.'],
  unchanged:['Nothing changed.','Ոչինչ չի փոխվել։','Ничего не изменилось.'],
  age_changes:['This date of birth changes the age the member gave in their questionnaire. Ask the member to correct their date of birth in the Noreon app, so their answers are checked again.','Այս ծննդյան ամսաթիվը փոխում է հարցաշարում անդամի նշած տարիքը։ Խնդրեք անդամին ուղղել ծննդյան ամսաթիվը Noreon հավելվածում, որպեսզի պատասխանները կրկին ստուգվեն։','Эта дата рождения меняет возраст, указанный участником в анкете. Попросите участника исправить дату рождения в приложении Noreon, чтобы ответы были проверены повторно.'],
  stale:["This member's details changed. Open the record again.",'Այս անդամի տվյալները փոխվել են։ Կրկին բացեք քարտը։','Данные этого участника изменились. Откройте карту снова.'],
  invalid:['Check the details. The name needs 1 to 100 characters and the member must be 18 to 110 years old.','Ստուգեք տվյալները։ Անունը պետք է լինի 1-ից 100 նիշ, իսկ անդամը՝ 18-ից 110 տարեկան։','Проверьте данные. Имя должно содержать от 1 до 100 символов, а возраст участника должен быть от 18 до 110 лет.'],
  refused:["Couldn't send the change. Try again.",'Չհաջողվեց ուղարկել փոփոխությունը։ Նորից փորձեք։','Не удалось отправить изменение. Попробуйте снова.'],
  unavailable:["Couldn't send the change. Try again.",'Չհաջողվեց ուղարկել փոփոխությունը։ Նորից փորձեք։','Не удалось отправить изменение. Попробуйте снова.'],
  doctor_unavailable:['Choose an active doctor of your clinic.','Ընտրեք ձեր կլինիկայի ակտիվ բժշկին։','Выберите активного врача вашей клиники.'],
  nurse_unavailable:['Choose an active nurse of your clinic, or no nurse.','Ընտրեք ձեր կլինիկայի ակտիվ բուժքրոջը կամ թողեք առանց բուժքրոջ։','Выберите активную медсестру вашей клиники или оставьте поле без медсестры.'],
  other_clinic:['This member’s doctor is at another clinic. Ask Noreon to move them.','Այս անդամի բժիշկը այլ կլինիկայից է։ Տեղափոխելու համար դիմեք Noreon-ին։','Врач этого участника работает в другой клинике. Обратитесь в Noreon для перевода участника.'],
  not_enrolled:['This member has not joined the care programme yet, so there is no care team to set.','Այս անդամը դեռ չի միացել խնամքի ծրագրին, ուստի խնամքի թիմ նշանակել հնարավոր չէ։','Участник ещё не присоединился к программе заботы о здоровье, поэтому назначить медицинскую команду пока нельзя.'],
 };
 return copy[outcome][locale==='ru'?2:locale==='hy'?1:0];
}
function Feedback({locale,outcome,saved}:{locale:Locale;outcome:EditOutcome|null;saved?:string}){
 if(!outcome)return null;
 return <p role={outcome==='pending'||outcome==='pending_exists'||outcome==='saved'||outcome==='unchanged'?'status':'alert'} className="rounded-md border bg-muted p-3 text-body2">{outcome==='saved'&&saved?saved:outcomeText(locale,outcome)}</p>;
}

export function ProfileEditForm({locale,current,save}:{locale:Locale;current:{name:string;birthDate:string|null};save:(input:unknown)=>Promise<EditOutcome>}){
 const router=useRouter();
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[outcome,setOutcome]=useState<EditOutcome|null>(null);
 const [name,setName]=useState(current.name),[birthDate,setBirthDate]=useState(current.birthDate??'');
 const [submissionId,setSubmissionId]=useState(()=>crypto.randomUUID());
 const lock=useRef(false);
 async function submit(event:FormEvent){
  event.preventDefault();if(lock.current)return;
  lock.current=true;setBusy(true);
  let result:EditOutcome;
  try{result=await save({submissionId,expected:current,name:name.trim(),birthDate});}catch{result='unavailable';}
  lock.current=false;setBusy(false);setOutcome(result);
  if(result!=='unavailable')setSubmissionId(crypto.randomUUID());
  if(result==='saved'||result==='unchanged'||result==='stale'){setEditing(false);router.refresh();}
 }
 if(!editing)return <div className="space-y-3"><Feedback locale={locale} outcome={outcome} saved={tr(locale,'Saved. The member sees the change in their profile.','Պահպանված է։ Անդամը փոփոխությունը կտեսնի իր պրոֆիլում։','Сохранено. Участник увидит изменение в своём профиле.')}/>
  <button type="button" className={secondary} onClick={()=>{setName(current.name);setBirthDate(current.birthDate??'');setOutcome(null);setEditing(true);}}>{tr(locale,'Edit name and date of birth','Խմբագրել անունը և ծննդյան ամսաթիվը','Изменить имя и дату рождения')}</button></div>;
 return <form onSubmit={submit} className="space-y-4 rounded-md border p-4" aria-busy={busy}>
  <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Full name','Անուն, ազգանուն','Имя и фамилия')}</span>
   <input required disabled={busy||outcome==='unavailable'} value={name} onChange={e=>setName(e.target.value)} maxLength={100} autoComplete="off" className={input}/></label>
  <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Date of birth','Ծննդյան ամսաթիվ','Дата рождения')}</span>
   <input required disabled={busy||outcome==='unavailable'} type="date" value={birthDate} onChange={e=>setBirthDate(e.target.value)} className={input}/></label>
  <p className="text-caption text-muted-foreground">{tr(locale,'The phone number is how the member signs in, so it cannot be changed here. Each change is recorded with the old and new values.','Հեռախոսահամարով անդամը մուտք է գործում, ուստի այստեղ այն փոխել հնարավոր չէ։ Յուրաքանչյուր փոփոխություն գրանցվում է հին և նոր արժեքներով։','Участник входит по номеру телефона, поэтому его нельзя изменить здесь. Каждое изменение записывается со старым и новым значениями.')}</p>
  <Feedback locale={locale} outcome={outcome}/>
  <div className="flex flex-col gap-3 sm:flex-row">
   <button disabled={busy} className={primary}>{busy?tr(locale,'Saving…','Պահպանվում է…','Сохраняется…'):tr(locale,'Save personal data','Պահպանել անձնական տվյալները','Сохранить личные данные')}</button>
   <button type="button" disabled={busy||outcome==='unavailable'} className={secondary} onClick={()=>{setEditing(false);setOutcome(null);}}>{tr(locale,'Cancel','Չեղարկել','Отменить')}</button>
  </div>
 </form>;
}

type Choice={id:string;name:string};
export function CareTeamForm({locale,revision,doctorId,nurseId,doctors,nurses,save}:{locale:Locale;revision:number;doctorId:string|null;nurseId:string|null;doctors:Choice[];nurses:Choice[];save:(input:unknown)=>Promise<EditOutcome>}){
 const router=useRouter();
 const [doctor,setDoctor]=useState(doctorId&&doctors.some(d=>d.id===doctorId)?doctorId:''),[nurse,setNurse]=useState(nurseId&&nurses.some(n=>n.id===nurseId)?nurseId:'');
 const [busy,setBusy]=useState(false),[outcome,setOutcome]=useState<EditOutcome|null>(null);
 const lock=useRef(false);
 const [submissionId,setSubmissionId]=useState(()=>crypto.randomUUID());
 const doctorChanges=doctor!==''&&doctor!==doctorId;
 async function submit(event:FormEvent){
  event.preventDefault();if(lock.current||!doctor)return;
  lock.current=true;setBusy(true);
  let result:EditOutcome;
  try{result=await save({submissionId,expectedRevision:revision,doctorId:doctor,nurseId:nurse||null});}catch{result='unavailable';}
  lock.current=false;setBusy(false);setOutcome(result);
  if(result!=='unavailable')setSubmissionId(crypto.randomUUID());
  if(result==='pending'||result==='pending_exists'||result==='stale')router.refresh();
 }
 if(!doctors.length)return <p className="text-body2 text-muted-foreground">{tr(locale,'Your clinic has no active doctor yet. Ask Noreon to add one.','Ձեր կլինիկան դեռ ակտիվ բժիշկ չունի։ Դիմեք Noreon-ին՝ ավելացնելու համար։','В вашей клинике пока нет активного врача. Обратитесь в Noreon, чтобы его добавили.')}</p>;
 return <form onSubmit={submit} className="space-y-4 rounded-md border p-4" aria-busy={busy}>
  <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Doctor','Բժիշկ','Врач')}</span>
   <select required disabled={busy||outcome==='unavailable'} value={doctor} onChange={e=>setDoctor(e.target.value)} className={input}>
    <option value="" disabled>{tr(locale,'Choose a doctor','Ընտրեք բժշկին','Выберите врача')}</option>
    {doctors.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
   </select></label>
  <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Nurse','Բուժքույր','Медсестра')}</span>
   <select disabled={busy||outcome==='unavailable'} value={nurse} onChange={e=>setNurse(e.target.value)} className={input}>
    <option value="">{tr(locale,'No nurse','Առանց բուժքրոջ','Без медсестры')}</option>
    {nurses.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}
   </select></label>
  {doctorChanges&&<p className="text-caption text-muted-foreground">{tr(locale,'Changing the doctor removes the current nurse first; the nurse you choose here is then attached. Each change is recorded.','Բժշկին փոխելիս ընթացիկ բուժքույրը նախ հեռացվում է, ապա կցվում է այստեղ ընտրված բուժքույրը։ Յուրաքանչյուր փոփոխություն գրանցվում է։','При смене врача текущая медсестра сначала открепляется, затем прикрепляется выбранная здесь медсестра. Каждое изменение записывается.')}</p>}
  <Feedback locale={locale} outcome={outcome} saved={tr(locale,'Care team saved.','Խնամքի թիմը պահպանված է։','Медицинская команда сохранена.')}/>
  <button disabled={busy||!doctor||outcome==='pending'||outcome==='pending_exists'} className={primary}>{busy?tr(locale,'Sending…','Ուղարկվում է…','Отправляется…'):tr(locale,'Send care team for approval','Ուղարկել խնամքի թիմը հաստատման','Отправить медицинскую команду на согласование')}</button>
 </form>;
}

/** Filters the loaded list in the browser, so names and phone digits never reach a URL or a log. */
export function MemberRecordsList({clinicId,locale,rows,onOpen,maskedMembers=[]}:{clinicId:string;locale:Locale;rows:ClinicPatientRow[];maskedMembers?:ClinicMemberMasked[];onOpen?:(memberId:string)=>void}){
 const [query,setQuery]=useState('');
 const shown=useMemo(()=>{const q=query.trim().toLowerCase(),digits=q.replace(/[^0-9]/g,'');
  return q?rows.filter(r=>r.name.toLowerCase().includes(q)||(digits.length>=3&&(maskedMembers.find(m=>m.memberId===r.memberId)?.phoneLast4??'').includes(digits))):rows;},[query,rows,maskedMembers]);
 return <div className="space-y-4">
  <label className="block space-y-2 rounded-lg border bg-background p-4 text-body2"><span className="font-medium">{tr(locale,'Filter by name or last 4 phone digits','Զտել ըստ անվան կամ հեռախոսի վերջին 4 թվանշանի','Поиск по имени или последним 4 цифрам телефона')}</span>
   <input type="search" value={query} onChange={e=>setQuery(e.target.value)} maxLength={100} autoComplete="off" className={input}/></label>
  {!shown.length?<p role="status" className="rounded-lg border bg-background p-5 text-body2">{rows.length?tr(locale,'No members match.','Համապատասխան անդամներ չկան։','Подходящих участников нет.'):tr(locale,'Your clinic has no members yet.','Ձեր կլինիկան դեռ անդամներ չունի։','В вашей клинике пока нет участников.')}</p>
  :<ul className="divide-y rounded-lg border bg-background">{shown.map(r=>{
   const content=<>
   <span className="min-w-0"><span className="block break-words text-body2 font-medium">{r.name||tr(locale,'Name not given','Անունը նշված չէ','Имя не указано')}</span>
    <span className="block text-caption text-muted-foreground"><ClinicMemberMaskedSummary member={maskedMembers.find(m=>m.memberId===r.memberId)} locale={locale}/></span></span>
   <span className="text-caption text-muted-foreground">{r.doctorName?`${tr(locale,'Doctor','Բժիշկ','Врач')}: ${r.doctorName}`:tr(locale,'No doctor yet','Բժիշկ դեռ նշանակված չէ','Врач пока не назначен')}{r.nurseName?` · ${tr(locale,'Nurse','Բուժքույր','Медсестра')}: ${r.nurseName}`:''}</span>
   </>;
   const rowClass="flex min-h-12 w-full flex-col gap-1 p-4 text-left hover:bg-muted sm:flex-row sm:items-center sm:justify-between";
   return <li key={r.memberId}>{onOpen?<button type="button" className={rowClass} onClick={()=>onOpen(r.memberId)}>{content}</button>:<Link className={rowClass} href={`/clinic/real/records/${r.memberId}?clinic=${clinicId}&locale=${locale}` as Route}>{content}</Link>}</li>;
  })}</ul>}
  <p className="text-caption text-muted-foreground">{tr(locale,`Showing ${shown.length} of ${rows.length}. Up to 200 members are listed.`,`Ցուցադրված է ${shown.length}-ը ${rows.length}-ից։ Ցուցադրվում է մինչև 200 անդամ։`,`Показано ${shown.length} из ${rows.length}. В списке не более 200 участников.`)}</p>
 </div>;
}
