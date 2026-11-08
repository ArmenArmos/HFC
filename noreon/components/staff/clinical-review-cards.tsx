'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {readCareTeamWorklist} from '@/lib/worklist/actions';
import type {WorklistItem,WorklistRead} from '@/lib/worklist/schema';
import {riskReasonLabel,taskKindLabel,tierLabel,WORKLIST_COPY as W} from '@/lib/worklist/copy';
import type {RiskTier} from '@/lib/clinical/rules/risk-tier';
import {readTargetsCard,setBpTargetFromCard,type TargetsCardRead} from '@/lib/bp-target/actions';
import {BP_TARGET_BOUNDS,BP_TARGET_COMMAND_VERSION,BP_TARGET_FIELDS,bpTargetCommandSchema,proposedTarget,type BpTargetStatus} from '@/lib/bp-target/schema';
import type {PersonalBpTarget} from '@/lib/clinical/rules/personal-bp';
import {LdlGoalPanel} from '@/components/staff/ldl-goal-panel';
import {addLdlEvent,addLdlTherapy,endLdlTherapy,removeLdlEvent,setLdlGoal} from '@/lib/ldl/actions';
import {cancelLdlRetest} from '@/lib/ldl/response-actions';

/**
 * WP T staff chat cards: the prioritised worklist, the physician's targets card and the tier badge for member headers.
 * Words and chips only open these cards; the targets card writes only on an explicit confirm and press. No component
 * here compares a clinical number: the database and lib/clinical/rules decide, these name the outcome.
 */
type Variant='doctor'|'nurse';
const choice=(v:Variant)=>v==='doctor'?'dcv2-choice':'ncv2-choice';
const TIER_CLASS:Record<RiskTier,string>={
 very_high:'border-destructive text-destructive',
 high:'border-brand-gold-deep text-brand-gold-deep bg-surface-subtle-gold',
 moderate:'border-brand-teal text-brand-teal bg-surface-subtle-teal',
 low:'border-border text-muted-foreground',
};
/** Always the words, never a colour alone. */
export function TierBadge({tier,locale}:{tier:RiskTier|null;locale:StaffLocale}){
 return <span data-risk-tier={tier??'none'} className={`inline-flex min-h-7 items-center rounded-md border px-2 text-caption font-medium ${tier?TIER_CLASS[tier]:'border-border text-muted-foreground'}`}>{tierLabel(tier,locale)}</span>;
}

/** The member header: tier, BP target and LDL goal, as the server read them. */
export function MemberTierTargets({tier,bpTarget,ldlGoalMmol,locale:l}:{tier:{tier:RiskTier;reasons:string[]}|null;bpTarget:{systolic:number;diastolic:number}|null;ldlGoalMmol:number|null;locale:StaffLocale}){
 const reasons=tier?.reasons.slice(0,3).map(r=>riskReasonLabel(r,l)).join(', ');
 return <div className="flex flex-wrap items-center gap-2 text-caption" data-member-tier-targets>
  {tier&&<TierBadge tier={tier.tier} locale={l}/>}
  {reasons&&<span className="text-muted-foreground">{reasons}</span>}
  <span data-bp-target>{bpTarget?st(l,`BP target below ${bpTarget.systolic}/${bpTarget.diastolic}`,`Ճնշման թիրախ՝ ${bpTarget.systolic}/${bpTarget.diastolic}-ից ցածր`,`Цель АД ниже ${bpTarget.systolic}/${bpTarget.diastolic}`)
   :st(l,'No personal BP target set','Անձնական ճնշման թիրախ սահմանված չէ','Личная цель АД не задана')}</span>
  {ldlGoalMmol!==null&&<span data-ldl-goal>{st(l,`LDL goal below ${ldlGoalMmol} mmol/L`,`LDL նպատակ՝ ${ldlGoalMmol} մմոլ/լ-ից ցածր`,`Цель ЛПНП ниже ${ldlGoalMmol} ммоль/л`)}</span>}
 </div>;
}

