import {memberInstruction} from '@/lib/text-language';
import {bpSavedLine} from '@/lib/clinical/rules/bp-words';
import type {BpStep} from '@/lib/clinical/rules/bp-check';
import {ASK_REASONS,MEDICINE_ASK_COPY,askWhen,type AskReason} from '@/lib/member-medicines/ask-copy';
import {assessLdl,formatMmol,formatPercent,ldlOnePartMet,ldlReductionShown} from '@/lib/ldl/status';
import {BP,CHIP,COMMON,DOSE,LDL,PLAN,RESULTS,SIDE,SIDE_EFFECT,SIDE_EFFECTS,TELEGRAM,TG_WRITE,TITLE,VISIT,bpText,say,type CardLocale,type SideEffect} from './copy';
import {TELEGRAM_CARD_KINDS,TELEGRAM_MENU_KINDS,doseItem,type CardButtonAction,type ValidCard,type ZoeCard} from './registry';
import {LIVING_VISIT} from './living-visit';
import {zoeSignature} from '@/lib/brand';

/**
 * A card as a Telegram message: plain text (never parse_mode) and buttons. The same immutable snapshot and recorded
 * outcome the app card draws, so the two channels cannot say different things about one card. Pure.
 */
export type CardButton={label:string;action:CardButtonAction;item:Record<string,unknown>};
export type TelegramCardView={text:string;rows:CardButton[][]};

