'use client';
import {useRef,useState} from 'react';
import {Dialog as DialogPrimitive} from '@base-ui/react/dialog';
import {UserRoundPen,UserRoundPlus,XIcon} from 'lucide-react';
import {Dialog,DialogDescription,DialogOverlay,DialogPortal,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {SelectField,type SelectOption} from '@/components/ui/select-field';
import {assignRealMember} from '@/lib/patient-care/clinical-actions';
import {assignRealNurse} from '@/lib/staff/nurse-actions';
import {saveCareTeam,type CareTeamActions} from '@/lib/staff/care-team-save';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import type {MemberQueueDirectory} from './member-queue-list';

const assignmentErrorsRu:Record<string,string>={
 'Administrator access is required.':'Требуются права администратора.',
 'Check the assignment details.':'Проверьте данные назначения.',
 'Assignment changed or is unavailable. Reload and choose an active doctor.':'Назначение изменилось или недоступно. Обновите страницу и выберите действующего врача.',
 'Choose an active nurse in the assigned doctor’s clinic, or refresh a changed case.':'Выберите действующую медсестру из клиники назначенного врача или обновите изменившийся случай.',
};
const assignmentErrorRu=(message:string)=>assignmentErrorsRu[message]??'Не удалось подтвердить сохранение. Обновите страницу и проверьте назначение.';

type Props={id:string;name:string;revision:number;doctorId:string|null;nurseId:string|null;doctors:MemberQueueDirectory[];nurses:MemberQueueDirectory[];locale:PatientLocale;primary:boolean;onSaved?:(note?:string)=>void;actions?:CareTeamActions;readToken?:object};

/** Doctor and nurse for one member, edited together and saved once (see saveCareTeam). */
export function CareTeamDialog({id,name,revision,doctorId,nurseId,doctors,nurses,locale,primary,onSaved,readToken,actions={assignDoctor:assignRealMember,assignNurse:assignRealNurse}}:Props){
 const [open,setOpen]=useState(false);
 const savedDoctor=doctorId??'',savedNurse=nurseId??'';
 const [doctor,setDoctor]=useState(savedDoctor);
 const [nurse,setNurse]=useState(savedNurse);
 const [pending,setPending]=useState(false);
 const busy=useRef(false);
 const [failedRead,setFailedRead]=useState<{revision:number;token?:object}|null>(null);
 const needsRefresh=failedRead?.revision===revision&&failedRead.token===readToken;
 const failureText=tx(locale,'Նշանակումը փոխվել է կամ պահպանումը չի հաստատվել։ Թարմացրեք անդամների ցանկը և ստուգեք թիմը։','The assignment changed or the save could not be confirmed. Refresh the member list and check the care team.','Назначение изменилось или сохранение не подтверждено. Обновите список участников и проверьте команду заботы.');
 const [error,setError]=useState('');
 const clinicId=doctors.find(d=>d.id===doctor)?.clinicId;
 const eligible=nurses.filter(n=>n.clinicId===clinicId);
 const savedNurseRow=nurses.find(n=>n.id===savedNurse);
 const otherClinic=!!savedNurse&&nurse===savedNurse&&!eligible.some(n=>n.id===savedNurse);
 const doctorOptions:SelectOption[]=[{value:'',label:tx(locale,'Սպասում է նշանակման','Awaiting assignment','Ожидает назначения')},...doctors.map(d=>({value:d.id,label:d.name,description:d.clinic}))];
 const nurseOptions:SelectOption[]=[{value:'',label:tx(locale,'Բուժքույր նշանակված չէ','No assigned nurse','Медсестра не назначена')},...eligible.map(n=>({value:n.id,label:n.name,description:n.clinic})),...(otherClinic&&savedNurseRow?[{value:savedNurseRow.id,label:savedNurseRow.name,description:tx(locale,'Այլ կլինիկա','Another clinic','Другая клиника')}]:[])];
 function openChange(next:boolean){
  if(pending)return;
  if(next){setDoctor(savedDoctor);setNurse(savedNurse);setError('');}
  setOpen(next);
 }
 async function save(){
  if(busy.current||needsRefresh)return;
  busy.current=true;setPending(true);setError('');
  try{
   const result=await saveCareTeam({id,revision,doctor,nurse,savedDoctor,savedNurse},actions);
   if(result.outcome==='unchanged'){setOpen(false);return;}
   if(result.outcome==='doctor-failed'){setFailedRead({revision,token:readToken});setError(locale==='hy'?failureText:locale==='ru'?assignmentErrorRu(result.message):result.message);return;}
   if(result.outcome==='nurse-failed'){
    setFailedRead({revision,token:readToken});
    const message=locale==='hy'?failureText:locale==='ru'?assignmentErrorRu(result.message):result.message;
    const note=result.doctorSaved?tx(locale,`Բժիշկը պահպանվել է։ Բուժքույրը չի պահպանվել. ${message}`,`Doctor saved. The nurse was not saved: ${result.message}`,`Врач сохранён. Медсестра не сохранена: ${message}`):message;
    setError(note);
    // The doctor save refreshes the list and may close this dialog; keep the note visible above it.
    if(result.doctorSaved)onSaved?.(note);
    return;
   }
   setOpen(false);onSaved?.();
  }catch{
   setFailedRead({revision,token:readToken});
   setError(tx(locale,'Պահպանումը չհաստատվեց։ Թարմացրեք էջը և ստուգեք նշանակումը։','The save could not be confirmed. Refresh the page and check the assignment.','Не удалось подтвердить сохранение. Обновите страницу и проверьте назначение.'));
  }finally{busy.current=false;setPending(false);}
 }
 const label=primary?tx(locale,'Նշանակել բժիշկ','Assign doctor','Назначить врача'):tx(locale,'Փոխել','Change','Изменить');
 return <Dialog open={open} onOpenChange={openChange}>
  <DialogTrigger aria-label={`${label}: ${name}`} className={`inline-flex min-h-11 flex-1 sm:flex-none items-center justify-center gap-2 rounded-md px-3 text-body2 font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${primary?'bg-primary text-primary-foreground hover:bg-primary/90':'border bg-background hover:bg-muted'}`}>
   {primary?<UserRoundPlus className="size-4" aria-hidden/>:<UserRoundPen className="size-4" aria-hidden/>}{label}
  </DialogTrigger>
  {open&&<DialogPortal>
   <DialogOverlay/>
   <DialogPrimitive.Popup className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-xl bg-popover p-5 text-popover-foreground ring-1 ring-foreground/10 outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
    <div className="mb-5 space-y-1 pr-10">
     <DialogTitle className="text-h3 font-semibold break-words">{tx(locale,'Խնամքի թիմ','Care team','Медицинская команда')}</DialogTitle>
     <DialogDescription className="text-caption break-words text-muted-foreground">{name}</DialogDescription>
    </div>
    <div className="space-y-5">
     <div className="space-y-2">
      <label htmlFor={`doctor-${id}`} className="block text-body2 font-medium">{tx(locale,'Նշանակված բժիշկ','Assigned doctor','Назначенный врач')}</label>
      <SelectField id={`doctor-${id}`} value={doctor} onValueChange={value=>{setDoctor(value);if(value!==doctor)setNurse('');}} options={doctorOptions} disabled={pending} searchPlaceholder={tx(locale,'Որոնել բժիշկ','Search doctors','Найти врача')} emptyText={tx(locale,'Համընկնումներ չկան','No matches','Совпадений нет')}/>
     </div>
     <div className="space-y-2">
      <label htmlFor={`nurse-${id}`} className="block text-body2 font-medium">{tx(locale,'Նշանակված բուժքույր','Assigned nurse','Назначенная медсестра')}</label>
      <SelectField id={`nurse-${id}`} value={nurse} onValueChange={setNurse} options={nurseOptions} disabled={pending} aria-describedby={`nurse-help-${id}`} searchPlaceholder={tx(locale,'Որոնել բուժքույր','Search nurses','Найти медсестру')} emptyText={tx(locale,'Համընկնումներ չկան','No matches','Совпадений нет')}/>
      <p id={`nurse-help-${id}`} className="text-caption text-muted-foreground">{!doctor?tx(locale,'Նախ ընտրեք բժիշկ։','Choose a doctor first.','Сначала выберите врача.'):otherClinic?tx(locale,'Ներկայիս բուժքույրն աշխատում է այլ կլինիկայում։ Ընտրեք այս կլինիկայի բուժքույր կամ ոչ մեկին։','The current nurse works in another clinic. Choose a nurse from this clinic, or none.','Текущая медсестра работает в другой клинике. Выберите медсестру из этой клиники или оставьте без назначения.'):tx(locale,'Ընտրության համար հասանելի են միայն նշանակված բժշկի կլինիկայի ակտիվ բուժքույրերը։','Only active nurses in the assigned doctor’s clinic are eligible.','Доступны только действующие медсёстры из клиники назначенного врача.')}</p>
     </div>
     {(error||needsRefresh)&&<p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-body2">{error||failureText}</p>}
     <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <DialogPrimitive.Close disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-body2 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">{tx(locale,'Չեղարկել','Cancel','Отменить')}</DialogPrimitive.Close>
      <button type="button" onClick={()=>void save()} disabled={pending||needsRefresh} className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">{pending?tx(locale,'Պահպանվում է…','Saving…','Сохраняется…'):tx(locale,'Պահպանել թիմը','Save care team','Сохранить медицинскую команду')}</button>
     </div>
    </div>
    <DialogPrimitive.Close disabled={pending} className="absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
     <XIcon className="size-4" aria-hidden/><span className="sr-only">{tx(locale,'Փակել','Close','Закрыть')}</span>
    </DialogPrimitive.Close>
   </DialogPrimitive.Popup>
  </DialogPortal>}
 </Dialog>;
}
