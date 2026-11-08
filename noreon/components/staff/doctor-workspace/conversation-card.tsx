'use client';
import {useRef,useState} from 'react';
import type {Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import type {DoctorCardResponse} from '@/lib/staff-zoe/card-read';
import {readDoctorCard} from '@/lib/staff-zoe/card-actions';
import {handBackDoctorCard,markDoctorCardReviewed} from '@/lib/staff-zoe/everyday-actions';
import {conversationActions,commandConversation,composeConversationReply,editConversationSummary,recoverConversationCommand,readZoeReplyDrafts} from '@/app/staff/real/conversation/actions';
import {ConversationReview} from '@/components/conversation/review';

type Data=Extract<DoctorCardResponse,{kind:'ready';card:'conversation'}>;
/** Keep the existing editor and recovery protocol mounted while its read refreshes mode/queue controls. */
export function DoctorConversationCard({response,doctorId,doctorName,locale,onRefresh}:{onRefresh?:()=>void;response:Data;doctorId:string;doctorName:string;locale:Locale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const [data,setData]=useState(response),[notice,setNotice]=useState(''),[locked,setLocked]=useState(false);
 const [confirmHandback,setConfirmHandback]=useState(false);
 const busy=useRef(false);
 async function read(){
  onRefresh?.();
  const fresh=await readDoctorCard({card:'conversation',conversationId:data.conversationId},doctorId);
  if(fresh.kind!=='ready'||fresh.card!=='conversation')throw Error('Conversation unavailable');
  setData(fresh);setLocked(false);setConfirmHandback(false);return fresh;
 }
 async function mark(action:'reviewed'|'reopen'){
  if(busy.current||locked||!data.zoeReview)return;busy.current=true;setLocked(true);
  try{const result=await markDoctorCardReviewed({conversationId:data.conversationId,action,version:data.zoeReview.version},doctorId);
   if(result.kind==='saved')onRefresh?.();
   setNotice(result.kind==='saved'?(action==='reviewed'?t('Marked reviewed. New messages bring it back.','Նշված է որպես դիտված։ Նոր հաղորդագրությունները կվերադարձնեն այն։','Отмечено как просмотренное. Новые сообщения вернут его в очередь.'):t('Reopened for your reply.','Վերաբացված է ձեր պատասխանի համար։','Разговор вновь открыт для вашего ответа.')):result.kind==='off'?off():changed());
  }catch{setNotice(uncertain());}finally{busy.current=false;}
 }
 const changed=()=>t('The conversation changed or access is unavailable. Reload the conversation before continuing.','Զրույցը փոխվել է կամ հասանելի չէ։ Շարունակելուց առաջ թարմացրեք զրույցը։','Разговор изменился или доступ недоступен. Обновите разговор перед продолжением.');
 const off=()=>t('This feature is switched off. No change was saved.','Այս հնարավորությունն անջատված է։ Փոփոխություն չի պահպանվել։','Эта функция отключена. Изменения не сохранены.');
 const inactive=()=>t('Zoe is disabled or this member’s consent has been withdrawn. You are still answering.','Զոյան անջատված է կամ այս անդամը հետ է վերցրել իր համաձայնությունը։ Դուք շարունակում եք պատասխանել։','Зоя отключена или участник отозвал согласие. Вы продолжаете отвечать.');
 const uncertain=()=>t('The result is unknown. Reload the conversation to check before making another change.','Արդյունքն անհայտ է։ Նոր փոփոխությունից առաջ թարմացրեք զրույցը՝ ստուգելու համար։','Результат неизвестен. Обновите разговор и проверьте его перед новым изменением.');
 async function handBack(){
  if(busy.current||locked||!confirmHandback||!data.mode?.zoeActive||!data.modeRevision||!('version'in data.initial))return;busy.current=true;setLocked(true);
  try{const result=await handBackDoctorCard({conversationId:data.conversationId,version:data.initial.version,modeRevision:data.modeRevision},doctorId);
   if(result.kind==='saved'){
    // Re-read the authoritative mode; a successful write must not leave stale controls.
    try{const fresh=await read();setNotice(fresh.mode?.doctorMode?changed():!fresh.mode?.zoeActive?inactive():t('Zoe is answering again. The hand-back notice is queued; delivery is not confirmed.','Զոյան կրկին պատասխանում է։ Վերադարձի ծանուցումը հերթում է. առաքումը հաստատված չէ։','Зоя снова отвечает. Уведомление о передаче в очереди; доставка не подтверждена.'));}
    catch{setNotice(t('Hand-back saved. The current answering mode could not be loaded. Refresh before another change.','Վերադարձը պահպանված է։ Ընթացիկ պատասխանողի ռեժիմը չհաջողվեց բեռնել։ Նոր փոփոխությունից առաջ թարմացրեք։','Передача сохранена. Не удалось загрузить текущий режим ответов. Обновите перед новым изменением.'));}
    return;
   }
   setNotice(result.kind==='zoe_inactive'?inactive():result.kind==='off'?off():changed());
  }catch{setNotice(uncertain());}finally{busy.current=false;setConfirmHandback(false);}
 }
 const takeover=data.mode?.zoeActive&&!data.mode.doctorMode;
 return <section className="space-y-4">
  <div className="space-y-2 rounded-lg border p-3">
   <p className="text-body2 font-semibold">{data.mode?.doctorMode?t('You are answering this member','Դուք եք պատասխանում այս անդամին','Этому участнику отвечаете вы'):data.mode?.zoeActive?t('Zoe is answering this member','Զոյան է պատասխանում այս անդամին','Этому участнику отвечает Зоя'):t('Zoe is unavailable','Զոյան հասանելի չէ','Зоя недоступна')}</p>
   <p className="text-body2">{t('Approving your reply takes over its topic or conversation according to the current setting. Urgent advice still goes out immediately.','Ձեր պատասխանը հաստատելիս ստանձնում եք թեման կամ զրույցը՝ ըստ ընթացիկ կարգավորման։ Շտապ խորհուրդը շարունակում է անմիջապես ուղարկվել։','Подтверждая ответ, вы берёте на себя тему или разговор согласно текущей настройке. Срочные рекомендации по-прежнему отправляются сразу.')}</p>
   {data.mode?.doctorMode&&<button type="button" className="dw-pill" disabled={locked||!data.mode.zoeActive} onClick={()=>setConfirmHandback(true)}>{t('Hand back to Zoe','Վերադարձնել Զոյային','Передать обратно Зое')}</button>}
   {data.mode?.doctorMode&&!data.mode.zoeActive&&<p className="text-body2">{inactive()}</p>}
   {confirmHandback&&data.mode?.zoeActive&&<div className="space-y-2"><p className="text-body2">{t('Zoe will answer again and a hand-back notice will be queued for this member.','Զոյան կրկին կպատասխանի, և այս անդամի համար վերադարձի ծանուցումը կտեղադրվի հերթում։','Зоя снова будет отвечать, а уведомление о передаче будет поставлено в очередь для этого участника.')}</p><button type="button" disabled={locked} className="dw-pill" onClick={handBack}>{t('Confirm hand-back','Հաստատել վերադարձը','Подтвердить передачу')}</button></div>}
   {data.zoeReview&&<div className="flex flex-wrap gap-2">
    {!data.zoeReview.reviewed&&<button type="button" className="dw-pill" disabled={locked} onClick={()=>mark('reviewed')}>{t('Mark reviewed','Նշել որպես դիտված','Отметить просмотренным')}</button>}
    <button type="button" className="dw-pill" disabled={locked} onClick={()=>mark('reopen')}>{t('Reopen for my reply','Վերաբացել իմ պատասխանի համար','Открыть для моего ответа')}</button>
   </div>}
   {notice&&<p role="status" className="text-body2">{notice}</p>}
  </div>
  <ConversationReview embedded memberId={data.memberId} doctorName={doctorName} locale={locale} initial={response.initial} replyDrafts={response.replyDrafts} topicBreaks={data.topicBreaks}
   approvalEffect={takeover?<p className="text-body2">{data.mode?.scope==='topic'?t('Approving this reply takes over this topic. Other clearly separate questions can still go to Zoe.','Այս պատասխանի հաստատմամբ ստանձնում եք այս թեման։ Հստակ այլ հարցերին Զոյան կարող է շարունակել պատասխանել։','Подтверждение ответа закрепит за вами эту тему. На явно отдельные вопросы по-прежнему может отвечать Зоя.'):t('Approving this reply pauses Zoe’s routine replies here until you hand back.','Այս պատասխանի հաստատումը դադարեցնում է Զոյայի սովորական պատասխաններն այստեղ մինչև վերադարձը։','Подтверждение ответа приостановит обычные ответы Зои здесь до передачи обратно.')}</p>:undefined}
   ports={{read:async()=>(await read()).initial,replyDrafts:()=>readZoeReplyDrafts(data.memberId),
    actions:()=>conversationActions(data.memberId),compose:composeConversationReply,summary:editConversationSummary,recover:input=>recoverConversationCommand(data.memberId,input),
    command:input=>commandConversation(input,(input as {purpose?:string}).purpose==='reply.approve'?{memberId:data.memberId,modeRevision:data.modeRevision}:undefined)}}/>
 </section>;
}
