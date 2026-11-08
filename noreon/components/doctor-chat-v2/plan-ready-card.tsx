'use client';
import {useRef,useState} from 'react';
import {safeConsultationProposal} from '@/lib/patient-care/consultation-proposal';
import {useConsultationDecision} from '@/components/real-review/use-consultation-decision';
import {hasEvidencePath} from '@/lib/patient-care/required-evidence';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {staffServerText} from '@/lib/staff/staff-server-copy';
import {planDisplayText} from '@/lib/ai-plan/display';
import {detectPlanSummaryLanguage,planStaffLanguageLabel} from '@/lib/ai-plan/language';
import {firstPublicationGate,consultationPublicationGate} from '@/lib/doctor-decisions/publication-gate';
import type {ApprovalCards,ClinicalCardCommand} from '@/lib/doctor-decisions/approvals';
import type {ChatAiPlanResponse} from '@/lib/staff-zoe/chat-v2-actions';
import type {DraftEditorState} from '@/components/real-review/forms';
import type {DraftField} from '@/lib/ai-plan/contracts';
import type {ClinicalFormState} from '@/lib/patient-care/clinical-actions';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {withClinicalTimeout} from '@/lib/patient-care/action-timeout';
import type {PlanLabFile} from '@/lib/staff-zoe/plan-ready';
import {LabCheckLink} from './lab-review-action';

export function PlanLabFileLinks({files,memberId,locale}:{files:PlanLabFile[];memberId:string;locale:StaffLocale}){
 if(!files.length)return null;
 const label=st(locale,'Open the lab file','Բացել լաբորատոր ֆայլը','Открыть файл анализов');
 return <ul className="min-w-0 space-y-1">{files.map(file=><li key={file.fileId} className="break-words"><LabCheckLink href={`/staff/real/members/${memberId}/documents/${file.fileId}/check`} locale={locale} label={`${label}: ${file.fileName}`}/></li>)}</ul>;
}

