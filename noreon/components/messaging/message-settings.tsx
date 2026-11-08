import {ArrowLeft,Bell,Check,MessageCircle,PhoneCall,Settings} from 'lucide-react';
import {CareLink,IconTile} from '@/components/patient-care/common';
import {tx,type PatientLocale} from '@/lib/patient/copy';

/** Telegram link state from readTelegramLink(); null when Telegram is switched off. */
export type MessageTelegramView={state:'linked'|'not_linked'|'unavailable'|'not_ready'|'error';connected:boolean}|null;
const card='journey-card space-y-4';

// Noreon is Telegram-only (18 Oct 2026). The legacy SMS/WhatsApp preference stays in the
// database untouched; this page no longer offers it and shows the Telegram link instead.
export function MessagePreferences({locale:l,telegram}:{locale:PatientLocale;telegram:MessageTelegramView}){
 const manage='/patient/account/telegram';
 return <div className="max-w-2xl space-y-6">
  <header className="flex items-start gap-3"><IconTile icon={Bell}/><div className="min-w-0 space-y-2"><h1 className="min-w-0 text-h1 [overflow-wrap:anywhere]">{tx(l,'Հաղորդագրությունների կարգավորումներ','Message preferences','Настройки сообщений')}</h1><p className="text-body2 text-muted-foreground">{tx(l,'Ձեր խնամքի թիմի հաղորդագրությունները գալիս են Telegram-ով։','Messages from your care team come through Telegram.','Сообщения от вашей медицинской команды приходят в Telegram.')}</p></div></header>
  {telegram?.state==='linked'?<section className={card} aria-labelledby="telegram-status">
   <h2 id="telegram-status" className="flex items-center gap-2 text-h3"><Check className="size-5 shrink-0 text-brand-teal" aria-hidden/>{tx(l,'Telegram-ը միացված է','Telegram is connected','Telegram подключён')}</h2>
   <p className="text-body2">{tx(l,'Ձեր խնամքի թիմի հաղորդագրությունները գալիս են Telegram-ով։','Messages from your care team arrive in Telegram.','Сообщения от вашей медицинской команды приходят в Telegram.')}</p>
   <p className="text-body2 text-muted-foreground">{tx(l,'Կարող եք ցանկացած պահի անջատել պատասխանները Telegram-ի կարգավորումներում։','You can turn replies off at any time in your Telegram settings.','Вы можете в любое время отключить ответы в настройках Telegram.')}</p>
   <CareLink href={manage} icon={Settings}>{tx(l,'Կառավարել կամ անջատել պատասխանները','Manage or turn off replies','Настроить или отключить ответы')}</CareLink>
  </section>
  :telegram?.state==='not_linked'?<section className={card} aria-labelledby="telegram-status">
   <h2 id="telegram-status" className="text-h3">{telegram.connected?tx(l,'Պատասխանները Telegram-ում անջատված են','Replies in Telegram are off','Ответы в Telegram отключены'):tx(l,'Telegram-ը միացված չէ','Telegram is not connected','Telegram не подключён')}</h2>
   <p className="text-body2">{tx(l,'Միացնելուց հետո ձեր խնամքի թիմի հաղորդագրությունները կգան Telegram-ով։','Once connected, messages from your care team arrive in Telegram.','После подключения сообщения от вашей медицинской команды будут приходить в Telegram.')}</p>
   <CareLink href={manage} icon={MessageCircle} variant="primary">{telegram.connected?tx(l,'Միացնել պատասխանները Telegram-ում','Turn on replies in Telegram','Включить ответы в Telegram'):tx(l,'Միացնել Telegram-ը','Connect Telegram','Подключить Telegram')}</CareLink>
  </section>
  :<section className={card}><p role={telegram?.state==='error'?'alert':'status'} className="text-body2">{telegram?.state==='error'?tx(l,'Չհաջողվեց ստուգել Telegram-ի կարգավիճակը։ Փորձեք մի քանի րոպեից։','We could not check your Telegram status. Try again in a few minutes.','Не удалось проверить статус Telegram. Попробуйте через несколько минут.'):telegram?.state==='unavailable'?tx(l,'Telegram-ով հաղորդագրությունները կմիանան, երբ ավարտեք գրանցումը և ուղարկեք դիտարկման հայտը։','Messages in Telegram start once your enrolment is complete and your review request is sent.','Сообщения в Telegram станут доступны после завершения регистрации и отправки запроса на рассмотрение.'):tx(l,'Telegram-ն այս պահին հասանելի չէ։ Կարող եք գրել ձեր խնամքի թիմին Noreon-ում։','Telegram is unavailable right now. You can message your care team in Noreon.','Telegram сейчас недоступен. Вы можете написать вашей медицинской команде в Noreon.')}</p></section>}
  <p className="flex items-start gap-2 text-body2"><PhoneCall className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden/>{tx(l,'Telegram-ը շտապ օգնության համար չէ։ Շտապ դեպքում զանգահարեք 103։','Telegram is not for emergencies. In an emergency, call 103.','Telegram не предназначен для экстренной помощи. В экстренной ситуации звоните 103.')}</p>
  <CareLink href="/patient/account" icon={ArrowLeft}>{tx(l,'Վերադառնալ պրոֆիլ','Back to profile','Вернуться в профиль')}</CareLink>
 </div>;
}