function itemFacts(item:WorklistItem,l:StaffLocale){
 const out:string[]=[];
 if('urgent' in item){
  if(item.urgent>0)out.push(W.urgent(item.urgent,l));
  if(item.overdue>0)out.push(W.overdue(item.overdue,l));
  if(item.aboveTargetStreak>0)out.push(W.streak(item.aboveTargetStreak,l));
  out.push(W.contact(item.daysSinceContact,l));
 }
 return out;
}

/** The worklist, read when the card opens. The database scopes it to the caller and audits each listed member. */
export function WorklistCard({locale:l,variant,disabled=false,onOpen}:{locale:StaffLocale;variant:Variant;disabled?:boolean;onOpen:(memberId:string,name:string|null)=>void}){
 const [read,setRead]=useState<WorklistRead|null>(null);
 const mounted=useRef(true),heading=useId();
 const fetchList=useCallback(()=>readCareTeamWorklist().then(r=>{if(mounted.current)setRead(r);},()=>{if(mounted.current)setRead({kind:'unavailable'});}),[]);
 const load=()=>{setRead(null);void fetchList();};
 useEffect(()=>{mounted.current=true;void fetchList();return()=>{mounted.current=false;};},[fetchList]);
 return <section aria-labelledby={heading} className="space-y-3" data-worklist-card>
  <h3 id={heading} className="text-body1 font-medium">{W.title(l)}</h3>
  {read===null&&<p role="status">{st(l,'Loading your worklist…','Աշխատանքային ցուցակը բեռնվում է…','Загрузка рабочего списка…')}</p>}
  {read?.kind==='off'&&<p role="status">{W.off(l)}</p>}
  {(read?.kind==='unavailable'||read?.kind==='access')&&<div role="alert"><p>{W.unavailable(l)}</p><button type="button" className={choice(variant)} onClick={load}>{W.tryAgain(l)}</button></div>}
  {read?.kind==='ready'&&(read.list.items.length===0?<p role="status">{W.empty(l)}</p>:<ol className="space-y-3">
   {read.list.items.map(item=><li key={item.memberId} className="space-y-1 rounded-md border border-border p-3" data-worklist-member={item.memberId} data-rank={item.rank}>
    <p className="flex flex-wrap items-center gap-2"><strong className="text-body1">{item.name??W.unnamed(l)}</strong><TierBadge tier={item.tier} locale={l}/></p>
    {item.reasons.length>0&&<p className="text-body2">{item.reasons.slice(0,3).map(r=>riskReasonLabel(r,l)).join(', ')}</p>}
    {itemFacts(item,l).length>0&&<p className="text-caption text-muted-foreground">{itemFacts(item,l).join(' · ')}</p>}
    {item.taskKinds.length>0&&<p className="text-caption">{item.taskKinds.slice(0,3).map(k=>taskKindLabel(k,l)).join(', ')}</p>}
    <button type="button" className={`${choice(variant)} min-h-11`} disabled={disabled} onClick={()=>onOpen(item.memberId,item.name)}>{W.open(l)}<span className="sr-only">: {item.name??W.unnamed(l)}</span></button>
   </li>)}
  </ol>)}
 </section>;
}