type Props={editor?:DraftEditorState;draft:Extract<ChatAiPlanResponse,{kind:'ai-plan'}>;approvals:ApprovalCards;locale:StaffLocale;urgent:boolean;urgentReason:string;unavailable:boolean;formId:string;onReviewLabs?:()=>void;onDetails:()=>void;onRecord:(notes:Record<string,string>)=>Promise<void>;onPress:(command:ClinicalCardCommand)=>Promise<ClinicalFormState>;onRefresh:()=>Promise<void>};
export function PlanReadyCard({editor,draft,approvals,locale,urgent,urgentReason,unavailable,formId,onReviewLabs,onDetails,onRecord,onPress,onRefresh}:Props){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const ready=draft.ready,card=approvals.regimen,review=approvals.consultation?.review??card?.clinicalReview;
 const proposal=safeConsultationProposal(review,ready?.proposal,!!ready?.reviewCurrent&&ready.urgency===review?.engine.urgency&&!draft.stale&&review?.evidenceToken===draft.snapshot.evidenceToken&&!unavailable,urgent);
 const {decision,reason,proposed,changeDecision,changeReason}=useConsultationDecision(`${draft.snapshot.id}:${draft.snapshot.evidenceToken}:${ready?.urgency}`,proposal);
 const proposalLanguageLabel=proposed&&proposal&&detectPlanSummaryLanguage(proposal.note)==='en'?planStaffLanguageLabel(locale):null;
 const [notes,setNotes]=useState<Record<string,string>>({}),[approvedHash,setApprovedHash]=useState(''),[summary,setSummary]=useState('');
 const [pending,setPending]=useState(false),[feedback,setFeedback]=useState(''),[failed,setFailed]=useState(false);
 const locked=useRef(false);
 const results=ready?.results??[],missing=results.filter(test=>!test.recorded);
 const sources=[...new Map(missing.filter(test=>test.source).map(test=>[test.source!.attachmentId,test.source!])).values()];
 const defaults=Object.fromEntries(sources.map(source=>[source.attachmentId,t(`Recorded from ${source.fileName}, ${[...new Set(source.values.map(value=>value.collectedOn))].join(', ')}`,`Գրանցված է ${source.fileName} ֆայլից, ${[...new Set(source.values.map(value=>value.collectedOn))].join(', ')}`,`Записано из ${source.fileName}, ${[...new Set(source.values.map(value=>value.collectedOn))].join(', ')}`)]));
 const labCount=draft.labEvidence?.values.filter(value=>value.status==='unverified').length??0;
 const labFiles=ready?.labFiles??[],unreviewedFiles=labFiles.filter(file=>file.needsReview);
 const fileLinks=(files:PlanLabFile[])=><PlanLabFileLinks files={files} memberId={draft.snapshot.id} locale={locale}/>;
 const labsUnknown=!!draft.generation&&!draft.labEvidence;
 const saved=!!draft.snapshot.draft;
 const savedCurrent=!editor?.dirty&&!!ready?.reviewCurrent&&saved&&!draft.snapshot.draftStale&&draft.savedDraftCurrent!==false&&!!card?.current;
 const hasMedicines=!!card?.review.draft?.medicines.length;
 const regimenApproved=!hasMedicines||approvedHash===card?.review.draft?.approvalHash;
 const consultationNeeded=!review||review.consultation.decision==='undecided';
 const consultationGate=review?consultationPublicationGate(review):null;
 const gate=card?(card.publicationGate!==undefined?card.publicationGate:firstPublicationGate(card.clinicalReview,card.current)):null;
 const gateReason=gate?.kind==='lab'?t(`Needs ${gate.title} result: review lab file`,`${gate.title} հետազոտության արդյունքն անհրաժեշտ է․ վերանայեք լաբորատոր ֆայլը`,`Нужен результат ${gate.title}: проверьте файл анализов`)
 :gate?.kind==='source'?t('Review and approve the lab file','Վերանայեք և հաստատեք լաբորատոր ֆայլը','Проверьте и утвердите файл анализов')
 :gate?.kind==='evidence'?t(`Confirm ${gate.title} on the Evidence tab`,`Հաստատեք ${gate.title} հետազոտությունը «Տվյալներ» ներդիրում`,`Подтвердите ${gate.title} на вкладке «Данные»`)
 :gate?.kind==='unsupported'?t(`${gate.title} cannot be confirmed in Noreon yet. Review the evidence pathway`,`${gate.title} հետազոտությունը դեռ հնարավոր չէ հաստատել Նորեոն Հելթում։ Վերանայեք տվյալների գրանցման ուղին`,`${gate.title} пока нельзя подтвердить в Нореон Хелс. Проверьте способ регистрации данных`):'';
 const sourceReason=gate?.kind==='source'||gate?.kind==='lab'&&!!gate.reportId?gateReason:'';
 const completionReason=consultationGate?.kind==='abnormal-consultation'?t('An abnormal investigation needs a completed consultation first','Հետազոտության շեղված արդյունքի դեպքում նախ անհրաժեշտ է ավարտված խորհրդատվություն','При отклонении в исследовании сначала нужна завершённая консультация')
 :consultationGate?.kind==='completion'?t('Record the completed consultation','Գրանցեք կայացած խորհրդատվությունը','Запишите состоявшуюся консультацию'):'';
 const evidenceReason=draft.stale?t('The evidence changed after this draft was prepared. Prepare a new draft before using it.','Այս սևագիրը պատրաստելուց հետո տվյալները փոխվել են։ Այն օգտագործելուց առաջ պատրաստեք նոր սևագիր։','После подготовки этого черновика данные изменились. Подготовьте новый черновик перед использованием.'):
 !ready||unavailable?t('The current case could not be reloaded. Try again.','Ընթացիկ դեպքը չհաջողվեց թարմացնել։ Փորձեք կրկին։','Не удалось обновить случай. Попробуйте снова.'):
 '';
 const matchReason=(test:typeof results[number])=>test.method!=='lab'?(hasEvidencePath(test.id)?t(`Confirm ${test.title} on the Evidence tab`,`Հաստատեք ${test.title} հետազոտությունը «Տվյալներ» ներդիրում`,`Подтвердите ${test.title} на вкладке «Данные»`):t(`${test.title} cannot be confirmed in Noreon yet. Review the evidence pathway`,`${test.title} հետազոտությունը դեռ հնարավոր չէ հաստատել Նորեոն Հելթում։ Վերանայեք տվյալների գրանցման ուղին`,`${test.title} пока нельзя подтвердить в Нореон Хелс. Проверьте способ регистрации данных`)):
 test.reason==='date'?staffServerText(locale,'Lab results must be dated on or after the questionnaire and not in the future'):test.reason==='before'?t('Dated before the questionnaire','Թվագրված է հարցաշարից առաջ','Датировано раньше анкеты'):t('Not read from any file','Ոչ մի ֆայլից չի կարդացվել','Не прочитано ни из одного файла');
 const recordLabel=t('Record matched results','Գրանցել համապատասխան արդյունքները','Записать совпавшие результаты');
 const acceptLabel=t('Accept prepared fields','Ընդունել պատրաստված դաշտերը','Принять подготовленные поля');
 const consultLabel=t('Save consultation decision','Պահպանել խորհրդատվության որոշումը','Сохранить решение о консультации');
 const publishLabel=t('Approve and publish','Հաստատել և հրապարակել','Утвердить и опубликовать');
 const saveLabel=t('Use this draft','Օգտագործել այս սևագիրը','Использовать этот черновик');
 const next=labCount||labsUnknown?'labs':!saved?'accept':!ready?.reviewCurrent?'save':sources.length?'results':consultationNeeded?'consultation':!savedCurrent?'save':!regimenApproved?'regimen':'publish';
 const label=urgent?t('Review urgent alert','Վերանայել շտապ ահազանգը','Проверить срочное оповещение'):next==='labs'?t('Review these values','Վերանայել այս արժեքները','Проверить эти значения'):next==='accept'?acceptLabel:next==='results'?recordLabel:next==='consultation'?consultLabel:next==='save'?saveLabel:next==='regimen'?t('Approve regimen','Հաստատել դեղերի ցանկը','Утвердить схему лечения'):publishLabel;
 const routineBlock=ready?.urgency==='orange'?staffServerText(locale,'Routine publication is on hold: the native source-specific mandatory consultation pathway is unavailable. Follow the clinical rule guidance; this workspace cannot record its completion.'):'';
 const hardBlock=urgent?urgentReason:routineBlock||evidenceReason;
 const blocked=editor?.pending?t('Saving draft…','Սևագիրը պահպանվում է…','Сохраняется черновик…'):editor?.blocked?t('Review the draft changes before continuing.','Շարունակելուց առաջ վերանայեք սևագրի փոփոխությունները։','Проверьте изменения черновика перед продолжением.'):hardBlock||failed?t('Refresh evidence before continuing.','Շարունակելուց առաջ թարմացրեք տվյալները։','Обновите данные перед продолжением.'):
 next==='labs'&&!onReviewLabs?t('Review and approve the lab file','Վերանայեք և հաստատեք լաբորատոր ֆայլը','Проверьте и утвердите файл анализов'):
 next==='consultation'&&!decision?t('Record whether a consultation is needed','Գրանցեք՝ արդյոք խորհրդատվություն անհրաժեշտ է','Укажите, нужна ли консультация'):
 next==='consultation'&&!reason.trim()?t('Enter your clinical reason for this decision.','Մուտքագրեք այս որոշման կլինիկական պատճառը։','Укажите клиническую причину этого решения.'):
 next==='publish'?(!ready?.sourcesAvailable?t('Clinic lab results could not be read. Reload the page.','Կլինիկայի լաբորատոր արդյունքները չհաջողվեց կարդալ։ Թարմացրեք էջը։','Не удалось прочитать лабораторные результаты клиники. Обновите страницу.'):missing.length?gateReason||missing.map(test=>`${planDisplayText(test.title,locale)}: ${matchReason(test)}`).join('; '):completionReason||gateReason||(!card?t('No saved plan is waiting for approval.','Հաստատման սպասող պահպանված պլան չկա։','Нет сохранённого плана, ожидающего утверждения.'):card.review.versions.length&&!summary.trim()?t('Describe what changed for the member','Նկարագրեք՝ ինչ է փոխվել անդամի համար','Опишите для участника, что изменилось'):'') ):'';
 async function run(action:()=>Promise<void>){
  if(locked.current)return;locked.current=true;setPending(true);setFeedback('');
  try{await withClinicalTimeout(action);}catch{setFailed(true);setFeedback(t('The result could not be confirmed. Refresh the current case and check its history before trying again.','Արդյունքը չհաջողվեց հաստատել։ Կրկին փորձելուց առաջ թարմացրեք ընթացիկ դեպքը և ստուգեք դրա պատմությունը։','Не удалось подтвердить результат. Обновите текущий случай и проверьте его историю перед повторной попыткой.'));}
  finally{locked.current=false;setPending(false);}
 }
 async function press(command:ClinicalCardCommand){const result=await onPress(command);if(!result.ok){setFeedback(staffServerText(locale,result.message));setFailed(true);}}
 function save(){if(hasMedicines)setApprovedHash(card!.review.draft!.approvalHash);(document.getElementById(formId) as HTMLFormElement|null)?.requestSubmit();}
 function act(){if(blocked||pending)return;
  if(next==='labs'){onReviewLabs?.();return;}
  if(next==='accept'||next==='save'){save();return;}
  if(next==='results'){void run(()=>onRecord({...defaults,...notes}));return;}
  if(next==='consultation'&&approvals.consultation){void run(()=>press({kind:'consultation-decision',context:approvals.consultation!.context,decision:decision as 'required'|'not-required',note:reason}));return;}
  if(next==='regimen'){setApprovedHash(card!.review.draft!.approvalHash);return;}
  if(next==='publish'&&card)void run(()=>press({kind:'regimen',context:card.context,requestId:card.requestId,regimenHash:card.review.draft!.approvalHash,approved:true,changeSummary:summary}));
 }
 type Row={key:string;title:string;status:'green'|'amber'|'red';detail:string;action?:string};
 const fieldStates=Object.entries(editor?.fields??{}).map(([key,state])=>state==='rejected'&&!editor?.excludedFields?.includes(key as DraftField)?'not-decided':state);
 const edited=fieldStates.filter(state=>state==='edited').length,rejected=fieldStates.filter(state=>state==='rejected').length,undecided=fieldStates.filter(state=>state==='not-decided').length;
 const fieldDetail=[
  edited?t(`${edited} edited`,`${edited}-ը խմբագրված է`,`Изменено: ${edited}`):'',
  rejected?t(`${rejected} rejected (they will not be saved)`,`${rejected}-ը մերժված է (չեն պահպանվի)`,`Отклонено: ${rejected} (не будут сохранены)`):'',
  undecided?t(`${undecided} still to decide`,`${undecided}-ի վերաբերյալ դեռ պետք է որոշել`,`Ещё не решено: ${undecided}`):'',
 ].filter(Boolean).join('; ')||(fieldStates.length?t('All accepted','Բոլորն ընդունված են','Все приняты'):t('Prepared field decisions are not available.','Պատրաստված դաշտերի որոշումները հասանելի չեն։','Решения по подготовленным полям недоступны.'));
 const rows:Row[]=[
  {key:'values',title:t('Values used','Օգտագործված արժեքներ','Использованные значения'),status:labsUnknown||sourceReason?'red':labCount?'amber':'green',detail:sourceReason||(labsUnknown?t('Lab evidence could not be read.','Լաբորատոր տվյալները չհաջողվեց կարդալ։','Не удалось прочитать лабораторные данные.'):labCount?t(`${labCount} need review`,`${labCount}-ը վերանայման կարիք ունի`,`Нужно проверить: ${labCount}`):t('Reviewed or confirmed by the rules','Վերանայված է կամ հաստատված կանոններով','Проверено или подтверждено правилами')),action:labCount||sourceReason?labelForLabs():undefined},
  {key:'fields',title:t('Prepared fields','Պատրաստված դաշտեր','Подготовленные поля'),status:fieldStates.length&&!rejected&&!undecided?'green':'amber',detail:fieldDetail,action:!saved?acceptLabel:undefined},
  {key:'draft',title:t('Draft saved','Սևագիրը պահպանված է','Черновик сохранён'),status:routineBlock||evidenceReason?'red':savedCurrent?'green':'amber',detail:routineBlock||evidenceReason||(savedCurrent?t('Saved after review','Պահպանված է վերանայումից հետո','Сохранён после проверки'):t('Save after reviewing the current evidence.','Պահպանեք ընթացիկ տվյալները վերանայելուց հետո։','Сохраните после проверки текущих данных.')),action:saved&&!savedCurrent?saveLabel:undefined},
  ...(hasMedicines?[{key:'regimen',title:t('Regimen approved','Դեղերի ցանկը հաստատված է','Схема лечения утверждена'),status:regimenApproved?'green' as const:'amber' as const,detail:t('Review every medicine and dose in the details below.','Ստորև վերանայեք յուրաքանչյուր դեղն ու դեղաչափը։','Проверьте каждое лекарство и дозу ниже.'),action:!regimenApproved?t('Approve regimen','Հաստատել դեղերի ցանկը','Утвердить схему лечения'):undefined}]:[]),
  {key:'results',title:t('Required results','Պահանջվող արդյունքներ','Обязательные результаты'),status:!ready?.sourcesAvailable?'red':!missing.length?'green':missing.some(test=>!test.source)?'red':'amber',detail:!ready?.sourcesAvailable?t('Clinic lab results could not be read. Reload the page.','Կլինիկայի լաբորատոր արդյունքները չհաջողվեց կարդալ։ Թարմացրեք էջը։','Не удалось прочитать лабораторные результаты клиники. Обновите страницу.'):t(`${results.length-missing.length} of ${results.length} recorded`,`${results.length}-ից ${results.length-missing.length}-ը գրանցված է`,`Записано ${results.length-missing.length} из ${results.length}`),action:sources.length?t('Record all matched results','Գրանցել բոլոր համապատասխան արդյունքները','Записать все совпавшие результаты'):undefined},
  {key:'consultation',title:t('Consultation decision','Խորհրդատվության որոշում','Решение о консультации'),status:completionReason?'red':consultationNeeded?'amber':'green',detail:completionReason||(consultationNeeded?t('Needed','Անհրաժեշտ է','Нужно'):t('Made','Կայացված է','Принято')),action:consultationNeeded&&approvals.consultation&&decision&&reason.trim()?consultLabel:undefined},
  {key:'urgent',title:t('No open urgent alert','Բաց շտապ ահազանգ չկա','Нет открытого срочного оповещения'),status:urgent?'red':'green',detail:urgent?urgentReason:t('No open urgent alert','Բաց շտապ ահազանգ չկա','Нет открытого срочного оповещения')},
 ];
 function handleRow(key:string){
  if(pending||hardBlock||failed||editor?.pending||editor?.blocked)return;
  if(key==='values')onReviewLabs?.();
  if(key==='fields'||key==='draft')save();
  if(key==='regimen')setApprovedHash(card!.review.draft!.approvalHash);
  if(key==='results')void run(()=>onRecord({...defaults,...notes}));
  if(key==='consultation'&&approvals.consultation)void run(()=>press({kind:'consultation-decision',context:approvals.consultation!.context,decision:decision as 'required'|'not-required',note:reason}));
 }
 function labelForLabs(){return t('Review these values','Վերանայել այս արժեքները','Проверить эти значения');}
 return <Card className="dcv2-plan-ready" aria-busy={pending} data-plan-ready="true"><CardHeader><CardTitle><h3>{t('Plan ready for your review','Պլանը պատրաստ է ձեր վերանայմանը','План готов к вашей проверке')}</h3></CardTitle>{fileLinks(unreviewedFiles)}</CardHeader><CardContent className="space-y-4">
  <ul className="divide-y">{rows.map(row=><li key={row.key} data-check={row.key} data-state={row.status} className="flex flex-wrap items-start justify-between gap-2 py-3"><div className="min-w-0 flex-1"><p className="font-medium">{row.title}</p><p className="break-words text-body2">{row.detail}</p>{row.key==='values'&&fileLinks(sourceReason?labFiles:unreviewedFiles)}{row.key==='results'&&missing.some(test=>test.method==='lab')&&fileLinks(labFiles)}</div><Badge variant={row.status==='green'?'success':row.status==='amber'?'warning':'danger'}>{row.status==='green'?t('Ready','Պատրաստ է','Готово'):row.status==='amber'&&row.key==='fields'&&rejected&&!undecided?t('Decided','Որոշված է','Решено'):row.status==='amber'?t('Your action','Ձեր գործողությունը','Нужно действие'):t('Blocked','Արգելափակված է','Недоступно')}</Badge>{row.action&&<Button type="button" variant="outline" className="min-h-12 max-w-full whitespace-normal" disabled={pending||!!hardBlock||failed||editor?.pending||editor?.blocked} onClick={()=>handleRow(row.key)}>{row.action}</Button>}</li>)}</ul>
  {!!missing.length&&<ul>{missing.map(test=><li key={test.id}>{planDisplayText(test.title,locale)}: {test.source?t(`Matched in ${test.source.fileName}`,`${test.source.fileName} ֆայլում կա`,`Найдено в ${test.source.fileName}`):matchReason(test)}</li>)}</ul>}
  {results.some(test=>test.recorded)&&<p role="status">{t('Recorded','Գրանցված է','Записано')}: {results.filter(test=>test.recorded).map(test=>planDisplayText(test.title,locale)).join(', ')}</p>}
  {consultationNeeded&&<fieldset disabled={pending||!!hardBlock} className="space-y-3"><legend>{proposed?t("Zoe's proposal",'Զոյայի առաջարկը','Предложение Зои'):t('Consultation decision','Խորհրդատվության որոշում','Решение о консультации')}</legend>{proposed&&proposal&&<p>{proposal.note}</p>}{proposalLanguageLabel&&<p className="text-caption text-muted-foreground">{proposalLanguageLabel}</p>}{!proposal&&<p>{t('The draft has no consultation reason. Enter your clinical reason for this decision.','Սևագրում խորհրդատվության պատճառ նշված չէ։ Մուտքագրեք այս որոշման կլինիկական պատճառը։','В черновике нет причины консультации. Укажите клиническую причину этого решения.')}</p>}<label className="block">{t('Decision','Որոշում','Решение')}<select className="mt-1 min-h-12 w-full rounded-md border bg-background p-3" value={decision} onChange={e=>changeDecision(e.target.value)}><option value="">{t('Choose a decision','Ընտրեք որոշումը','Выберите решение')}</option><option value="required">{t('Required','Պահանջվում է','Нужна')}</option><option value="not-required">{t('Not required','Չի պահանջվում','Не нужна')}</option></select></label><label className="block">{t('Private clinical reason','Գաղտնի կլինիկական պատճառ','Внутренняя клиническая причина')}<textarea className="mt-1 w-full rounded-md border p-3" maxLength={2000} value={reason} onChange={e=>changeReason(e.target.value)}/></label></fieldset>}
  {sources.length>0&&<p>{t('Recording confirms that you checked these values against the clinic document.','Գրանցումը հաստատում է, որ այս արժեքները համեմատել եք կլինիկայի փաստաթղթի հետ։','Запись подтверждает, что вы сверили значения с документом клиники.')}</p>}
  {sources.map(source=><div key={source.attachmentId} className="space-y-3"><details><summary className="min-h-12 cursor-pointer">{source.fileName}</summary><ul>{source.values.map(value=><li key={value.id}>{value.name}: {value.valueText} {value.unit} · {value.collectedOn}</li>)}</ul></details><label className="block">{t('Result note, editable','Արդյունքի նշում՝ խմբագրելի','Комментарий к результату, можно изменить')}<textarea className="mt-1 w-full rounded-md border p-3" maxLength={2000} disabled={pending} value={notes[source.attachmentId]??defaults[source.attachmentId]} onChange={e=>setNotes({...notes,[source.attachmentId]:e.target.value})}/></label></div>)}
  {!!card?.review.versions.length&&<label className="block">{t('What changed (shown to the member)','Ինչ է փոխվել (ցուցադրվում է անդամին)','Что изменилось (показывается участнику)')}<textarea className="mt-1 w-full rounded-md border p-3" maxLength={1000} value={summary} onChange={e=>setSummary(e.target.value)}/></label>}
  {(next==='save'||next==='regimen')&&hasMedicines&&<p>{t('Your press confirms that you reviewed every medicine and dose in the saved plan below.','Ձեր սեղմումը հաստատում է, որ ստորև պահպանված պլանում վերանայել եք յուրաքանչյուր դեղն ու դեղաչափը։','Нажатие подтверждает, что вы проверили каждое лекарство и дозу в сохранённом плане ниже.')}</p>}
  {next==='publish'&&!urgent&&<p>{t('Your press approves this saved plan, every medicine and dose, and publishes it.','Ձեր սեղմումը հաստատում է այս պահպանված պլանը, յուրաքանչյուր դեղն ու դեղաչափը և հրապարակում այն։','Нажатие утверждает сохранённый план, каждое лекарство и дозу, и публикует его.')}</p>}
  {gateReason&&<p role="status">{gateReason}</p>}{feedback&&<p role="alert">{feedback}</p>}{(hardBlock||blocked)&&<p role="alert">{hardBlock||blocked}</p>}
  <Button type="button" className="min-h-12 w-full whitespace-normal" disabled={pending||!!blocked} onClick={act}>{pending?t('Saving…','Պահպանվում է…','Сохраняется…'):label}</Button>
  <div className="flex flex-wrap gap-3"><Button type="button" variant="link" className="min-h-12 max-w-full whitespace-normal" onClick={onDetails}>{t('Open plan details','Բացել պլանի մանրամասները','Открыть подробности плана')}</Button>{missing.length>0&&<Button variant="link" className="min-h-12 max-w-full whitespace-normal" nativeButton={false} render={<a href={`/staff/real/members/${draft.snapshot.id}#uploaded-reports`}/>}>{t('Open required results','Բացել պահանջվող արդյունքները','Открыть обязательные результаты')}</Button>}{failed&&<Button type="button" variant="outline" disabled={pending} onClick={()=>void run(async()=>{await onRefresh();setFailed(false);})}>{t('Refresh evidence','Թարմացնել տվյալները','Обновить данные')}</Button>}</div>
 </CardContent></Card>;
}
