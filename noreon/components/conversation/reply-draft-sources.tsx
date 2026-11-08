import {BookOpenCheck,Scale} from 'lucide-react';
import {stamp} from '@/components/patient-care/common';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {judgementReasonText,planItemKindLabel,type ZoeReplyDraftView} from '@/lib/zoe/reply-draft-contracts';

/**
 * How Zoe prepared a structured reply draft (lib/zoe/reply-draft.ts): what the member asked, the published plan
 * items the reply quotes word for word, and what only the doctor decides. Shown next to the reply editor; the
 * doctor still approves, edits or rejects the exact reply.
 */
export function ReplyDraftSources({source,edited,locale='en',messageAt}:{source:ZoeReplyDraftView;edited:boolean;locale?:StaffLocale;messageAt?:string}){
 const kindLabel:Record<ZoeReplyDraftView['quoted'][number]['kind'],string>={
  instruction:st(locale,planItemKindLabel.instruction,'Խնամքի ցուցումներ','Указания по уходу'),
  explanation:st(locale,planItemKindLabel.explanation,'Բացատրություն','Объяснение'),
  next_step:st(locale,planItemKindLabel.next_step,'Հաջորդ քայլը','Следующий шаг'),
  medicine:st(locale,planItemKindLabel.medicine,'Դեղ','Лекарство'),
 };
 const reasonText:Record<string,string>={
  outside_plan:st(locale,judgementReasonText.outside_plan,'անդամը հարցնում է մի բանի մասին, որը հրապարակված պլանը չի պարզաբանում','вопрос участника не решён в опубликованном плане'),
  doctor_decides:st(locale,judgementReasonText.doctor_decides,'Զոյան թվարկել է կետեր, որոնք միայն դուք կարող եք որոշել','Зоя перечислила вопросы, которые можете решить только вы'),
  medicine_quoted:st(locale,judgementReasonText.medicine_quoted,'սևագիրը մեջբերում է պլանի՝ դեղին վերաբերող տողը','в черновике процитирована строка плана о лекарстве'),
  medicine_question:st(locale,judgementReasonText.medicine_question,'անդամը հարցնում է դեղի մասին','участник спрашивает о лекарстве'),
  no_published_plan:st(locale,judgementReasonText.no_published_plan,'անդամը դեռ հրապարակված պլան չունի','у участника пока нет опубликованного плана'),
  no_plan_item_chosen:st(locale,judgementReasonText.no_plan_item_chosen,'պլանի ոչ մի կետ չի պատասխանում հարցին','ни один пункт плана не отвечает на вопрос'),
 };
 return <section aria-labelledby={`zoe-sources-${source.runId}`} className="space-y-4 rounded-lg border p-4">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h3 id={`zoe-sources-${source.runId}`} className="flex items-center gap-2 text-body2 font-semibold"><BookOpenCheck className="size-4" aria-hidden/>{st(locale,'How Zoe prepared this draft','Ինչպես է Զոյան պատրաստել այս սևագիրը','Как Зоя подготовила этот черновик')}</h3>
   {source.needsJudgement
    ?<span className="rounded-full border border-destructive/40 px-3 py-1 text-caption font-semibold">{st(locale,'Needs doctor judgement','Պահանջվում է բժշկի որոշումը','Требуется решение врача')}</span>
    :<span className="rounded-full border px-3 py-1 text-caption">{st(locale,'Restates the published plan','Վերարտադրում է հրապարակված պլանը','Повторяет опубликованный план')}</span>}
  </div>
  {edited&&<p className="text-caption text-muted-foreground">{st(locale,'You changed the reply since Zoe prepared it. The sources below are for Zoe’s original draft.','Դուք փոխել եք պատասխանը Զոյայի պատրաստելուց հետո։ Ստորև բերված աղբյուրները վերաբերում են Զոյայի սկզբնական սևագրին։','Вы изменили ответ после того, как Зоя его подготовила. Источники ниже относятся к исходному черновику Зои.')}</p>}
  <div className="space-y-1"><p className="text-caption font-semibold text-muted-foreground">{st(locale,'Member’s message','Անդամի հաղորդագրություն','Сообщение участника')}{messageAt?` · ${stamp(messageAt,locale)}`:''}</p><p className="text-body2">{source.asked}</p></div>
  <div className="space-y-2">
   <p className="text-caption font-semibold text-muted-foreground">{source.planId?`${st(locale,'Quoted word for word from the plan published','Բառացի մեջբերում հրապարակված պլանից՝','Дословная цитата из плана, опубликованного')} ${source.planPublishedAt?stamp(source.planPublishedAt,locale):''}`:st(locale,'No published plan to quote','Մեջբերման համար հրապարակված պլան չկա','Нет опубликованного плана для цитирования')}</p>
   {source.planId&&!source.planCurrent&&<p role="alert" className="rounded-lg border border-destructive/40 p-3 text-body2">{st(locale,'The published plan changed after Zoe prepared this draft. Check the quotes against the current plan before approving.','Հրապարակված պլանը փոխվել է Զոյայի՝ այս սևագիրը պատրաստելուց հետո։ Հաստատելուց առաջ մեջբերումները համեմատեք ընթացիկ պլանի հետ։','Опубликованный план изменился после подготовки этого черновика Зои. Перед одобрением сверьте цитаты с текущим планом.')}</p>}
   {source.quoted.length?<ul className="space-y-2">{source.quoted.map(q=><li key={q.id} className="border-l-2 border-primary/20 pl-3"><p className="text-caption text-muted-foreground">{kindLabel[q.kind]}</p><p className="text-body2">{q.text}</p></li>)}</ul>
    :<p className="text-body2">{st(locale,'The reply quotes nothing from the plan.','Պատասխանում պլանից մեջբերում չկա։','В ответе нет цитат из плана.')}</p>}
  </div>
  {source.needsJudgement&&<div className="space-y-2 rounded-lg bg-muted/40 p-3">
   <p className="flex items-center gap-2 text-body2 font-semibold"><Scale className="size-4" aria-hidden/>{st(locale,'Only you can decide','Միայն դուք կարող եք որոշել','Только вы можете решить')}</p>
   {source.doctorDecides.length>0&&<ul className="list-disc space-y-1 pl-5 text-body2">{source.doctorDecides.map((d,i)=><li key={i}>{d}</li>)}</ul>}
   <p className="text-caption text-muted-foreground">{st(locale,'Why:','Պատճառը՝','Причина:')} {source.judgementReasons.map(r=>reasonText[r]??st(locale,'your judgement is needed','պահանջվում է ձեր գնահատումը','требуется ваше решение')).join('; ')}.</p>
   <p className="text-body2">{st(locale,'The draft ends by saying you will confirm what to do. Add your decision to the reply, or keep it and follow up.','Սևագիրն ավարտվում է նրանով, որ դուք կհաստատեք հետագա քայլերը։ Ավելացրեք ձեր որոշումը պատասխանին կամ պահեք այն և պատասխանեք ավելի ուշ։','В конце черновика сказано, что вы подтвердите дальнейшие действия. Добавьте своё решение в ответ или сохраните его и ответьте позже.')}</p>
  </div>}
  <p className="text-caption text-muted-foreground">{st(locale,'Every sentence of the reply is Noreon’s approved wording or your published plan, word for word. Zoe only chose which lines fit; the AI wrote none of the text.','Պատասխանի յուրաքանչյուր նախադասություն բառացի վերցված է Նորեոն Հելթի հաստատված ձևակերպումներից կամ ձեր հրապարակված պլանից։ Զոյան միայն ընտրել է համապատասխան տողերը․ արհեստական բանականությունը տեքստ չի գրել։','Каждое предложение ответа дословно взято из одобренных формулировок Нореон Хелс или вашего опубликованного плана. Зоя лишь выбрала подходящие строки; ИИ не написал ни одной части текста.')}</p>
 </section>;
}