const FIELD_LABEL:Record<keyof PersonalBpTarget,[string,string,string]>={
 homeSystolicTarget:['Home target, upper number (below)','Տնային թիրախ, վերին թիվ (ցածր)','Домашняя цель, верхнее число (ниже)'],
 homeDiastolicTarget:['Home target, lower number (below)','Տնային թիրախ, ստորին թիվ (ցածր)','Домашняя цель, нижнее число (ниже)'],
 alertHighSystolic:['Same-day nurse task at upper number of','Նույն օրվա բուժքույրի առաջադրանք վերին թվի դեպքում','Задача медсестре в тот же день при верхнем числе'],
 alertHighDiastolic:['Same-day nurse task at lower number of','Նույն օրվա բուժքույրի առաջադրանք ստորին թվի դեպքում','Задача медсестре в тот же день при нижнем числе'],
 alertHighConsecutive:['Readings in a row before the task','Անընդմեջ չափումներ մինչև առաջադրանքը','Измерений подряд до задачи'],
 alertLowSystolic:['Low upper number with symptoms, at or below','Ցածր վերին թիվ ախտանիշներով, հավասար կամ ցածր','Низкое верхнее число с симптомами, не выше'],
 alertLowPulse:['Low pulse with symptoms, at or below','Ցածր զարկերակ ախտանիշներով, հավասար կամ ցածր','Низкий пульс с симптомами, не выше'],
};
const STATUS_TEXT:Record<BpTargetStatus,[string,string,string]>={
 saved:['Saved. The member’s readings are now compared with these targets.','Պահպանված է։ Անդամի չափումներն այժմ համեմատվում են այս թիրախների հետ։','Сохранено. Измерения участника теперь сравниваются с этими целями.'],
 replayed:['Already saved.','Արդեն պահպանված է։','Уже сохранено.'],
 stale:['Someone changed the targets in the meantime. Reload and check again.','Միջանկյալ ընթացքում թիրախները փոխվել են։ Վերաբեռնեք և կրկին ստուգեք։','Цели изменились за это время. Обновите и проверьте снова.'],
 invalid:['Check the numbers: each must be in range, the alert above the target, the low alert below it. A change needs a reason.','Ստուգեք թվերը․ յուրաքանչյուրը պետք է լինի թույլատրելի սահմաններում, ահազանգը՝ թիրախից բարձր, ցածր ահազանգը՝ թիրախից ցածր։ Փոփոխության համար պետք է պատճառ։','Проверьте числа: каждое в допустимых пределах, оповещение выше цели, нижнее оповещение ниже неё. Для изменения нужна причина.'],
 unavailable:['The case is busy. Try again in a moment.','Գործը զբաղված է։ Մի պահից կրկին փորձեք։','Карта занята. Попробуйте через минуту.'],
 access:['Only the member’s assigned family physician or cardiologist can set targets.','Թիրախները կարող է սահմանել միայն անդամի նշանակված ընտանեկան բժիշկը կամ սրտաբանը։','Цели может задать только назначенный семейный врач или кардиолог участника.'],
 'outcome-unknown':['We could not confirm the save. Press save again: it will not be saved twice.','Չհաջողվեց հաստատել պահպանումը։ Կրկին սեղմեք․ այն երկու անգամ չի պահպանվի։','Не удалось подтвердить сохранение. Нажмите ещё раз: повторно не сохранится.'],
};

