'use client';
import {useRef,useState}from'react';
import type{Appointment,PilotActionState,PilotFormAction}from'@/lib/real-booking/appointment-schema';
import {BookingRecovery,bookingCopy as t,type BookingLocale}from'./appointment-status';
type Props={appointment:Appointment;commandId:string;locale:BookingLocale;action:PilotFormAction;refreshHref:string};
type Mode='retry'|'recovery'|'first';
function NoticeOperationSession(props:Props&{mode:Mode}){
 const[context]=useState(()=>props);
 const[state,setState]=useState<PilotActionState>({ok:false});
 const[busy,setBusy]=useState(false);
 const started=useRef(false);
 const recovery=props.mode==='recovery';
 const first=props.mode==='first';
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(started.current)return;
  started.current=true;setBusy(true);
  const form=new FormData();
  form.set('commandId',context.commandId);form.set('appointmentId',context.appointment.id);form.set('revision',String(context.appointment.revision));form.set('noticeId',context.appointment.noticeId);
  try{
   const result=await props.action({ok:false},form);
   setState(result&&typeof result.ok==='boolean'&&result.code?result:{ok:false,code:'unknown',outcomeUnknown:true});
  }catch{setState({ok:false,code:'unknown',outcomeUnknown:true});}
  finally{setBusy(false);}
 }
 const message=state.code==='saved'
  ?t(props.locale,recovery?'The saved delivery receipt was recovered. Check the visit.':'The scheduling message was accepted. Check the saved visit.',recovery?'Պահպանված առաքման անդորրագիրը վերականգնվել է։ Ստուգեք այցը։':'Գրանցման նամակն ընդունվել է։ Ստուգեք պահպանված այցը։', recovery ? "Сохранённое подтверждение доставки восстановлено. Проверьте визит." : "Сообщение о записи принято. Проверьте сохранённый визит.")
  :state.code==='failed'
   ?t(props.locale,recovery?'The recorded result is a definite failure. Check the saved visit before a separate retry.':'The email service rejected this attempt. Check the saved status before another attempt.',recovery?'Գրանցված արդյունքը հստակ ձախողում է։ Առանձին կրկնակի փորձից առաջ ստուգեք պահպանված այցը։':'Նամակի ծառայությունը մերժել է այս փորձը։ Նոր փորձից առաջ ստուգեք պահպանված վիճակը։', recovery ? "Сохранённый результат подтверждает сбой. Перед отдельной повторной попыткой проверьте сохранённый визит." : "Почтовая служба отклонила эту попытку. Перед новой попыткой проверьте сохранённый статус.")
   :state.code==='arrangement-review'
    ?t(props.locale,recovery?'An email-service receipt is saved, but the arrangement needs review. Check the visit details and recorded result. This check did not send email.':'An email-service receipt is saved, but the arrangement needs review. Do not send again. Check the saved visit details and result.',recovery?'Նամակի ծառայության անդորրագիրը պահպանված է, սակայն պայմանավորվածությունը պետք է վերանայել։ Ստուգեք այցի տվյալներն ու գրանցված արդյունքը։ Այս ստուգումը նամակ չի ուղարկել։':'Նամակի ծառայության անդորրագիրը պահպանված է, սակայն պայմանավորվածությունը պետք է վերանայել։ Կրկին մի ուղարկեք։ Ստուգեք պահպանված այցի տվյալներն ու արդյունքը։', recovery ? "Подтверждение от почтовой службы сохранено, но договорённость требует проверки. Проверьте данные визита и сохранённый результат. Эта проверка не отправляла писем." : "Подтверждение от почтовой службы сохранено, но договорённость требует проверки. Не отправляйте письмо повторно. Проверьте сохранённые данные визита и результат.")
   :state.code==='unknown'||state.outcomeUnknown
    ?t(props.locale,recovery?'The final booking result is not verified. Check the recorded email result and visit details before another operation. This check did not send email.':'The result is unknown. Do not send again. Check the saved visit for reconciliation.',recovery?'Գրանցման վերջնական արդյունքը հաստատված չէ։ Նոր գործողությունից առաջ ստուգեք գրանցված նամակի արդյունքն ու այցի տվյալները։ Այս ստուգումը նամակ չի ուղարկել։':'Արդյունքն անհայտ է։ Կրկին մի ուղարկեք։ Ստուգեք պահպանված այցը՝ վիճակը ճշտելու համար։', recovery ? "Итоговый результат записи не подтверждён. Перед следующим действием проверьте сохранённый результат отправки письма и данные визита. Эта проверка не отправляла писем." : "Результат неизвестен. Не отправляйте письмо повторно. Проверьте сохранённый визит для уточнения статуса.")
    :t(props.locale,'Check the latest saved visit before continuing.','Շարունակելուց առաջ ստուգեք վերջին պահպանված այցը։', "Прежде чем продолжить, проверьте последние сохранённые данные визита.");
 return <form onSubmit={submit} aria-busy={busy} className="space-y-3 border-t pt-4" aria-label={t(props.locale,recovery?'Recover recorded email result':first?'Send pending scheduling email':'Retry failed scheduling email',recovery?'Վերականգնել գրանցված նամակի արդյունքը':first?'Ուղարկել սպասող գրանցման նամակը':'Կրկին ուղարկել չհաջողված գրանցման նամակը', recovery ? "Восстановить сохранённый результат отправки письма" : first ? "Отправить ожидающее письмо о записи" : "Повторить отправку неотправленного письма о записи")}>
  <p className="text-body2">{recovery?t(props.locale,'Check the recorded email result and visit details. This check never sends email. A saved receipt alone does not confirm the arrangement.','Ստուգեք գրանցված նամակի արդյունքն ու այցի տվյալները։ Այս ստուգումը երբեք նամակ չի ուղարկում։ Միայն պահպանված անդորրագիրը չի հաստատում պայմանավորվածությունը։', "Проверьте сохранённый результат отправки письма и данные визита. Эта проверка никогда не отправляет письма. Одно сохранённое подтверждение доставки не подтверждает договорённость."):first?t(props.locale,'Send the first scheduling message saved for this visit to the clinic and Noreon. The visit time stays unchanged.','Ուղարկեք այս այցի համար պահպանված առաջին գրանցման նամակը կլինիկային և Նորեոն Հելթին։ Այցի ժամը չի փոխվում։', "Отправьте первое сохранённое письмо о записи для этого визита клинике и Нореон Хелс. Время визита не изменится."):t(props.locale,'The email service rejected the previous attempt. This retries the saved message to the clinic and Noreon. It does not change the visit time.','Նամակի ծառայությունը մերժել է նախորդ փորձը։ Սա կրկին ուղարկում է պահպանված նամակը կլինիկային և Նորեոն Հելթին։ Այցի ժամը չի փոխվում։', "Почтовая служба отклонила предыдущую попытку. Это действие повторно отправит сохранённое письмо клинике и Нореон Хелс. Время визита не изменится.")}</p>
  {state.code&&<p role={state.ok?'status':'alert'} className="text-body2">{message}</p>}
  <div className="flex flex-col items-start gap-3">
  <button disabled={busy||!!state.code} type="submit" className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-4 py-3 text-body2 text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">{busy?t(props.locale,recovery?'Checking…':'Sending…',recovery?'Ստուգվում է…':'Ուղարկվում է…', recovery ? "Проверяем…" : "Отправляем…"):recovery?t(props.locale,'Check recorded email result','Ստուգել գրանցված նամակի արդյունքը', "Проверить сохранённый результат отправки письма"):first?t(props.locale,'Send pending scheduling email','Ուղարկել սպասող գրանցման նամակը', "Отправить ожидающее письмо о записи"):t(props.locale,'Retry scheduling email','Կրկին ուղարկել գրանցման նամակը', "Повторить отправку письма о записи")}</button>
  {state.code&&<BookingRecovery href={props.refreshHref} locale={props.locale}/>}
  </div>
 </form>;
}
export function NoticeRetry(props:Props){return <NoticeOperationSession key={`retry:${props.commandId}:${props.appointment.noticeId}`} {...props} mode="retry"/>;}
export function NoticeRecovery(props:Props){return <NoticeOperationSession key={`recovery:${props.commandId}:${props.appointment.noticeId}`} {...props} mode="recovery"/>;}

export function NoticeFirstSend(props:Props){return <NoticeOperationSession key={`first:${props.commandId}:${props.appointment.noticeId}`} {...props} mode="first"/>;}