/** Rows of buttons a card may show at once, so its text keeps the screen. Later doses appear as these are logged. */
const MAX_OPEN_DOSES=3;
const MAX_TEXT=4096;
const PREP_MAX=1500;
const fmt=(iso:string,o:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',...o}).format(new Date(iso));
const shownAt=(iso:string)=>`${fmt(iso,{day:'2-digit',month:'2-digit',year:'numeric'}).replaceAll('/','.')}, ${fmt(iso,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}`;
const head=(card:ZoeCard,l:CardLocale,title:string)=>`${zoeSignature(l)}${title}\n${say(l,COMMON.asShown(shownAt(card.at)))}`;

function doseView(card:Extract<ValidCard,{kind:'dose'}>,l:CardLocale):TelegramCardView{
 const top=head(card,l,say(l,TITLE.dose)),s=card.snapshot;
 if(!s.enabled)return {text:`${top}\n\n${say(l,DOSE.off)}`,rows:[]};
 if(!s.slots.length)return {text:`${top}\n\n${say(l,DOSE.empty)}`,rows:[]};
 const logged=(slot:typeof s.slots[number])=>{
  const done=(card.outcome[doseItem(slot)] as {status?:string}|undefined)?.status;
  return done==='taken'||done==='skipped'?done:slot.status==='taken'||slot.status==='skipped'?slot.status:null;
 };
 const lines=(what:(slot:typeof s.slots[number])=>string)=>s.slots.map((slot,i)=>{
  const status=logged(slot);
  const state=status?say(l,status==='taken'?DOSE.taken:DOSE.skipped):slot.status==='upcoming'?say(l,slot.planId?DOSE.laterPlan(slot.time):DOSE.later(slot.time)):null;
  return `${i+1}. ${what(slot)}, ${slot.time}${state?`: ${state}`:''}`;
 }).join('\n');
 const full=`${top}\n\n${lines(slot=>`${slot.name}${slot.dose?` ${slot.dose}`:''}`)}`;
 // A list too long for one message keeps every dose and time, with shorter names; the page and the app card have the rest.
 const text=full.length<=MAX_TEXT?full:`${top}\n\n${lines(slot=>slot.name.slice(0,48))}`;
 const open=s.slots.map((slot,i)=>({slot,n:i+1})).filter(({slot})=>!logged(slot)&&slot.status==='due');
 const many=open.length>1;
 const label=(line:string,n:number)=>many?`${n}. ${line}`:line;
 const rows=open.slice(0,MAX_OPEN_DOSES).map(({slot,n}):CardButton[]=>[
  {label:label(say(l,DOSE.markTaken),n),action:'dose_taken',item:{medicineId:slot.medicineId,dueAt:slot.dueAt}},
  {label:label(say(l,DOSE.markMissed),n),action:'dose_skipped',item:{medicineId:slot.medicineId,dueAt:slot.dueAt}},
 ]);
 return {text,rows};
}

/** A reading: the numbers come as a message, so a card either asks for them or shows typed ones back to save. */
function bpView(card:Extract<ValidCard,{kind:'bp'}>,l:CardLocale):TelegramCardView{
 const top=head(card,l,say(l,TITLE.bp)),s=card.snapshot,week=s.week;
 const lines=(...parts:(string|null|false|undefined)[])=>[top,...parts.filter(Boolean)].join('\n\n');
 const progress=week&&`${say(l,BP.week(week.day,week.days,week.slot==='evening'))}. ${say(l,BP.weekProgress(week.saved,week.expected))}`;
 const saved=card.outcome.bp as {systolic:number;diastolic:number;pulse:number|null;bp?:BpStep}|undefined;
 const safety=saved?.bp?bpSavedLine(l,saved.bp,saved):null;
 if(saved)return {text:lines(progress,say(l,BP.saved(bpText(l,saved))),...(safety?[safety]:[say(l,BP.noNotify),say(l,BP.worried)])),rows:[]};
 if(card.state==='done')return {text:lines(say(l,COMMON.closed)),rows:[]};
 if(s.typed)return {text:lines(progress,say(l,BP.confirmLine(`${bpText(l,{...s.typed,entrySource:s.typed.entrySource??'patient_text_entry'})}, ${shownAt(s.typed.measuredAt)}`)),say(l,BP.noNotify)),rows:[[{label:say(l,BP.yes),action:'bp_save',item:{}}]]};
 return {text:lines(progress,s.latest&&say(l,BP.last(bpText(l,s.latest),shownAt(s.latest.measuredAt))),say(l,BP.guide),say(l,BP.typeHere)),rows:[]};
}

const day=(iso:string)=>fmt(iso,{day:'2-digit',month:'2-digit',year:'numeric'}).replaceAll('/','.');
function resultsView(card:Extract<ValidCard,{kind:'results'}>,l:CardLocale):TelegramCardView{
 const top=head(card,l,say(l,TITLE.results)),s=card.snapshot;
 if(!s.available||!s.rows.length)return {text:`${top}\n\n${say(l,RESULTS.empty)}`,rows:[]};
 const note=`${say(l,RESULTS.approved)}${s.publishedAt?`. ${say(l,RESULTS.published(day(s.publishedAt)))}`:''}`;
 const line=(r:typeof s.rows[number])=>`${r.name}: ${r.value}${r.unit?` ${r.unit}`:''}${r.reference?` (${say(l,RESULTS.reference(r.reference))})`:''}${r.at?`, ${day(r.at)}`:''}`;
 const older=s.older?say(l,RESULTS.older(s.older)):null;
 const build=(n:number)=>[`${top}\n\n${note}`,s.rows.slice(0,n).map(line).join('\n'),n<s.rows.length?say(l,RESULTS.cut(s.rows.length-n)):null,older].filter(Boolean).join('\n\n');
 // Twelve long rows can pass one message: what is shown stays exact, and the card says how much is left out (Astra R1).
 let n=s.rows.length;
 while(n>1&&build(n).length>MAX_TEXT)n--;
 return {text:build(n),rows:s.more?[[{label:say(l,RESULTS.more(s.more)),action:'open_card',item:{kind:'results',page:(s.page??0)+1}}]]:[]};
}

function planView(card:Extract<ValidCard,{kind:'plan'}>,l:CardLocale):TelegramCardView{
 const top=head(card,l,say(l,TITLE.plan)),p=card.snapshot.plan;
 if(!card.snapshot.available||!p)return {text:`${top}\n\n${say(l,PLAN.empty)}`,rows:[]};
 const by=`${say(l,PLAN.approvedBy(p.clinician,day(p.publishedAt)))}${p.version?`. ${say(l,PLAN.version(p.version))}`:''}`;
 const medicines=p.medicines.length?`${say(l,PLAN.medicines)}\n${p.medicines.map(m=>`${m.name}, ${m.dose}${m.times.length?`, ${m.times.join(', ')}`:''}`).join('\n')}`:'';
 const tail=say(l,PLAN.readOnly);
 const parts=(words:string)=>[top,by,words,medicines,tail].filter(Boolean).join('\n\n');
 const instructions=memberInstruction(p.instructions,l,p.medicines.map(m=>m.name));
 if(parts(instructions).length<=MAX_TEXT)return {text:parts(instructions),rows:[]};
 // Longer than one message: the medicines and the doctor's name stay, the words stop at a sentence, and it says so.
 const cut=say(l,PLAN.cut),room=Math.max(0,MAX_TEXT-parts('').length-cut.length-4);
 const shown=instructions.slice(0,room).replace(/\s+\S*$/u,'');
 const text=parts(`${shown}\n\n${cut}`);
 return {text:text.length<=MAX_TEXT?text:text.slice(0,MAX_TEXT),rows:[]};
}

/** The goal card's own lines: the status comes from lib/ldl/status.ts, and nothing here words it differently. */
function ldlView(card:Extract<ValidCard,{kind:'ldl'}>,l:CardLocale):TelegramCardView{
 const top=head(card,l,say(l,TITLE.ldl)),data=card.snapshot.data;
 const rows:CardButton[][]=[];
 const lines=(...parts:(string|null|false|undefined)[])=>({text:[top,...parts.filter(Boolean)].join('\n\n'),rows});
 if(!data)return lines(say(l,TELEGRAM.unavailable));
 if(!data.enabled||!data.inPathway)return lines(say(l,LDL.notStarted));
 const when=(d:string)=>day(`${d}T12:00:00+04:00`),unit=say(l,LDL.unit),goal=data.goal,retest=data.retest;
 const withDoctor=data.withDoctor&&`${say(l,LDL.withDoctor)}. ${say(l,data.withDoctor.doctorName?LDL.withName(data.withDoctor.doctorName):LDL.withAnon)}`;
 const q=retest?.request;
 // A booking may hold 8,000 characters of preparation; one message may not. Stopped early, it says so (Astra LDL-02).
 const prep=(raw:string)=>{const t=memberInstruction(raw,l);return t.length<=PREP_MAX?t:`${t.slice(0,PREP_MAX).replace(/\s+\S*$/u,'')}\n${say(l,LDL.prepInApp)}`;};
 const next=retest?(q?.status==='provider-proposed'&&q.proposal?`${say(l,LDL.proposed)}: ${shownAt(q.proposal.startsAt)}, ${q.proposal.provider}. ${prep(q.proposal.preparation)}`
  :q?.arrangement&&(q.status==='confirmed'||q.status==='change-pending')?`${say(l,LDL.visit(shownAt(q.arrangement.startsAt)))}. ${prep(q.arrangement.preparation)}`
  :retest.overdue?`${say(l,LDL.due)}. ${say(l,LDL.dueBody)}`:`${say(l,LDL.window(when(retest.dueFrom),when(retest.dueTo)))}. ${say(l,LDL.windowBody)}`)
  :goal?.nextTestOn?say(l,LDL.next(when(goal.nextTestOn))):null;
 const accepted=card.outcome.ldl_visit!==undefined&&say(l,LDL.accepted);
 if(q?.status==='provider-proposed'&&q.proposal&&!accepted&&card.state==='open')rows.push([{label:say(l,LDL.accept),action:'ldl_visit_accept',item:{}}]);
 if(!goal)return lines(withDoctor,say(l,LDL.setting),say(l,LDL.settingBody),next,accepted);
 const a=assessLdl({goal,observations:data.observations}),latest=a.latest,threshold=formatMmol(goal.thresholdMmol);
 const pct=a.reduction.state==='met'||a.reduction.state==='not_met'?a.reduction:null;
 const target=`${say(l,LDL.goal(threshold,unit))}${ldlReductionShown(goal,a)?`\n${say(l,LDL.goalPct(String(goal.reductionPct)))}`:''}`;
 const onePart=ldlOnePartMet(a);
 const result=a.status==='not_assessable'||!latest?`${say(l,LDL.none)}. ${say(l,LDL.noneBody)}`
  :`${formatMmol(latest.mmol,goal.thresholdMmol)} ${unit}, ${say(l,LDL.latest(when(latest.on)))}\n${say(l,onePart?LDL.onePart:a.status==='at_goal'?LDL.below:LDL.above)}. ${say(l,onePart?LDL.onePartBody(threshold,unit):a.status==='at_goal'?LDL.belowBody:LDL.aboveBody)}${pct&&pct.percent>0?`\n${say(l,LDL.lower(formatPercent(pct.percent,pct.requiredPct)))}`:''}`;
 return lines(withDoctor,target,result,next,accepted);
}

function visitView(card:Extract<ValidCard,{kind:'visit'}>,l:CardLocale):TelegramCardView{
 const top=head(card,l,say(l,TITLE.visit)),s=card.snapshot;
 if(s.living){
  const v=s.living;
  const parts=[say(l,LIVING_VISIT.title),say(l,s.available?LIVING_VISIT[v.status]:LIVING_VISIT.unavailable),s.available&&v.status==='confirmed'&&v.startsAt?shownAt(v.startsAt):null,s.available&&v.status==='confirmed'?v.location:null];
  const build=(preparation:string|null)=>[...parts,preparation].filter(Boolean).join('\n\n');
  const preparation=s.available&&v.status==='confirmed'&&v.preparation?memberInstruction(v.preparation,l):null;
  let text=build(preparation);
  if(preparation&&text.length>MAX_TEXT){
   const tail=say(l,LDL.prepInApp);
   const room=Math.max(0,MAX_TEXT-build(tail).length-2);
   let shown=preparation.slice(0,room);
   // slice counts UTF-16 units, as the outbox does. Keep a surrogate pair together.
   if(/[\uD800-\uDBFF]$/u.test(shown))shown=shown.slice(0,-1);
   text=build(`${shown}\n\n${tail}`);
  }
  return {text,rows:[]};
 }
 if(!s.available)return {text:`${top}\n\n${say(l,TELEGRAM.unavailable)}`,rows:[]};
 const next=s.next&&`${shownAt(s.next.startsAt)}\n${say(l,s.next.mode==='home'?VISIT.home:VISIT.clinic)}. ${memberInstruction(s.next.location,l)}\n${say(l,s.next.status==='confirmed'?VISIT.confirmed:VISIT.pending)}`;
 const accepted=card.outcome.accepted!==undefined;
 const proposed=s.proposal&&(accepted?say(l,VISIT.accepted):say(l,VISIT.proposed(shownAt(s.proposal.startsAt),s.proposal.clinicName)));
 const text=[top,s.attention&&say(l,VISIT.attention),next||(!s.proposal&&say(l,VISIT.empty)),proposed,say(l,VISIT.changeInApp)].filter(Boolean).join('\n\n');
 return {text,rows:s.proposal&&!accepted&&card.state==='open'?[[{label:say(l,VISIT.accept),action:'visit_accept',item:{}}]]:[]};
}

/** What the member sees after answering; never advice. The doctor's list and the record are the ask's own. */
export function askAnswered(c:typeof MEDICINE_ASK_COPY['en'],reason:string){
 if(reason==='forgot')return c.forgot.body;
 if(reason==='side_effect')return `${c.doctor.sideEffect} ${c.doctor.noAdvice} ${c.doctor.urgent}`;
 if(reason==='decided_to_stop')return `${c.doctor.stop} ${c.doctor.noAdvice} ${c.doctor.urgent}`;
 return reason==='cost_or_availability'?`${c.refill.body} ${c.refill.cost}`:c.refill.body;
}
function askView(card:Extract<ValidCard,{kind:'ask'}>,l:CardLocale):TelegramCardView{
 const c=MEDICINE_ASK_COPY[l],s=card.snapshot,when=askWhen(s.dueAt,new Date(card.at),l);
 const top=`${zoeSignature(l)}${c.title}\n${s.trigger==='skipped'?c.skipped(s.name,when):c.missed(s.name,when)}`;
 const done=card.outcome.answer as {reason?:string}|undefined;
 if(done?.reason)return {text:`${top}\n\n${c.reasons[done.reason as AskReason]??''}\n\n${askAnswered(c,done.reason)}`,rows:[]};
 if(card.state==='done')return {text:`${top}\n\n${say(l,COMMON.closed)}`,rows:[]};
 return {text:`${top}\n\n${c.why}`,rows:ASK_REASONS.map(reason=>[{label:c.reasons[reason],action:'ask_reason',item:{reason}}])};
}

function sideEffectView(card:Extract<ValidCard,{kind:'side_effect'}>,l:CardLocale):TelegramCardView{
 const top=head(card,l,say(l,TITLE.side_effect)),done=card.outcome.picked as {what?:SideEffect}|undefined;
 if(done?.what)return {text:`${top}\n\n${say(l,SIDE_EFFECT[done.what])}. ${say(l,TG_WRITE.sent)}`,rows:[]};
 // A Telegram card arms eight buttons at most. Flushing is the one left to "Something else": it stays with the doctor either way.
 return {text:`${top}\n\n${say(l,SIDE.pick)}`,rows:SIDE_EFFECTS.filter(what=>what!=='flushing').map(what=>[{label:say(l,SIDE_EFFECT[what]),action:'side_effect_pick',item:{what}}])};
}

/**
 * A card that lost to a change made elsewhere (QA a9-01, a9-02): the record has moved, so the card claims nothing it can no longer
 * stand behind. Its text is what it showed, without what this card logged, and only "Show current in chat" stays.
 */
export function telegramStaleView(card:ZoeCard,l:CardLocale):TelegramCardView|null{
 const view=telegramCardView(card.valid?{...card,outcome:{}}:card,l);
 return view&&{text:`${view.text}\n\n${say(l,COMMON.staleInChat)}`.slice(0,MAX_TEXT),rows:view.rows.map(r=>r.filter(b=>b.action==='show_current')).filter(r=>r.length)};
}

/** The card's message, or null for a kind that is still app-only. */
export function telegramCardView(card:ZoeCard,l:CardLocale):TelegramCardView|null{
 if(!card.valid||!TELEGRAM_CARD_KINDS.includes(card.kind))return null;
 // The list of tasks: nothing recorded on it, so there is no "current" to show.
 if(card.kind==='ask')return askView(card,l);
 if(card.kind==='side_effect')return sideEffectView(card,l);
 if(card.kind==='message')return {text:`${zoeSignature(l)}${say(l,TITLE.message)}\n\n${say(l,TG_WRITE.message)}`,rows:[]};
 if(card.kind==='menu'&&card.snapshot.line&&!card.snapshot.kinds)return {text:`${zoeSignature(l)}${memberInstruction(card.snapshot.line,l)}`,rows:[]};
 if(card.kind==='menu')return {text:`${zoeSignature(l)}${say(l,TITLE.menu)}`,rows:TELEGRAM_MENU_KINDS.map(kind=>[{label:say(l,CHIP[kind]),action:'open_card',item:{kind}}])};
 const view=card.kind==='dose'?doseView(card,l):card.kind==='bp'?bpView(card,l):card.kind==='results'?resultsView(card,l):card.kind==='plan'?planView(card,l):card.kind==='ldl'?ldlView(card,l):card.kind==='visit'?visitView(card,l):null;
 return view&&{...view,rows:[...view.rows,[{label:say(l,COMMON.showCurrent),action:'show_current',item:{}}]]};
}
