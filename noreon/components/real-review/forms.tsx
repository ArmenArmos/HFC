'use client';
import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import {useActionState,useEffect,useMemo,useRef,useState,startTransition,type ReactNode} from 'react';
import {useRouter,unstable_rethrow} from 'next/navigation';
import {enrollRealMember,saveRealDraft,type ClinicalFormState} from '@/lib/patient-care/clinical-actions';
import {checkRealClinicalCaseAvailability} from '@/lib/patient-care/clinical-review-actions';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import {recordAiPlanAdoption} from '@/lib/ai-plan/actions';
import {AI_PLAN_LABEL,DRAFT_FIELDS,type DraftField} from '@/lib/ai-plan/contracts';
import {deriveDraftFields,type DraftFieldDecisions,type DraftFieldDisposition} from '@/lib/ai-plan/draft-fields';
export type {DraftFieldDisposition} from '@/lib/ai-plan/draft-fields';
import {pick} from '@/lib/locale';
import {staffServerText} from '@/lib/staff/staff-server-copy';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {regimenRows} from '@/lib/patient-care/regimen';
import {RegimenEditor} from './regimen';
import {MedicineChecks,type MedicineCheckContext} from './medicine-checks';
import {withClinicalTimeout,ClinicalActionTimeout} from '@/lib/patient-care/action-timeout';
const initial={ok:false,message:''};
// Live length against the draft limit (Gohar QA 161); the field's maxLength stops typing at the limit.
function Count({value,max}:{value:string;max:number}){return <p className="mt-1 text-right text-caption text-muted-foreground">{value.length}/{max}</p>;}
const inputClass='mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2';
const buttonClass='min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50';
function Feedback({message,ok,locale='en',chat=false}:{message:string;ok:boolean;locale?:StaffLocale;chat?:boolean}){return message?<p role={ok?'status':'alert'} className="whitespace-pre-line text-body2">{chat?(ok?done('draft',locale,staffServerText(locale,message)):notDone('action',locale,staffServerText(locale,message))):staffServerText(locale,message)}</p>:null;}
export function EnrollmentForm({locale}:{locale:StaffLocale}){
 const [state,action,pending]=useActionState(enrollRealMember,initial);
 return <form action={action} className="space-y-3"><button disabled={pending||state.ok} className={buttonClass}>{pending?st(locale,'Saving','Պահպանվում է','Сохраняется'):st(locale,'Request a review','Ուղարկել վերանայման հարցում','Запросить проверку')}</button><Feedback {...state} locale={locale}/></form>;
}
export type DraftSnapshot=Pick<ClinicalSnapshot,'id'|'revision'|'evidenceToken'|'draft'|'draftStale'>;
const parsedRows=(value:string)=>{try{return (JSON.parse(value) as {name:string}[]).map(r=>r.name);}catch{return [];}};
function draftValues(snapshot:DraftSnapshot) {
 return {explanation:snapshot.draft?.explanation??'',instructions:snapshot.draft?.instructions??'',followUp:snapshot.draft?.followUp??'',medicationName:snapshot.draft?.medicationName??'',medicationDose:snapshot.draft?.medicationDose??'',medicationInstructions:snapshot.draft?.medicationInstructions??'',medicationTimes:snapshot.draft?.medicationTimes.join(', ')??'',medicines:JSON.stringify(regimenRows(snapshot.draft)),activityLimits:snapshot.draft?.activityLimits??''};
}
/**
 * An prepared draft on the current evidence and lab reviews (lib/ai-plan). It fills an empty, untouched
 * editor; it never replaces a saved draft or unsaved doctor text without the doctor choosing it. The editor
 * keeps its identity across new drafts (Codex #280 F3).
 */
