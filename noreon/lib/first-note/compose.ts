import {evaluate} from '@/lib/clinical/rules/engine';
import type {Answers,Decision,DecisionFinding} from '@/lib/clinical/types';
import type {Appointment} from '@/lib/real-booking/appointment-schema';
import {currentAppointment} from '@/lib/patient-care/journey-step';
import {formatMemberDate} from '@/lib/patient/date-format';

/**
 * The first doctor note, "what I see and what comes next" (product review rec. 5). Closed vocabulary, as
 * lib/ai-plan does for every member-facing word: the text is fixed code wording around the rules engine's own
 * plain-language findings (`reason`, and an orange finding's `nextStep`), the same sentences the member
 * already sees on their questionnaire summary. No model writes it, no number or claim is added, and nothing
 * reaches the member until the assigned doctor approves it (they may edit it first).
 *
 * Not prepared for an urgent questionnaire (red: the urgent route leads) or before the questionnaire is
 * complete. The doctor's own words after an edit are theirs; the database checks length only.
 */
export const FIRST_NOTE_BUILDER='first-note-1';
export const FIRST_NOTE_VERSION='first-note-v1' as const;
export const FIRST_NOTE_MAX_FINDINGS=3;
type Pair={en:string;hy:string};
export type NextStepState='book'|'booked'|'waiting';
export type FirstNoteInput={answers:Answers;completedAt:string|null;urgentRule:string|null;firstName:string|null;next:NextStepState;visitWhen?:Pair|null};
export type FirstNoteDraft={text:Pair;sources:string[]};

const SHOWN=(f:DecisionFinding)=>f.category!=='reassuring'&&f.category!=='missing-data';
const order=(f:DecisionFinding)=>f.urgency==='orange'?0:f.urgency==='yellow'?1:2;
const sentence=(s:string)=>{const t=s.trim();return /[.։?!]$/.test(t)?t:`${t}.`;};

/** The findings the note names, most urgent first; red never reaches here. Every orange finding is kept,
 * whatever the cap (Astra FN-03); the cap only limits the others. */
export function noteFindings(decision:Decision):DecisionFinding[]{
 const sorted=decision.findings.filter(SHOWN).sort((a,b)=>order(a)-order(b));
 const orange=sorted.filter(f=>f.urgency==='orange').length;
 return sorted.slice(0,Math.max(FIRST_NOTE_MAX_FINDINGS,orange));
}

const NEXT:Record<NextStepState,Pair>={
 book:{en:'Next, book the tests your answers point to, at a clinic or at home.',hy:'Հաջորդ քայլը՝ գրանցվեք ձեր պատասխաններին համապատասխան հետազոտություններին՝ կլինիկայում կամ տանը։'},
 booked:{en:'Your visit for the tests is booked.',hy:'Ձեր այցը հետազոտությունների համար գրանցված է։'},
 waiting:{en:'Your care team will contact you about your tests.',hy:'Ձեր խնամքի թիմը կկապվի ձեզ հետ ձեր հետազոտությունների վերաբերյալ։'},
};

export function prepareFirstNote(input:FirstNoteInput):FirstNoteDraft|'not_ready'|'urgent'{
 if(!input.completedAt)return 'not_ready';
 if(input.urgentRule)return 'urgent';
 const decision=evaluate({answers:input.answers,observations:[]});
 if(decision.urgency==='red')return 'urgent';
 const shown=noteFindings(decision);
 const hello:Pair=input.firstName?{en:`Hello ${input.firstName}.`,hy:`Բարև ձեզ, ${input.firstName}։`}:{en:'Hello.',hy:'Բարև ձեզ։'};
 const read:Pair={en:'I have read your health questions.',hy:'Ես կարդացել եմ ձեր առողջական հարցերի պատասխանները։'};
 const see:Pair=shown.length
  ? {en:`What I see: ${shown.map(f=>sentence(f.reason.en??f.reason.hy)).join(' ')}`,hy:`Ինչ եմ տեսնում՝ ${shown.map(f=>sentence(f.reason.hy)).join(' ')}`}
  : {en:'Your answers do not point to anything I need to raise with you before your tests.',hy:'Ձեր պատասխաններում չկա մի բան, որը պետք է քննարկեմ ձեզ հետ մինչև հետազոտությունները։'};
 // Every orange finding's own next step, in registry order, identical sentences once (Astra FN-03).
 const steps:Pair[]=[];
 for(const f of shown)if(f.urgency==='orange'&&f.nextStep){const p={en:sentence(f.nextStep.en??f.nextStep.hy),hy:sentence(f.nextStep.hy)};if(!steps.some(x=>x.en===p.en))steps.push(p);}
 const visit=input.next==='booked'&&input.visitWhen?{en:`Your visit for the tests is ${input.visitWhen.en}.`,hy:`Ձեր այցը հետազոտությունների համար՝ ${input.visitWhen.hy}։`}:NEXT[input.next];
 const after:Pair={en:'When your results arrive, I review your answers, tests, home readings and reports together and prepare your care plan.',
  hy:'Երբ արդյունքները ստացվեն, ես միասին կդիտարկեմ ձեր պատասխանները, հետազոտությունները, տնային չափումներն ու զեկույցները և կպատրաստեմ ձեր խնամքի պլանը։'};
 const parts:Pair[]=[hello,read,see,...steps,visit,after];
 return {text:{en:parts.map(p=>p.en).join(' '),hy:parts.map(p=>p.hy).join(' ')},sources:shown.map(f=>f.ruleId)};
}

/** What comes next, from the member's visits: a confirmed future visit (with its time), another open one, or none. */
export function firstNoteNext(appointments:Appointment[]|undefined,now:number=Date.now()):{next:NextStepState;visitWhen:Pair|null}{
 const visit=appointments?currentAppointment(appointments):null;
 const at=visit?.status==='confirmed'&&visit.current&&Date.parse(visit.current.startsAt)>now?visit.current.startsAt:null;
 if(at){const w=(l:'en'|'hy')=>formatMemberDate(at,l,{timeZone:'Asia/Yerevan',weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});return {next:'booked',visitWhen:{en:w('en'),hy:w('hy')}};}
 return {next:visit&&visit.status!=='cancelled'?'waiting':'book',visitWhen:null};
}
