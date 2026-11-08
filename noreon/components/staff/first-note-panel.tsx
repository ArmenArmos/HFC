'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {Bot,CheckCircle2} from 'lucide-react';
import {buttonClass} from './shell';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {FIRST_NOTE_BUILDER,FIRST_NOTE_VERSION,type FirstNoteDraft} from '@/lib/first-note/compose';
import type {ApproveResult,DoctorFirstNote} from '@/lib/first-note/schema';

import {clinicalLocale,type Locale} from '@/lib/locale';
const field='w-full rounded-md border bg-background px-3 py-2 text-body2 outline-none focus-visible:ring-2 focus-visible:ring-ring';
const copy:Record<Locale,Record<'title'|'label'|'intro'|'due'|'late'|'english'|'armenian'|'approve'|'saving'|'approved'|'edited'|'checkAgain',string>&{result:Record<string,string>}>={
 en:{title:'First note to the member',label:'Prepared from the rules engine | Not sent until you approve',
  intro:'"What I see and what comes next": the member gets this in their chat until their care plan is published. Check it, edit it if you want, then approve.',
  due:'Approve by',late:'Overdue, approve by',english:'English',armenian:'Armenian',approve:'Approve and show to the member',saving:'Saving…',approved:'Approved',edited:'edited by the doctor',checkAgain:'Check again',
  result:{approved:'Approved. The member gets it in their chat.',already:'A first note is already approved for this member. Reload.','not-ready':'The questionnaire is not finished.',urgent:'Urgent guidance is active, so no first note is sent.',
   'plan-active':'A care plan is already published.',disabled:'First notes are switched off.',invalid:'Check the text: both languages are needed.',stale:'This changed. Reload.',unavailable:'Couldn’t save right now. Try again.',
   access:'Only the assigned doctor can approve this note.','outcome-unknown':'Save outcome unknown. Check again: a note is never saved twice.'} as Record<string,string>},
 hy:{title:'Առաջին գրառումն անդամին',label:'Պատրաստված է կանոնների համակարգից | Չի ուղարկվում մինչև ձեր հաստատումը',
  intro:'«Ինչ եմ տեսնում և ինչ է լինելու հետո»․ անդամը սա ստանում է իր զրույցում, մինչև խնամքի պլանի հրապարակումը։ Ստուգեք, անհրաժեշտության դեպքում խմբագրեք, ապա հաստատեք։',
  due:'Հաստատել մինչև',late:'Ժամկետն անցել է, հաստատել էր մինչև',english:'Անգլերեն',armenian:'Հայերեն',approve:'Հաստատել և ցույց տալ անդամին',saving:'Պահպանվում է…',approved:'Հաստատված է',edited:'խմբագրված է բժշկի կողմից',checkAgain:'Կրկին ստուգել',
  result:{approved:'Հաստատված է։ Անդամն այն ստանում է իր զրույցում։',already:'Այս անդամի համար առաջին գրառումն արդեն հաստատված է։ Թարմացրեք էջը։','not-ready':'Հարցաշարն ավարտված չէ։',urgent:'Գործում է շտապ ուղեցույց, ուստի առաջին գրառումը չի ուղարկվում։',
   'plan-active':'Խնամքի պլանն արդեն հրապարակված է։',disabled:'Առաջին գրառումներն անջատված են։',invalid:'Ստուգեք տեքստը․ անհրաժեշտ են երկու լեզուները։',stale:'Սա փոխվել է։ Թարմացրեք էջը։',unavailable:'Այս պահին չհաջողվեց պահպանել։ Փորձեք կրկին։',
   access:'Միայն կցված բժիշկը կարող է հաստատել այս գրառումը։','outcome-unknown':'Պահպանման արդյունքն անհայտ է։ Կրկին ստուգեք․ գրառումը երբեք երկու անգամ չի պահվում։'} as Record<string,string>},
 ru:{title:'Первое сообщение участнику',label:'Подготовлено на основе системы правил | Не отправляется до вашего утверждения',
  intro:'«Что я вижу и что будет дальше»: участник получает это в своём чате до публикации плана лечения. Проверьте, при желании отредактируйте, затем утвердите.',
  due:'Утвердить до',late:'Просрочено, нужно было утвердить до',english:'Английский',armenian:'Армянский',approve:'Утвердить и показать участнику',saving:'Сохраняется…',approved:'Утверждено',edited:'отредактировано врачом',checkAgain:'Проверить снова',
  result:{approved:'Утверждено. Участник получает это в своём чате.',already:'Первое сообщение для этого участника уже утверждено. Обновите страницу.','not-ready':'Анкета не завершена.',urgent:'Действуют срочные рекомендации, поэтому первое сообщение не отправляется.',
   'plan-active':'План лечения уже опубликован.',disabled:'Первые сообщения отключены.',invalid:'Проверьте текст: нужны оба языка.',stale:'Данные изменились. Обновите страницу.',unavailable:'Сейчас не удалось сохранить. Попробуйте снова.',
   access:'Только назначенный врач может утвердить это сообщение.','outcome-unknown':'Результат сохранения неизвестен. Проверьте снова: сообщение никогда не сохраняется дважды.'} as Record<string,string>},
};