export type AiDraft={generationId:string;values:Record<DraftField,string>};
const aiFields=(ai:AiDraft)=>DRAFT_FIELDS.filter(k=>ai.values[k].trim());
export type DraftEditorState={dirty:boolean;pending:boolean;blocked:boolean;fields?:Partial<Record<DraftField,DraftFieldDisposition>>;excludedFields?:DraftField[]};
type ChatDraft={onState?:(state:DraftEditorState)=>void;disabled:boolean;resave?:boolean;formId?:string;prefill?:boolean;preaccepted?:boolean;save:(previous:ClinicalFormState,form:FormData)=>Promise<ClinicalFormState>;adopt:(generation:string,fields:DraftField[])=>Promise<boolean>;refresh:()=>Promise<void>;onSaved:(result:ClinicalFormState)=>Promise<boolean>};
export function DraftForm({snapshot,ai=null,locale='en',regimen=false,chat,medicineChecks={others:[],egfr:null}}:{snapshot:DraftSnapshot;ai?:AiDraft|null;locale?:StaffLocale;regimen?:boolean;medicineChecks?:MedicineCheckContext;chat?:ChatDraft}) {
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const router=useRouter();
 const prefill=ai&&(!snapshot.draft||chat?.prefill);
 const [editor,setEditor]=useState(()=>({values:prefill?{...draftValues(snapshot),...ai.values}:draftValues(snapshot),proposed:prefill?ai.values:draftValues(snapshot),baseline:draftValues(snapshot),revision:snapshot.revision,token:snapshot.evidenceToken,saved:false}));
 // Fields still showing AI text the doctor has neither edited nor accepted; and those taken from the AI draft.
 const [marked,setMarked]=useState<DraftField[]>(()=>prefill?aiFields(ai):[]);
 // The draft the AI-marked text came from. A ref for adopted fields: the save action reads it after the await.
 const [applied,setApplied]=useState<AiDraft|null>(()=>prefill?ai:null);
 const [decisions,setDecisions]=useState<DraftFieldDecisions>(()=>prefill&&chat?.preaccepted?Object.fromEntries(aiFields(ai).map(key=>[key,{accepted:true}])):{});
 // Adopted fields: state for rendering, mirrored in a ref that the save action reads after its await.
 const adopted=useRef<DraftField[]>([]);
 const [adoptedNow,setAdoptedNow]=useState<DraftField[]>([]);
 useEffect(()=>{adopted.current=adoptedNow;},[adoptedNow]);
 const setAdopted=(next:DraftField[])=>{adopted.current=next;setAdoptedNow(next);};
 const adopt=(keys:DraftField[])=>setAdopted([...adopted.current,...keys.filter(k=>!adopted.current.includes(k))]);
 function resetSavedDraftDecisions(){
  setDecisions({});
  setMarked([]);setApplied(null);setAdoptedNow([]);
 }
 const [blockedContext,setBlockedContext]=useState<DraftSnapshot|null>(null);
 const [feedbackHidden,setFeedbackHidden]=useState(false);
 const [state,action,pending]=useActionState(async(previous:typeof initial,form:FormData)=>{
   setFeedbackHidden(false);
   try{
    const result=await withClinicalTimeout(()=>(chat?.save??saveRealDraft)(previous,form));
    if(result.ok){
     if(chat&&!await chat.onSaved(result)){setBlockedContext(snapshot);return {ok:false,message:'The draft save could not be confirmed. Refresh the current case before trying again.'};}
     setEditor(old=>({...old,baseline:old.values,revision:result.revision??old.revision,token:result.evidenceToken??old.token,saved:true}));setBlockedContext(null);
     const from=form.get('aiGeneration');
     if(typeof from==='string'&&from&&adopted.current.length){if(chat)void chat.adopt(from,adopted.current).catch(()=>false);else void recordAiPlanAdoption(from,adopted.current).catch(()=>false);}
     if(!chat)router.refresh();
    }
    else {setBlockedContext(result.uncertain?snapshot:null);if(chat)await chat.refresh();}
    return result;
   }catch(error){
    unstable_rethrow(error);
    setBlockedContext(snapshot);
    if(error instanceof ClinicalActionTimeout)return {ok:false,message:error.message};
    if(chat)await chat.refresh();
    return {ok:false,message:t('Draft save not confirmed. Your edits are retained. Refresh evidence and compare the current saved draft before saving again.','Սևագրի պահպանումը չի հաստատվել։ Ձեր փոփոխությունները պահված են։ Կրկին պահպանելուց առաջ թարմացրեք տվյալները և համեմատեք ընթացիկ պահպանված սևագրի հետ։','Сохранение черновика не подтверждено. Ваши изменения сохранены в форме. Обновите данные и сравните с текущим сохранённым черновиком перед повторным сохранением.')};
   }
 },initial);
 const [refreshing,setRefreshing]=useState(false);
 const [refreshFailure,setRefreshFailure]=useState('');
 async function refreshCase(){
  if(refreshing||pending)return;
  setRefreshing(true);
  try{if(chat){await withClinicalTimeout(chat.refresh);setBlockedContext(null);setFeedbackHidden(true);return;}const result=await withClinicalTimeout(()=>checkRealClinicalCaseAvailability(snapshot.id));if(result.ok){setRefreshFailure('');setBlockedContext(null);setFeedbackHidden(true);router.refresh();}else{setBlockedContext(snapshot);setRefreshFailure(staffServerText(locale,result.message));}}
  catch(error){unstable_rethrow(error);setBlockedContext(snapshot);setRefreshFailure(t('The current case is unavailable. Your entries are retained. Try refreshing again when access is restored.','Ընթացիկ դեպքն անհասանելի է։ Ձեր մուտքագրածը պահված է։ Փորձեք կրկին թարմացնել, երբ հասանելիությունը վերականգնվի։','Текущий случай недоступен. Введённые данные сохранены в форме. Попробуйте обновить снова, когда доступ восстановится.'));}
  finally{setRefreshing(false);}
 }
 const needsRefresh=!!blockedContext&&blockedContext.revision===snapshot.revision&&blockedContext.evidenceToken===snapshot.evidenceToken;
 const serverValues=draftValues(snapshot);
 const dirty=JSON.stringify(editor.values)!==JSON.stringify(editor.baseline);
 const newerContext=snapshot.revision>editor.revision||(snapshot.revision===editor.revision&&snapshot.evidenceToken!==editor.token);
 const serverChanged=JSON.stringify(serverValues)!==JSON.stringify(editor.baseline);
 const evidenceChanged=snapshot.evidenceToken!==editor.token;
 const conflict=newerContext&&dirty&&(serverChanged||evidenceChanged);
 // Clean forms follow server changes. Dirty forms can rebase over notes, but a
 // changed saved draft or source token must be acknowledged before advancing CAS.
 if(!pending&&newerContext&&!conflict){
   setEditor(old=>({...old,values:dirty?old.values:serverValues,baseline:serverValues,revision:snapshot.revision,token:snapshot.evidenceToken,saved:false}));
   if(!dirty)resetSavedDraftDecisions();
 }
 // The old form cannot hold a regimen, so it shows the medicines and does not save (Astra MM-4).
 const regimenLocked=!regimen&&!!snapshot.draft?.medicines;
 const fields=[['explanation',t('Review explanation','Վերանայման բացատրություն','Пояснение к проверке'),1500],['instructions',t('Care instructions','Խնամքի ցուցումներ','Рекомендации по уходу'),1500],['followUp',t('Follow-up','Հետագա հսկողություն','Дальнейшее наблюдение'),500],['medicationName',t('Medicine name','Դեղի անվանում','Название лекарства'),120],['medicationDose',t('Dose','Դեղաչափ','Доза'),120],['medicationInstructions',t('Medicine instructions','Դեղի ընդունման ցուցումներ','Указания по приёму лекарства'),500]] as const;
 function edit(key:keyof typeof editor.values,value:string){setEditor(old=>({...old,values:{...old.values,[key]:value}}));if(DRAFT_FIELDS.includes(key as DraftField))setDecisions(old=>({...old,[key]:{}}));if(marked.includes(key as DraftField)){setMarked(m=>m.filter(k=>k!==key));adopt([key as DraftField]);}}
 function acceptAi(key:DraftField){setDecisions(old=>({...old,[key]:{accepted:true}}));setMarked(m=>m.filter(k=>k!==key));adopt([key]);}
 function acceptAllAi(){setDecisions(old=>({...old,...Object.fromEntries(marked.map(key=>[key,{accepted:true}]))}));adopt(marked);setMarked([]);}
 // Reject puts back what the field held before the AI text (the saved draft, or empty).
 function rejectAi(key:DraftField){setDecisions(old=>({...old,[key]:{rejected:true}}));setEditor(old=>({...old,values:{...old.values,[key]:old.baseline[key]}}));setMarked(m=>m.filter(k=>k!==key));setAdopted(adopted.current.filter(k=>k!==key));}
 function applyDraft(next:AiDraft){setDecisions(chat?.preaccepted?Object.fromEntries(aiFields(next).map(key=>[key,{accepted:true}])):{});setEditor(old=>({...old,proposed:next.values,values:{...old.values,...next.values}}));setMarked(aiFields(next));setApplied(next);}
 function takeAiDraft(){
  if(!ai||(!chat&&!window.confirm(t('Put this prepared draft in the editor? It replaces the explanation, care instructions and follow-up text in the form. Medicine details and your saved draft are not changed.','Տեղադրե՞լ պատրաստված այս սևագիրը խմբագրիչում։ Այն կփոխարինի ձևի բացատրությունը, խնամքի ցուցումները և հետագա հսկողության տեքստը։ Դեղերի տվյալները և Ձեր պահպանված սևագիրը չեն փոխվի։','Поместить этот черновик, подготовленный, в редактор? Он заменит пояснение, рекомендации по уходу и текст дальнейшего наблюдения в форме. Данные о лекарствах и сохранённый черновик не изменятся.'))))return;
  applyDraft(ai);setAdopted([]);
 }
 // A newer draft (Regenerate, or another tab) fills the editor by itself only when nothing the doctor
 // typed, accepted or saved would be lost; otherwise it is offered beside the editor.
 const untouched=!snapshot.draft&&!adoptedNow.length&&!pending&&(Object.keys(editor.values) as (keyof typeof editor.values)[]).every(k=>
  editor.values[k]===(applied&&(DRAFT_FIELDS as readonly string[]).includes(k)?applied.values[k as DraftField]:editor.baseline[k]));
 const newer=!!ai&&ai.generationId!==applied?.generationId;
 if(newer&&untouched)applyDraft(ai!);
 function accept(keep:boolean){setEditor({...editor,values:keep?editor.values:serverValues,baseline:serverValues,revision:snapshot.revision,token:snapshot.evidenceToken,saved:false});if(!keep)resetSavedDraftDecisions();}
 const aiOpen=marked.length>0&&!chat?.preaccepted;
 const onState=chat?.onState,editorBlocked=needsRefresh||conflict||aiOpen||regimenLocked;
 // Every prepared field stays represented, including empty fields loaded from a saved draft.
 const reviewedFields=useMemo(()=>deriveDraftFields(editor.proposed,editor.values,decisions),[editor.proposed,editor.values,decisions]);
 const {fields:dispositions,excludedFields}=reviewedFields;
 useEffect(()=>{onState?.({dirty,pending:pending||refreshing,blocked:editorBlocked,fields:dispositions,excludedFields});},[onState,dirty,pending,refreshing,editorBlocked,dispositions,excludedFields]);
 useEffect(()=>()=>{onState?.({dirty:false,pending:false,blocked:false});},[onState]);
 return <form id={chat?.formId} action={action} onSubmit={event=>{event.preventDefault();if(chat?.disabled||pending||refreshing||needsRefresh||conflict||aiOpen||regimenLocked||(editor.saved&&!dirty&&!snapshot.draftStale&&!chat?.resave))return;if(chat?.preaccepted){adopt(marked);setMarked([]);}const data=new FormData(event.currentTarget);for(const key of DRAFT_FIELDS)data.set(key,reviewedFields.values[key]);if(applied&&(chat||adoptedNow.length))data.set('aiGeneration',applied.generationId);startTransition(()=>action(data));}} className={chat?"dcv2-draft":"space-y-4"}>
   <input type="hidden" name="id" value={snapshot.id}/><input type="hidden" name="revision" value={editor.revision}/><input type="hidden" name="token" value={editor.token}/>
   <input type="hidden" name="baselineDraft" value={JSON.stringify(snapshot.draft)}/>
   {conflict&&<section className="space-y-3 rounded-lg border p-4" aria-label={t('Draft conflict','Սևագրի հակասություն','Конфликт черновиков')}><p role="alert" className="text-body2">{serverChanged?t('Another draft was saved. Your edits are retained. Compare the current saved text before continuing.','Պահպանվել է մեկ այլ սևագիր։ Ձեր փոփոխությունները պահված են։ Շարունակելուց առաջ համեմատեք ընթացիկ պահպանված տեքստի հետ։','Сохранён другой черновик. Ваши изменения сохранены в форме. Сравните с текущим сохранённым текстом, прежде чем продолжить.'):t('Source evidence changed. Your edits are retained. Review current evidence before continuing.','Աղբյուրի տվյալները փոխվել են։ Ձեր փոփոխությունները պահված են։ Շարունակելուց առաջ վերանայեք ընթացիկ տվյալները։','Исходные данные изменились. Ваши изменения сохранены в форме. Проверьте текущие данные, прежде чем продолжить.')}</p><details><summary className="min-h-11 cursor-pointer text-body2">{t('Current saved draft','Ընթացիկ պահպանված սևագիր','Текущий сохранённый черновик')}</summary><dl className="space-y-3">{(regimen?fields.slice(0,3):fields).map(([key,label])=><div key={key}><dt className="text-caption text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap text-body2">{serverValues[key]||t('Not recorded','Գրանցված չէ','Не указано')}</dd></div>)}{regimen?<div><dt className="text-caption text-muted-foreground">{t('Medicines','Դեղեր','Лекарства')}</dt><dd className="whitespace-pre-wrap text-body2">{regimenRows(snapshot.draft).map(m=>[m.name,m.dose,m.times,m.instructions].filter(Boolean).join(' · ')).join('\n')||t('Not recorded','Գրանցված չէ','Не указано')}</dd></div>:<div><dt className="text-caption text-muted-foreground">{t('Medicine times','Դեղի ընդունման ժամերը','Время приёма лекарства')}</dt><dd className="text-body2">{serverValues.medicationTimes||t('Not recorded','Գրանցված չէ','Не указано')}</dd></div>}</dl></details><div className="flex flex-wrap gap-3"><button type="button" disabled={pending} className="min-h-11 rounded-md border px-4 text-body2" onClick={()=>accept(true)}>{t('I reviewed the changes, keep my edits','Վերանայել եմ փոփոխությունները, պահել իմ խմբագրումները','Изменения проверены, оставить мои правки')}</button><button type="button" disabled={pending} className="min-h-11 rounded-md border px-4 text-body2" onClick={()=>accept(false)}>{chat?t('Use the new text','Օգտագործել նոր տեքստը','Использовать новый текст'):t('Use the current saved draft','Օգտագործել ընթացիկ պահպանված սևագիրը','Использовать текущий сохранённый черновик')}</button></div></section>}
   {newer&&!untouched&&<div className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><p role="status" className="text-body2">{applied?t('A newer prepared draft is available. Your text in the editor is kept unless you choose it.','Հասանելի է պատրաստված ավելի նոր սևագիր։ Խմբագրիչում Ձեր տեքստը պահվում է, եթե չընտրեք այն։','Доступен более новый черновик, подготовленный. Ваш текст в редакторе сохранится, пока вы не выберете этот черновик.'):t('An prepared draft is available. It does not replace your text unless you choose it.','Հասանելի է պատրաստված սևագիր։ Այն չի փոխարինում Ձեր տեքստը, եթե չընտրեք այն։','Доступен черновик, подготовленный. Он заменит ваш текст только после вашего выбора.')}</p><button type="button" className="min-h-11 rounded-md border px-4 text-body2" disabled={pending} onClick={takeAiDraft}>{chat?t('Use the new text','Օգտագործել նոր տեքստը','Использовать новый текст'):t('Put the draft in the editor','Տեղադրել սևագիրը խմբագրիչում','Поместить черновик в редактор')}</button></div>}
   {!ai&&marked.length>0&&<p role="alert" className="text-body2">{t('The evidence or lab reviews changed after this draft was prepared. Reject the marked fields or prepare a new draft.','Այս սևագիրը պատրաստելուց հետո տվյալները կամ լաբորատոր վերանայումները փոխվել են։ Մերժեք նշված դաշտերը կամ պատրաստեք նոր սևագիր։','После подготовки этого черновика изменились данные или результаты проверки анализов. Отклоните отмеченные поля или подготовьте новый черновик.')}</p>}
   <fieldset disabled={pending||!!chat?.disabled} className="space-y-4">
     {fields.slice(0,3).map(([key,label,max])=>{const isAi=marked.includes(key as DraftField);return <div key={key} className={isAi?'space-y-2 rounded-lg border border-primary p-3':''}>
      <label className="block text-body2">{label}{isAi&&<span className="ml-2 rounded-sm bg-muted px-2 py-0.5 text-caption">{st(locale,AI_PLAN_LABEL.en,AI_PLAN_LABEL.hy,AI_PLAN_LABEL.ru)}</span>}<textarea ref={node=>{if(chat&&node){node.style.height='auto';node.style.height=`${node.scrollHeight+node.offsetHeight-node.clientHeight}px`;}}} name={key} maxLength={max} required={key==='explanation'||key==='instructions'} value={editor.values[key]} onChange={e=>edit(key,e.target.value)} className={inputClass} rows={key==='explanation'||key==='instructions'?(isAi?8:4):(isAi?4:2)}/></label><Count value={editor.values[key]} max={max}/>
      {isAi&&<div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded-md border px-4 text-body2" onClick={()=>acceptAi(key as DraftField)}>{chat?.preaccepted?t('Accepted, change below','Ընդունված է, փոխեք ստորև','Принято, можно изменить ниже'):t('Accept','Ընդունել','Принять')}</button><button type="button" className="min-h-11 rounded-md border px-4 text-body2" onClick={()=>rejectAi(key as DraftField)}>{t('Reject','Մերժել','Отклонить')}</button></div>}
     </div>;})}
     {chat?<input type="hidden" name="medicines" value={editor.values.medicines}/>:regimen?<section className="space-y-3"><h3 className="text-body2 font-medium">{t('Medicines','Դեղեր','Лекарства')}</h3><RegimenEditor value={editor.values.medicines} onChange={next=>edit('medicines',next)} locale={locale}/></section>:regimenLocked?<section className="space-y-2 rounded-lg border p-3"><h3 className="text-body2 font-medium">{t('Medicines','Դեղեր','Лекарства')}</h3><p role="status" className="text-body2">{t('This draft has several-medicine entries, and that feature is switched off. Contact the Noreon team before changing this plan.','Այս սևագիրը մի քանի դեղի գրառումներ ունի, և այդ գործառույթն անջատված է։ Այս պլանը փոխելուց առաջ կապվեք Noreon-ի թիմի հետ։','В этом черновике есть записи о нескольких лекарствах, а эта функция отключена. Прежде чем менять план, свяжитесь с командой Noreon.')}</p><p className="whitespace-pre-wrap text-body2">{regimenRows(snapshot.draft).map(m=>[m.name,m.dose,m.times,m.instructions].filter(Boolean).join(' · ')).join('\n')}</p></section>:<details open={!!snapshot.draft?.medicationName} className="space-y-3"><summary className="min-h-11 cursor-pointer text-body2 font-medium">{t('Medicine details','Դեղի տվյալներ','Данные о лекарстве')}</summary>
       {fields.slice(3).map(([key,label,max])=><div key={key}><label className="block text-body2">{label}<textarea name={key} maxLength={max} value={editor.values[key]} onChange={e=>edit(key,e.target.value)} className={inputClass} rows={2}/></label><Count value={editor.values[key]} max={max}/></div>)}
       <label className="block text-body2">{t('Medicine times, separated by commas','Դեղի ընդունման ժամերը՝ ստորակետերով բաժանված','Время приёма лекарства через запятую')}<input name="medicationTimes" className={inputClass} placeholder="09:00, 18:00" value={editor.values.medicationTimes} onChange={e=>edit('medicationTimes',e.target.value)}/></label>
     </details>}
    {!regimenLocked&&<MedicineChecks names={regimen?parsedRows(editor.values.medicines):[editor.values.medicationName]} context={medicineChecks} locale={locale}/>}
    <div><label className="block text-body2">{t('Activity permission and limits','Ֆիզիկական ակտիվության թույլտվություն և սահմանափակումներ','Разрешение на нагрузку и ограничения')}<textarea name="activityLimits" maxLength={500} value={editor.values.activityLimits} onChange={e=>edit('activityLimits',e.target.value)} className={inputClass} rows={2}/></label><Count value={editor.values.activityLimits} max={500}/><p className="text-caption text-muted-foreground">{t('After a heart attack, stent or stroke Zoe suggests no increase in exertion until this is recorded, whatever the time since the event. Consider cardiac rehabilitation.','Ինֆարկտից, ստենտից կամ ինսուլտից հետո Zoe-ն չի առաջարկում ծանրաբեռնվածության ավելացում, քանի դեռ սա գրանցված չէ, անկախ անցած ժամանակից։ Դիտարկեք սրտային վերականգնումը։','После инфаркта, стента или инсульта Zoe не предлагает увеличивать нагрузку, пока это не записано, сколько бы времени ни прошло. Рассмотрите кардиореабилитацию.')}</p></div>
   </fieldset>
   <p className="text-caption text-muted-foreground">{t('Save after reviewing the current evidence. Publication rechecks required results and the consultation decision.','Պահպանեք ընթացիկ տվյալները վերանայելուց հետո։ Հրապարակման ժամանակ պահանջվող արդյունքներն ու խորհրդատվության որոշումը կրկին ստուգվում են։','Сохраните после проверки текущих данных. При публикации повторно проверяются обязательные результаты и решение о консультации.')}</p>
   {aiOpen&&<div className="flex flex-wrap items-center gap-3"><p role="status" className="text-body2">{pick<ReactNode>(locale,{ru:`Перед сохранением примите, измените или отклоните каждое отмеченное поле (осталось: ${marked.length}).`,hy:`Պահպանելուց առաջ ընդունեք, խմբագրեք կամ մերժեք պատրաստված յուրաքանչյուր դաշտ (մնացել է ${marked.length})։`,en:<>Accept, edit or reject each prepared field before saving ({marked.length} left).</>})}</p><button type="button" className="min-h-11 rounded-md border border-primary px-4 text-body2" disabled={pending} onClick={acceptAllAi}>{t('I checked all, accept all','Ստուգել եմ բոլորը, ընդունել բոլորը','Всё проверено, принять всё')}</button></div>}
   <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={chat?.disabled||pending||refreshing||needsRefresh||conflict||aiOpen||regimenLocked||(editor.saved&&!dirty&&!snapshot.draftStale&&!chat?.resave)} aria-busy={pending}>{pending?t('Saving draft…','Սևագիրը պահպանվում է…','Сохраняется черновик…'):chat?t('Use this draft','Օգտագործել այս սևագիրը','Использовать этот черновик'):t('Save private draft','Պահպանել գաղտնի սևագիրը','Сохранить личный черновик')}</button><button type="button" className="min-h-11 rounded-md border px-4" disabled={pending||refreshing} onClick={refreshCase}>{refreshing?t('Checking availability…','Հասանելիությունը ստուգվում է…','Проверяем доступность…'):t('Refresh evidence','Թարմացնել տվյալները','Обновить данные')}</button></div>
   {!feedbackHidden&&(blockedContext===null||needsRefresh)&&<Feedback {...state} locale={locale} chat={!!chat}/>}{needsRefresh&&refreshFailure&&<p role="status" className="text-body2">{refreshFailure}</p>}
 </form>;
}