/** Targets in the member conversation: view for the care team, set for the assigned family physician or cardiologist. */
export function TargetsCard({memberId,locale:l,onSaved}:{memberId:string;locale:StaffLocale;onSaved?:(text:string)=>void}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const [read,setRead]=useState<TargetsCardRead|null>(null);
 const [form,setForm]=useState<Record<keyof PersonalBpTarget,string>|null>(null);
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState<BpTargetStatus|null>(null);
 const submission=useRef<string|null>(null),mounted=useRef(true),heading=useId();
 const fetchTargets=useCallback(()=>readTargetsCard(memberId).then(r=>{
  if(!mounted.current)return;
  setRead(r);
  if(r.kind==='ready'){const p=proposedTarget(r.bp.current);setForm(Object.fromEntries(BP_TARGET_FIELDS.map(k=>[k,String(p[k])])) as Record<keyof PersonalBpTarget,string>);setReason('');}
 },()=>{if(mounted.current)setRead({kind:'unavailable'});}),[memberId]);
 const load=async()=>{setRead(null);setStatus(null);setConfirmed(false);submission.current=null;await fetchTargets();};
 useEffect(()=>{mounted.current=true;void fetchTargets();return()=>{mounted.current=false;};},[fetchTargets]);
 async function save(){
  if(read?.kind!=='ready'||!form||!confirmed||busy)return;
  const p=proposedTarget(read.bp.current);
  const command={version:BP_TARGET_COMMAND_VERSION,memberId,submissionId:submission.current??=crypto.randomUUID(),expectedVersion:read.bp.current?.version??0,
   ...Object.fromEntries(BP_TARGET_FIELDS.map(k=>[k,Number(form[k])])),reason:reason.trim()||null,defaultsVersion:p.defaultsVersion};
  if(!bpTargetCommandSchema.safeParse(command).success){setStatus('invalid');return;}
  setBusy(true);
  try{
   const r=await setBpTargetFromCard(command);
   if(!mounted.current)return;
   setStatus(r.status);
   if(r.status==='saved'||r.status==='replayed'){onSaved?.(st(l,...STATUS_TEXT.saved));await load();setStatus(r.status);}
   else if(r.status!=='outcome-unknown'&&r.status!=='unavailable')submission.current=null;
  }catch{if(mounted.current)setStatus('outcome-unknown');}
  finally{if(mounted.current)setBusy(false);}
 }
 const current=read?.kind==='ready'?read.bp.current:null;
 const ldl=read?.kind==='ready'&&read.ldl?.enabled?read.ldl:null;
 return <section aria-labelledby={heading} className="space-y-3" data-targets-card={memberId}>
  <h3 id={heading} className="text-body1 font-medium">{t('Targets and alert levels','Թիրախներ և ահազանգի մակարդակներ','Цели и уровни оповещения')}</h3>
  {read===null&&<p role="status">{t('Loading targets…','Թիրախները բեռնվում են…','Загрузка целей…')}</p>}
  {read?.kind==='off'&&<p role="status">{t('Personal targets are not switched on yet.','Անձնական թիրախները դեռ միացված չեն։','Личные цели ещё не включены.')}</p>}
  {(read?.kind==='unavailable'||read?.kind==='access')&&<div role="alert"><p>{t('Targets could not be read. Try again.','Չհաջողվեց կարդալ թիրախները։ Փորձեք կրկին։','Не удалось загрузить цели. Попробуйте ещё раз.')}</p><button type="button" className="dcv2-choice" onClick={()=>void load()}>{t('Try again','Փորձել կրկին','Попробовать ещё раз')}</button></div>}
  {read?.kind==='ready'&&<>
   <p data-bp-target-current>{current
    ?t(`Version ${current.version}: home target below ${current.homeSystolicTarget}/${current.homeDiastolicTarget}, same-day task at ${current.alertHighSystolic}/${current.alertHighDiastolic} on ${current.alertHighConsecutive} readings in a row, low alert at ${current.alertLowSystolic} or pulse ${current.alertLowPulse} with symptoms. Set by ${current.physicianName??'a physician'}.`,
     `Տարբերակ ${current.version}․ տնային թիրախ՝ ${current.homeSystolicTarget}/${current.homeDiastolicTarget}-ից ցածր, նույն օրվա առաջադրանք՝ ${current.alertHighSystolic}/${current.alertHighDiastolic} անընդմեջ ${current.alertHighConsecutive} չափման դեպքում, ցածր ահազանգ՝ ${current.alertLowSystolic} կամ զարկերակ ${current.alertLowPulse} ախտանիշներով։ Սահմանել է՝ ${current.physicianName??'բժիշկը'}։`,
     `Версия ${current.version}: домашняя цель ниже ${current.homeSystolicTarget}/${current.homeDiastolicTarget}, задача в тот же день при ${current.alertHighSystolic}/${current.alertHighDiastolic} в ${current.alertHighConsecutive} измерениях подряд, нижнее оповещение при ${current.alertLowSystolic} или пульсе ${current.alertLowPulse} с симптомами. Задал: ${current.physicianName??'врач'}.`)
    :t('No personal target is set. Readings are compared with the usual home defaults until a physician confirms one.','Անձնական թիրախ սահմանված չէ։ Չափումները համեմատվում են սովորական տնային լռելյայն արժեքների հետ, մինչև բժիշկը հաստատի թիրախ։','Личная цель не задана. Пока врач её не подтвердит, измерения сравниваются с обычными домашними значениями по умолчанию.')}</p>
   {read.bp.canSet&&form?<form className="space-y-3" onSubmit={event=>{event.preventDefault();void save();}}>
    <p className="text-caption text-muted-foreground">{current?t('Change any number, give a reason, then confirm.','Փոխեք ցանկացած թիվ, նշեք պատճառը, ապա հաստատեք։','Измените нужные числа, укажите причину и подтвердите.'):t('The form shows the usual home defaults. Confirm or change them.','Ձևը ցույց է տալիս սևագիր լռելյայն արժեքները, որոնք սպասում են կլինիկական հաստատման։ Հաստատեք կամ փոխեք դրանք։','В форме черновые значения по умолчанию, ожидающие клинического утверждения. Подтвердите или измените их.')}</p>
    <div className="grid gap-3 sm:grid-cols-2">{BP_TARGET_FIELDS.map(k=><label key={k} className="grid gap-1 text-body2">{st(l,...FIELD_LABEL[k])}
     <input type="number" inputMode="numeric" className="min-h-11 rounded-md border border-input bg-background px-3" min={BP_TARGET_BOUNDS[k][0]} max={BP_TARGET_BOUNDS[k][1]} step={1} required value={form[k]} disabled={busy}
      onChange={event=>{setForm({...form,[k]:event.target.value});setConfirmed(false);submission.current=null;}}/></label>)}</div>
    <label className="grid gap-1 text-body2">{t('Reason (needed for any change)','Պատճառ (անհրաժեշտ է ցանկացած փոփոխության համար)','Причина (нужна для любого изменения)')}
     <textarea className="min-h-20 rounded-md border border-input bg-background px-3 py-2" maxLength={500} value={reason} disabled={busy} onChange={event=>{setReason(event.target.value);setConfirmed(false);submission.current=null;}}/></label>
    <label className="flex min-h-11 items-center gap-2 text-body2"><input type="checkbox" className="size-5" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>{t('I confirm these targets and alert levels for this member','Հաստատում եմ այս թիրախներն ու ահազանգի մակարդակները այս անդամի համար','Подтверждаю эти цели и уровни оповещения для участника')}</label>
    <button type="submit" className="dcv2-choice min-h-11" disabled={!confirmed||busy}>{busy?t('Saving…','Պահպանվում է…','Сохранение…'):t('Save targets','Պահպանել թիրախները','Сохранить цели')}</button>
   </form>:<p className="text-caption text-muted-foreground">{t('Only the assigned family physician or cardiologist can change targets.','Թիրախները կարող է փոխել միայն նշանակված ընտանեկան բժիշկը կամ սրտաբանը։','Цели может изменить только назначенный семейный врач или кардиолог.')}</p>}
   {status&&<p role={status==='saved'||status==='replayed'?'status':'alert'} aria-live="polite">{st(l,...STATUS_TEXT[status])}</p>}
   {ldl&&<details className="rounded-md border border-border p-3"><summary className="min-h-11 cursor-pointer text-body2">{ldl.goals.length?t(`LDL goal: below ${ldl.goals[0].thresholdMmol} mmol/L. Review`,`LDL նպատակ՝ ${ldl.goals[0].thresholdMmol} մմոլ/լ-ից ցածր։ Վերանայել`,`Цель ЛПНП: ниже ${ldl.goals[0].thresholdMmol} ммоль/л. Проверить`):t('No LDL goal recorded. Set a goal','LDL նպատակ գրանցված չէ։ Սահմանել նպատակ','Цель ЛПНП не записана. Задать цель')}</summary>
    <LdlGoalPanel data={ldl} memberId={memberId} locale={l} actions={{addEvent:addLdlEvent,removeEvent:removeLdlEvent,addTherapy:addLdlTherapy,endTherapy:endLdlTherapy,setGoal:setLdlGoal,cancelRetest:cancelLdlRetest}}/></details>}
  </>}
 </section>;
}
