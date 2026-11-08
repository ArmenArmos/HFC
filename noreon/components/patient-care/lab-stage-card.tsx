import{FlaskConical}from'lucide-react';
import{copy}from'./common';
import{testTitle}from'@/lib/patient/catalogue-label';
import type{PatientLocale}from'@/lib/patient/copy';
import{currentStage,memberLabSummary,type MemberLabSample}from'@/lib/staff/lab-stage-schema';

const stageLabel={collected:['Collected','Վերցված է','Собраны'],'at-lab':['At the lab','Լաբորատորիայում է','В лаборатории'],'results-received':['Results received','Արդյունքները ստացված են','Результаты получены']} as const;

/** Home state for samples. "Being processed" appears only once a sample has
 * actually reached the lab; an uncollected test never produces a sample here. */
export function LabStageCard({samples,locale:l,separateRelease=false}:{samples:MemberLabSample[];locale:PatientLocale;separateRelease?:boolean}){
 const summary=memberLabSummary(samples);if(!summary)return null;
 const text=summary==='at-lab'
  ?{title:copy(l,'Your results are being processed','Ձեր արդյունքները մշակվում են', "Ваши результаты обрабатываются"),detail:copy(l,'Your samples have reached the lab. Results are not available yet.','Ձեր նմուշները հասել են լաբորատորիա։ Արդյունքները դեռ հասանելի չեն։', "Ваши образцы поступили в лабораторию. Результаты пока недоступны.")}
  :summary==='partial'
  ?{title:copy(l,'Some of your samples have reached the lab','Ձեր նմուշներից մի քանիսը հասել են լաբորատորիա', "Некоторые ваши образцы поступили в лабораторию"),detail:copy(l,'Others have not reached the lab yet. Each test’s status is below.','Մյուսները դեռ չեն հասել լաբորատորիա։ Յուրաքանչյուր հետազոտության կարգավիճակը ստորև է։', "Остальные пока не поступили в лабораторию. Статус каждого анализа указан ниже.")}
  :summary==='collected'
  ?{title:copy(l,'Your samples were collected','Ձեր նմուշները վերցված են', "Ваши образцы собраны"),detail:copy(l,'The nurse recorded your samples as collected. They have not reached the lab yet.','Բուժքույրը գրանցել է, որ նմուշները վերցված են։ Դրանք դեռ չեն հասել լաբորատորիա։', "Медсестра отметила, что ваши образцы собраны. Они пока не поступили в лабораторию.")}
  :{title:copy(l,'Your lab results have arrived','Ձեր լաբորատոր արդյունքները ստացվել են', "Ваши лабораторные результаты получены"),detail:separateRelease?copy(l,'They will be shared with you after approval. No action is needed from you right now.','Դրանք ձեզ հետ կկիսվեն հաստատումից հետո։ Այս պահին ձեզնից գործողություն չի պահանջվում։', "Вы получите к ним доступ после утверждения. Сейчас от вас не требуется никаких действий."):copy(l,'Your results and care plan will appear together after approval. No action is needed from you right now.','Արդյունքներն ու խնամքի պլանը կհայտնվեն միասին՝ հաստատումից հետո։ Այս պահին ձեզնից գործողություն չի պահանջվում։', "Ваши результаты и план лечения появятся вместе после утверждения. Сейчас от вас не требуется никаких действий.")};
 return <section aria-labelledby="lab-stage-card-title" className="journey-card space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
  <header className="space-y-2"><h2 id="lab-stage-card-title" className="flex items-center gap-2 text-h2"><FlaskConical className="size-5 shrink-0 text-brand-teal" aria-hidden/>{text.title}</h2><p className="max-w-2xl text-body2 text-muted-foreground">{text.detail}</p></header>
  <ul className="divide-y">{samples.map(sample=>{const stage=currentStage(sample);return <li key={sample.entryId} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-body2"><span className="min-w-0 break-words font-medium">{sample.title?testTitle({id:sample.testId,title:sample.title},l):copy(l,'Lab sample','Լաբորատոր նմուշ', "Лабораторный образец")}</span><span className="text-muted-foreground">{copy(l,stageLabel[stage][0],stageLabel[stage][1], stageLabel[stage][2])}</span></li>;})}</ul>
 </section>;
}
