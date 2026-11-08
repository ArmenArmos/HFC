'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowLeft,Check,ExternalLink,MessageCircle,PhoneCall,RefreshCw,Unlink} from 'lucide-react';
import {CareLink,IconTile} from '@/components/patient-care/common';
import {Button} from '@/components/ui/button';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {forgetTelegramAccount,startTelegramLink,stopTelegramLink,turnOnTelegramReplies} from '@/app/patient/account/telegram/actions';

type State='linked'|'not_linked'|'unavailable'|'not_ready'|'error';
const card='journey-card space-y-4';
const notice='rounded-xl border p-4 text-body2';

export function TelegramLink({locale:l,state,connected=false,consentVersion}:{locale:PatientLocale;state:State;connected?:boolean;consentVersion:string}){
 const router=useRouter();
 const [pending,startTransition]=useTransition();
 const [link,setLink]=useState<{url:string}|null>(null),[confirmUnlink,setConfirmUnlink]=useState(false),[confirmForget,setConfirmForget]=useState(false);
 const [message,setMessage]=useState<{tone:'ok'|'error';text:string}|null>(null);
 // A refreshed server state (linked, unlinked) always starts from a clean card.
 const [seenState,setSeenState]=useState(state);
 if(seenState!==state){setSeenState(state);setLink(null);setConfirmUnlink(false);setConfirmForget(false);}
 const errorText:Record<string,string>={
  unavailable:tx(l,'Telegram-ը դեռ հասանելի չէ ձեր հաշվի համար։','Telegram is not available for your account yet.',"Telegram пока недоступен для вашей учётной записи."),
  enrolment:tx(l,'Telegram-ով հաղորդագրությունները կմիանան, երբ ավարտեք գրանցումը և ուղարկեք դիտարկման հայտը։','Messages in Telegram start once your enrolment is complete and your review request is sent.',"Сообщения в Telegram станут доступны после завершения регистрации и отправки заявки на рассмотрение."),
  linked_elsewhere:tx(l,'Այս Telegram հաշիվն արդեն միացված է Նորեոն Հելթի այլ հաշվի։','This Telegram account is already connected to another Noreon account.',"Эта учётная запись Telegram уже связана с другой учётной записью Нореон Хелс."),
  consent_required:tx(l,'Հաստատեք համաձայնությունը՝ շարունակելու համար։','Confirm your consent to continue.',"Подтвердите согласие, чтобы продолжить."),
  rate_limited:tx(l,'Վերջին ժամում շատ հղումներ եք ստեղծել։ Փորձեք ավելի ուշ։','You created several links this hour. Try again later.',"За последний час вы создали несколько ссылок. Попробуйте позже."),
  error:tx(l,'Չհաջողվեց միացնել Telegram-ը։ Փորձեք մի քանի րոպեից։','We could not connect Telegram right now. Try again in a few minutes.',"Сейчас не удалось подключить Telegram. Попробуйте через несколько минут."),
 };
 function connect(){
  setMessage(null);
  startTransition(async()=>{
   try{
    const r=await startTelegramLink(consentVersion);
    if(!r.ok){setMessage({tone:'error',text:errorText[r.reason]});return;}
    // Shown as a link the member taps; opening it after an await would be blocked as a popup.
    setLink({url:r.url});
   }catch{setMessage({tone:'error',text:errorText.error});}
  });
 }
 function turnOn(){
  setMessage(null);
  startTransition(async()=>{
   try{
    const r=await turnOnTelegramReplies();
    if(!r.ok){setMessage({tone:'error',text:errorText[r.reason]});return;}
    router.refresh();
   }catch{setMessage({tone:'error',text:errorText.error});}
  });
 }
 function disconnect(){
  setMessage(null);
  startTransition(async()=>{
   try{
    const r=await stopTelegramLink();
    if(!r.ok){setMessage({tone:'error',text:tx(l,'Չհաջողվեց անջատել։ Փորձեք նորից։','We could not disconnect Telegram. Try again.',"Не удалось отключить Telegram. Попробуйте снова.")});return;}
    setConfirmUnlink(false);setMessage({tone:'ok',text:tx(l,'Telegram-ն անջատված է։ Պատասխաններ այլևս չեն ուղարկվի այնտեղ։','Telegram is disconnected. Replies will no longer be sent there.',"Telegram отключён. Ответы больше не будут отправляться туда.")});router.refresh();
   }catch{setMessage({tone:'error',text:tx(l,'Չհաջողվեց անջատել։ Փորձեք նորից։','We could not disconnect Telegram. Try again.',"Не удалось отключить Telegram. Попробуйте снова.")});}
  });
 }
 function forget(){
  setMessage(null);
  startTransition(async()=>{
   try{
    const r=await forgetTelegramAccount();
    if(!r.ok){setMessage({tone:'error',text:tx(l,'Չհաջողվեց հեռացնել։ Փորձեք նորից։','We could not remove this Telegram account. Try again.',"Не удалось удалить эту учётную запись Telegram. Попробуйте снова.")});return;}
    router.replace('/');router.refresh();
   }catch{setMessage({tone:'error',text:tx(l,'Չհաջողվեց հեռացնել։ Փորձեք նորից։','We could not remove this Telegram account. Try again.',"Не удалось удалить эту учётную запись Telegram. Попробуйте снова.")});}
  });
 }
 return <div className="max-w-2xl space-y-6">
  <header className="flex items-start gap-3"><IconTile icon={MessageCircle}/><div className="min-w-0 space-y-2"><h1 className="min-w-0 text-h1 [overflow-wrap:anywhere]">Telegram</h1><p className="text-body2 text-muted-foreground">{tx(l,'Ստացեք ձեր խնամքի թիմի պատասխանները Telegram-ում։','Get replies from your care team in Telegram.',"Получайте ответы от вашей медицинской команды в Telegram.")}</p></div></header>

  {state==='linked'&&<section className={card} aria-labelledby="telegram-status">
   <h2 id="telegram-status" className="flex items-center gap-2 text-h3"><Check className="size-5 shrink-0 text-brand-teal" aria-hidden/>{tx(l,'Միացված է','Connected',"Подключён")}</h2>
   <p className="text-body2">{tx(l,'Ձեր բժշկի պատասխանները կգան Telegram-ով։ Կարող եք գրել ձեր խնամքի թիմին Նորեոն Հելթ բոտում։','Replies from your doctor arrive in Telegram. You can write to your care team in the Noreon bot.',"Ответы вашего врача приходят в Telegram. Вы можете написать вашей медицинской команде в боте Нореон Хелс.")}</p>
   {!confirmUnlink?<Button type="button" variant="outline" className="h-auto min-h-11 gap-2 whitespace-normal px-4 py-3" disabled={pending} onClick={()=>setConfirmUnlink(true)}><Unlink className="size-4" aria-hidden/>{tx(l,'Անջատել Telegram-ը','Disconnect Telegram',"Отключить Telegram")}</Button>
   :<div role="group" aria-label={tx(l,'Հաստատեք անջատումը','Confirm disconnect',"Подтвердите отключение")} className={`${notice} space-y-3 bg-muted/30`}><p>{tx(l,'Անջատելուց հետո պատասխանները չեն ուղարկվի Telegram։ Դեռ չուղարկված պատասխանները կպահվեն։','After you disconnect, replies are not sent to Telegram. Replies not yet sent are held.',"После отключения ответы не отправляются в Telegram. Ещё не отправленные ответы будут сохранены.")}</p><div className="flex flex-wrap gap-3"><Button type="button" variant="destructive" className="h-auto min-h-11 whitespace-normal px-4 py-3" disabled={pending} onClick={disconnect}>{pending?tx(l,'Անջատվում է…','Disconnecting…',"Отключение…"):tx(l,'Այո, անջատել','Yes, disconnect',"Да, отключить")}</Button><Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal px-4 py-3" disabled={pending} onClick={()=>setConfirmUnlink(false)}>{tx(l,'Չեղարկել','Cancel',"Отмена")}</Button></div></div>}
  </section>}

  {state==='not_linked'&&<section className={card} aria-labelledby="telegram-connect">
   <h2 id="telegram-connect" className="text-h3">{connected?tx(l,'Պատասխանները Telegram-ում անջատված են','Replies in Telegram are off',"Ответы в Telegram отключены"):tx(l,'Միացված չէ','Not connected',"Не подключён")}</h2>
   <p className="text-body2">{tx(l,'Միացնելուց հետո կարող եք գրել ձեր խնամքի թիմին Telegram-ով, և ձեր բժշկի պատասխանները կգան այնտեղ։','Once connected, you can write to your care team in Telegram and your doctor’s replies arrive there.',"После подключения вы сможете писать вашей медицинской команде в Telegram и получать там ответы врача.")}</p>
   {!link?<>
    <p className="text-body2 text-muted-foreground">{tx(l,'Ձեր համաձայնությունը խնամքի թիմի հաղորդագրությունների համար տրվել է գրանցման ժամանակ։ Կարող եք ցանկացած պահի անջատել։','You agreed to messages from your care team when you enrolled. You can turn them off at any time.',"При регистрации вы дали согласие на сообщения от медицинской команды. Вы можете отключить их в любой момент.")}</p>
    <Button type="button" className="h-auto min-h-11 gap-2 whitespace-normal px-4 py-3" disabled={pending} onClick={connected?turnOn:connect}><MessageCircle className="size-4" aria-hidden/>{pending?tx(l,'Պատրաստվում է…','Preparing…',"Подготовка…"):connected?tx(l,'Միացնել պատասխանները Telegram-ում','Turn on replies in Telegram',"Включить ответы в Telegram"):tx(l,'Միացնել Telegram-ը','Connect Telegram',"Подключить Telegram")}</Button>
   </>:<div className={`${notice} space-y-3 bg-surface-subtle-teal`} role="status">
    <p>{tx(l,'Բացեք Telegram-ը, սեղմեք «Start», ապա «Կիսվել իմ համարով»։ Համարը պետք է համընկնի ձեր Նորեոն Հելթ համարի հետ։ Հղումը գործում է 10 րոպե և միայն մեկ անգամ։','Open Telegram, press Start, then tap Share my phone number. It must be the number you use for Noreon. The link works once, for 10 minutes.',"Откройте Telegram, нажмите Start, затем «Поделиться номером телефона». Номер должен совпадать с номером в Нореон Хелс. Ссылка действует 10 минут и только один раз.")}</p>
    <div className="flex flex-wrap gap-3"><a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-body2 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><ExternalLink className="size-4" aria-hidden/>{tx(l,'Բացել Telegram-ը','Open Telegram',"Открыть Telegram")}</a>
    <Button type="button" variant="outline" className="h-auto min-h-11 gap-2 whitespace-normal px-4 py-3" onClick={()=>router.refresh()}><RefreshCw className="size-4" aria-hidden/>{tx(l,'Ստուգել միացումը','Check connection',"Проверить подключение")}</Button></div>
    <Button type="button" variant="ghost" className="h-auto min-h-11 whitespace-normal px-4 py-3" disabled={pending} onClick={connect}>{tx(l,'Ստեղծել նոր հղում','Create a new link',"Создать новую ссылку")}</Button>
   </div>}
  </section>}

  {state==='not_ready'&&<section className={card}><p role="status" className="text-body2">{tx(l,'Telegram-ով հաղորդագրությունները դեռ միացված չեն։ Մենք կտեղեկացնենք, երբ դրանք հասանելի լինեն։','Messages in Telegram are not switched on yet. We will let you know when they are available.',"Сообщения в Telegram пока не включены. Мы сообщим, когда они станут доступны.")}</p></section>}
  {(state==='unavailable'||state==='error')&&<section className={card}><p role={state==='error'?'alert':'status'} className="text-body2">{state==='error'?errorText.error:errorText.enrolment}</p>{state==='error'&&<Button type="button" variant="outline" className="h-auto min-h-11 gap-2 whitespace-normal px-4 py-3" onClick={()=>router.refresh()}><RefreshCw className="size-4" aria-hidden/>{tx(l,'Կրկին փորձել','Try again',"Попробовать снова")}</Button>}</section>}

  {connected&&(state==='linked'||state==='not_linked'||state==='not_ready')&&<section className={card} aria-labelledby="telegram-signin">
   <h2 id="telegram-signin" className="text-h3">{tx(l,'Մուտքի կոդեր','Sign-in codes',"Коды для входа")}</h2>
   <p className="text-body2">{tx(l,'Ձեր մուտքի կոդերը գալիս են այս Telegram հաշվին։','Your sign-in codes arrive in this Telegram account.',"Коды для входа приходят в эту учётную запись Telegram.")}</p>
   {!confirmForget?<Button type="button" variant="outline" className="h-auto min-h-11 gap-2 whitespace-normal px-4 py-3" disabled={pending} onClick={()=>setConfirmForget(true)}><Unlink className="size-4" aria-hidden/>{tx(l,'Սա այլևս իմ Telegram հաշիվը չէ','This is no longer my Telegram account',"Это больше не моя учётная запись Telegram")}</Button>
   :<div role="group" aria-label={tx(l,'Հաստատեք հեռացումը','Confirm removal',"Подтвердите удаление")} className={`${notice} space-y-3 bg-muted/30`}><p>{tx(l,'Դուք դուրս կգաք բոլոր սարքերից։ Հաջորդ անգամ մուտք գործելիս կհաստատեք ձեր համարը Telegram-ում։','You will be signed out on all your devices. Next time you sign in, you confirm your number in Telegram again.',"Вы выйдете из учётной записи на всех устройствах. При следующем входе вы снова подтвердите номер в Telegram.")}</p><div className="flex flex-wrap gap-3"><Button type="button" variant="destructive" className="h-auto min-h-11 whitespace-normal px-4 py-3" disabled={pending} onClick={forget}>{pending?tx(l,'Հեռացվում է…','Removing…',"Удаление…"):tx(l,'Այո, հեռացնել','Yes, remove it',"Да, удалить")}</Button><Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal px-4 py-3" disabled={pending} onClick={()=>setConfirmForget(false)}>{tx(l,'Չեղարկել','Cancel',"Отмена")}</Button></div></div>}
  </section>}

  {message&&<p role={message.tone==='ok'?'status':'alert'} className={`${notice} ${message.tone==='ok'?'bg-surface-subtle-teal':'border-destructive/30 bg-destructive/5 text-destructive'}`}>{message.text}</p>}
  <p className="flex items-start gap-2 text-body2"><PhoneCall className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden/>{tx(l,'Telegram-ը շտապ օգնության համար չէ։ Շտապ դեպքում զանգահարեք 103։','Telegram is not for emergencies. In an emergency, call 103.',"Telegram не предназначен для срочной помощи. В экстренной ситуации позвоните 103.")}</p>
  <CareLink href="/patient/account" icon={ArrowLeft}>{tx(l,'Վերադառնալ պրոֆիլ','Back to profile',"Вернуться в профиль")}</CareLink>
 </div>;
}
