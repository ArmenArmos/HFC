import {pick} from '@/lib/locale';
import {Stethoscope} from 'lucide-react';
import {CareSection,stamp} from '@/components/patient-care/common';
import {handBackToZoeAction} from '@/app/staff/real/conversation/actions';
import {handBackNoticeText,type DoctorModeView,type HandBackNotice} from '@/lib/zoe/doctor-mode';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

const handBackNoticeHy:Record<HandBackNotice,string>={
 handed_back:'Զոն կրկին պատասխանում է այս անդամին։ Անդամը տեղեկացվել է։',
 already_zoe:'Զոն արդեն պատասխանում էր այս անդամին։ Ոչինչ չի փոխվել։',
 unavailable:'Չհաջողվեց։ Թարմացրեք էջը և կրկին փորձեք։',
};

const handBackNoticeRu:Record<HandBackNotice,string>={
 handed_back:'Zoe снова отвечает этому участнику. Участник уведомлён.',
 already_zoe:'Zoe уже отвечала этому участнику. Ничего не изменилось.',
 unavailable:'Не удалось выполнить действие. Обновите страницу и попробуйте снова.',
};

const button='inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring';

/**
 * Doctor takeover on the conversation page: while the doctor has the conversation, Zoe is paused (urgent and red-flag
 * replies still go out) and the doctor can hand it back. Nothing is shown while Zoe answers, unless a notice is due.
 */
export function DoctorMode({memberId,mode,notice,locale='en'}:{memberId:string;mode:DoctorModeView|null;notice:HandBackNotice|null;locale?:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const msg=notice?<p role="status" className="text-body2">{t(handBackNoticeText[notice],handBackNoticeHy[notice],handBackNoticeRu[notice])}</p>:null;
 if(mode===null)return <CareSection title={t('Who answers this member','Ով է պատասխանում այս անդամին',"Кто отвечает этому участнику")}><p className="text-body2">{t('Whether you or Zoe is answering could not be loaded. Reload to try again.','Չհաջողվեց բեռնել՝ Դո՞ւք եք պատասխանում, թե Զոն։ Թարմացրեք էջը՝ կրկին փորձելու համար։',"Не удалось загрузить, кто отвечает: вы или Zoe. Обновите страницу, чтобы попробовать снова.")}</p></CareSection>;
 if(!mode.doctorMode)return msg?<CareSection title={t('Zoe is answering this member','Զոն պատասխանում է այս անդամին',"Этому участнику отвечает Zoe")}>{msg}</CareSection>:null;
 return <CareSection title={t('You are answering this member','Դուք եք պատասխանում այս անդամին',"Этому участнику отвечаете вы")}
  detail={mode.scope==='topic'
   ?t('You replied, so the topic you answered is yours: the member’s follow-ups on it wait for you, and so does anything Zoe is unsure about. A clearly different new question is answered by Zoe, and you see it here. Zoe still sends the urgent advice to call 103 and the crisis text at once, and you get a care alert.','Դուք պատասխանեցիք, ուստի Ձեր պատասխանած թեման Ձերն է․ անդամի հետագա հարցերը դրա վերաբերյալ, ինչպես նաև այն ամենը, ինչում Զոն վստահ չէ, սպասում են Ձեզ։ Հստակ այլ նոր հարցին պատասխանում է Զոն, և Դուք այն տեսնում եք այստեղ։ Զոն դեռ անմիջապես ուղարկում է 103 զանգահարելու շտապ խորհուրդը և ճգնաժամային տեքստը, իսկ Դուք ստանում եք խնամքի ծանուցում։',"Вы ответили, поэтому эта тема закреплена за вами: уточнения участника по ней и вопросы, в которых Zoe не уверена, ждут вашего ответа. На явно другой новый вопрос отвечает Zoe, и вы видите его здесь. Zoe по-прежнему сразу отправляет срочный совет позвонить 103 и текст для кризисной ситуации, а вы получаете оповещение.")
   :t('You replied, so Zoe stopped answering here. New messages wait for you. Zoe still sends the urgent advice to call 103 and the crisis text at once, and you get a care alert.','Դուք պատասխանեցիք, ուստի Զոն այստեղ այլևս չի պատասխանում։ Նոր հաղորդագրությունները սպասում են Ձեզ։ Զոն դեռ անմիջապես ուղարկում է 103 զանգահարելու շտապ խորհուրդը և ճգնաժամային տեքստը, իսկ Դուք ստանում եք խնամքի ծանուցում։',"Вы ответили, поэтому Zoe перестала отвечать здесь. Новые сообщения ждут вашего ответа. Zoe по-прежнему сразу отправляет срочный совет позвонить 103 и текст для кризисной ситуации, а вы получаете оповещение.")}>
  <div className="space-y-3">
   {msg}
   <p className="flex flex-wrap items-center gap-2 text-body2"><Stethoscope className="size-4 shrink-0" aria-hidden/>
    {pick(locale,{ru:mode.byName?`Разговор ведёт ${mode.byName}`:'Разговор передан врачу',hy:mode.byName?`Զրույցը ստանձնել է՝ ${mode.byName}`:'Զրույցը ստանձնված է',en:mode.byName?`${mode.byName} took over`:'Taken over'})}{mode.since?` ${stamp(mode.since,locale)}`:''}</p>
   {mode.intakePaused&&<p className="text-body2">{t('Zoe’s symptom questions are paused. The member’s answers so far are in the symptom summary above.','Զոյի ախտանիշների հարցերը դադարեցված են։ Անդամի մինչ այժմ տրված պատասխանները վերևի ախտանիշների ամփոփման մեջ են։',"Вопросы Zoe о симптомах приостановлены. Уже полученные ответы участника находятся в сводке симптомов выше.")}</p>}
   <form action={handBackToZoeAction}>
    <input type="hidden" name="memberId" value={memberId}/>
    <button className={`${button} bg-primary text-primary-foreground`}>{t('Hand back to Zoe','Վերադարձնել Զոյին',"Передать обратно Zoe")}</button>
   </form>
   <p className="text-caption text-muted-foreground">{pick(locale,{ru:<>{mode.zoeActive?'Участник увидит в приложении и Telegram, что Zoe снова с ним.':'Сейчас Zoe отключена для этого участника, поэтому уведомление не отправится.'}</>,hy:<>{mode.zoeActive?'Անդամը հավելվածում և Telegram-ում կտեսնի, որ Զոն կրկին իր հետ է։':'Զոն այս պահին անջատված է այս անդամի համար, ուստի անդամը չի տեղեկացվի։'}</>,en:<>The member sees “Zoe is with you again.”{mode.zoeActive?' in the app and on Telegram.':' Zoe is off for this member now, so they are not told.'}</>})}</p>
  </div>
 </CareSection>;
}