export function FirstNotePanel({data,draft,assessmentRevision,memberId,locale,submissionId,approve,now}:{data:Extract<DoctorFirstNote,{enabled:true}>;draft:FirstNoteDraft|null;assessmentRevision:number;memberId:string;locale:Locale;submissionId:string;approve:(input:unknown)=>Promise<ApproveResult>;now:string}){
 const t=copy[locale];const router=useRouter();
 const [en,setEn]=useState(draft?.text.en??''),[hy,setHy]=useState(draft?.text.hy??'');
 const [pending,setPending]=useState(false),[msg,setMsg]=useState<{ok:boolean;text:string}|null>(null),[frozen,setFrozen]=useState<object|null>(null);
 if(data.planActive&&!data.note)return null;
 const note=data.note;
 async function send(input:object){
  setPending(true);setMsg(null);
  const r=await approve(input).catch(():ApproveResult=>({status:'outcome-unknown'}));
  setPending(false);if(r.status!=='outcome-unknown')setFrozen(null);
  setMsg({ok:r.status==='approved',text:t.result[r.status]??r.status});
  if(r.status==='approved'||r.status==='already')router.refresh();
 }
 const late=data.dueAt&&Date.parse(data.dueAt)<Date.parse(now);
 return <section id="first-note" aria-labelledby="first-note-title" className="scroll-mt-6 space-y-3 rounded-xl border border-brand-gold bg-surface-subtle-gold p-4 sm:p-5">
  <div className="space-y-1"><h2 id="first-note-title" className="text-h3">{t.title}</h2>
   {!note&&<p className="inline-flex items-center gap-2 text-caption font-medium"><Bot className="size-4" aria-hidden/>{t.label}</p>}</div>
  {note?<div className="space-y-2">
    <p className="inline-flex items-center gap-2 text-body2 font-medium"><CheckCircle2 className="size-4" aria-hidden/>{t.approved} {yerevanStamp(note.approvedAt,locale)}{note.doctorName?` · ${note.doctorName}`:''}{note.edited?` · ${t.edited}`:''}</p>
    <p lang={clinicalLocale(locale)} className="whitespace-pre-wrap text-body2">{clinicalLocale(locale)==='hy'?note.textHy:note.textEn}</p>
   </div>
  :draft&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();if(pending)return;
    const input={version:FIRST_NOTE_VERSION,memberId,submissionId,textEn:en.trim(),textHy:hy.trim(),builderVersion:FIRST_NOTE_BUILDER,sources:draft.sources,edited:en.trim()!==draft.text.en||hy.trim()!==draft.text.hy,assessmentRevision};
    setFrozen(input);void send(input);}}>
    <p className="text-body2 text-muted-foreground">{t.intro}</p>
    {data.dueAt&&<p className={`text-body2 ${late?'font-semibold text-destructive':''}`}>{late?t.late:t.due}: {yerevanStamp(data.dueAt,locale)}</p>}
    <label className="block text-caption">{t.armenian}<textarea lang="hy" className={`${field} mt-1`} rows={6} maxLength={2000} value={hy} onChange={e=>setHy(e.target.value)} disabled={!!frozen}/></label>
    <label className="block text-caption">{t.english}<textarea lang="en" className={`${field} mt-1`} rows={5} maxLength={1500} value={en} onChange={e=>setEn(e.target.value)} disabled={!!frozen}/></label>
    {frozen&&msg&&!msg.ok?<button type="button" className={buttonClass} disabled={pending} onClick={()=>void send(frozen)}>{pending?t.saving:t.checkAgain}</button>
     :<button className={buttonClass} disabled={pending||!en.trim()||!hy.trim()}>{pending?t.saving:t.approve}</button>}
   </form>}
  {msg&&<p role={msg.ok?'status':'alert'} className="text-body2">{msg.text}</p>}
 </section>;
}
