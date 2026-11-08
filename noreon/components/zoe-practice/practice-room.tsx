'use client';
import {Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition} from 'react';
import {ArrowUp} from 'lucide-react';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {PRACTICE_PATIENTS} from '@/lib/zoe/practice/patients';
import type {PracticeEdit,PracticeState,PracticeTurn} from '@/lib/zoe/practice/engine';
import {startPracticeSession,sendPracticeMessage,changePracticeRecord,resetPracticeSession,markPracticeReply} from '@/app/staff/real/zoe-practice/actions';
import {useChatViewport} from '@/components/patient/use-chat-viewport';
import {patientCopy} from './copy';
import {useThreadScroll} from '@/components/chat-v2/use-thread-scroll';
import {zoeName} from '@/lib/brand';

type Session={id:string;version:number;state:PracticeState};
type Reason='unsafe'|'too_alarming'|'too_cautious'|'wrong_fact'|'wrong_tone'|'other';
type Mark={rating:'good'|'wrong';reason?:Reason;correction?:string};
const reasons:readonly [Reason,string,string,string][]=[['unsafe','Unsafe','Անվտանգ չէ','Небезопасно'],['too_alarming','Too alarming','Չափազանց տագնապալի','Слишком тревожно'],['too_cautious','Too cautious','Չափազանց զգուշավոր','Слишком осторожно'],['wrong_fact','Wrong fact','Սխալ փաստ','Неверный факт'],['wrong_tone','Wrong tone','Սխալ տոն','Неверный тон'],['other','Other','Այլ','Другое']];
const answer=(turn:PracticeTurn)=>turn.finish.answer??turn.finish.receipt?.text;
// Decimal keypads give a comma on phones set to a comma locale.
const decimal=(value:string)=>Number(value.trim().replace(',','.'));
function Sheet({label,closeLabel,close,keyboard,children}:{label:string;closeLabel:string;close:()=>void;keyboard:boolean;children:React.ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const box=ref.current;box?.showModal();box?.focus({preventScroll:true});return()=>{box?.close();previous?.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} tabIndex={-1} className="cv2-menu zp-sheet" data-keyboard={keyboard||undefined} aria-label={label} onCancel={close}>
  <header><h2>{label}</h2><button type="button" onClick={close} aria-label={closeLabel}>×</button></header>{children}
 </dialog>;
}
function RecordView({turn,l}:{turn:PracticeTurn;l:StaffLocale}){
 const j=turn.job,r=j.memberRecord,h=j.health,p=j.topic?.profile;
 return <dl className="zp-record">
  <dt>{st(l,'Age','Տարիք','Возраст')}</dt><dd>{r?.ageYears??st(l,'Unknown','Անհայտ','Неизвестно')}</dd>
  <dt>{st(l,'Conditions','Առողջական խնդիրներ','Заболевания')}</dt><dd>{p?.conditions.join(', ')||st(l,'None recorded','Գրանցված չէ','Не записано')}</dd>
  <dt>{st(l,'Reading used','Օգտագործված չափում','Использованное измерение')}</dt><dd>{j.intake?.latestReading?`${j.intake.latestReading.systolic}/${j.intake.latestReading.diastolic} mmHg`:st(l,'Unknown','Անհայտ','Неизвестно')}</dd>
  <dt>LDL</dt><dd>{r?.ldl?.latest?`${r.ldl.latest.mmol} mmol/L`:st(l,'Unknown','Անհայտ','Неизвестно')}</dd>
  <dt>{st(l,'Medicines','Դեղեր','Лекарства')}</dt><dd>{p?.medicines.map(m=>`${m.name} ${m.dose}`).join(', ')||st(l,'None recorded','Գրանցված չէ','Не записано')}</dd>
  <dt>{st(l,'Marked doses','Նշված ընդունումներ','Отмеченные приёмы')}</dt><dd>{r?.doses?`${r.doses.taken}/${r.doses.expected}`:st(l,'Unknown','Անհայտ','Неизвестно')}</dd>
  <dt>{st(l,'Labs','Լաբորատոր արդյունքներ','Анализы')}</dt><dd>{h?.labs.map(v=>`${v.marker}: ${v.value} ${v.unit}`).join('; ')||st(l,'None recorded','Գրանցված չէ','Не записано')}</dd>
  <dt>{st(l,'Plan','Պլան','План')}</dt><dd>{h?.plan?[h.plan.explanation,h.plan.instructions,h.plan.medicationName,h.plan.medicationDose,h.plan.medicationInstructions,h.plan.followUp].filter(Boolean).join(' ')||st(l,'Plan recorded','Պլանը գրանցված է','План записан'):st(l,'None recorded','Գրանցված չէ','Не записано')}</dd>
  <dt>{st(l,'Reported side effect','Նշված կողմնակի ազդեցություն','Указанный побочный эффект')}</dt><dd>{turn.record.sideEffect||st(l,'None recorded','Գրանցված չէ','Не записано')}</dd>
 </dl>;
}
function WhyView({turn,l}:{turn:PracticeTurn;l:StaffLocale}){
 const why=turn.why;
 const safety=turn.events.filter(e=>e.outcome==='block'||e.outcome==='escalate');
 const earlier=[...turn.job.messages.filter(m=>m.seq!==turn.job.messageSeq).map(m=>({ago:m.minutesAgo,text:m.text,speaker:st(l,'Member','Անդամ','Участник')})),...turn.job.answers.map(a=>({ago:a.minutesAgo,text:a.body,speaker:'Zoe'})),...turn.job.replies.map(a=>({ago:a.minutesAgo,text:a.body,speaker:st(l,'Doctor','Բժիշկ','Врач')}))].sort((a,b)=>b.ago-a.ago);
 return <>
  <p className="zp-muted">{st(l,'This is the snapshot for this reply. Later edits do not change it.','Սա այս պատասխանի տվյալների պատճենն է։ Հետագա փոփոխությունները այն չեն փոխում։','Это снимок данных для этого ответа. Последующие изменения его не меняют.')}</p>
  <h3>{st(l,'Record used','Օգտագործված տվյալներ','Использованные данные')}</h3><RecordView turn={turn} l={l}/>
  <h3>{st(l,'Earlier conversation used','Օգտագործված նախորդ զրույցը','Использованная переписка')}</h3>
  {earlier.length?earlier.map((m,i)=><p key={i} className="zp-history"><strong>{m.speaker}: </strong>{m.text}</p>):<p>{st(l,'No earlier messages.','Նախորդ հաղորդագրություններ չկան։','Предыдущих сообщений нет.')}</p>}
  <h3>{st(l,'Why this reply','Ինչու այս պատասխանը','Почему этот ответ')}</h3>
  <p>{why?.doctor.why||st(l,'No additional explanation was recorded for this reply.','Այս պատասխանի համար լրացուցիչ բացատրություն չի գրանցվել։','Для этого ответа дополнительное объяснение не записано.')}</p>
  {why?.signs.map((s,i)=><p key={i}>{s.text}</p>)}
  {why?.doubts.map((s,i)=><p key={i}>{s.text}</p>)}
  <h3>{st(l,'Safety rules','Անվտանգության կանոններ','Правила безопасности')}</h3>
  <p>{safety.length?st(l,'A safety check changed or stopped part of this reply.','Անվտանգության ստուգումը փոխել կամ կանգնեցրել է պատասխանի մի մասը։','Проверка безопасности изменила или остановила часть ответа.'):st(l,'No safety check blocked this reply.','Անվտանգության ստուգումը չի արգելափակել այս պատասխանը։','Проверка безопасности не заблокировала этот ответ.')}</p>
  {safety.map((e,i)=><p key={i} className="zp-muted">{e.reason.replaceAll('_',' ').replaceAll('.',' ')}</p>)}
  <h3>{st(l,'Route taken','Ընտրված ուղի','Выбранный маршрут')}</h3>
  <p>{turn.finish.outcome==='discarded'||turn.finish.outcome==='intake_escalated'?st(l,'Urgent safety response','Շտապ անվտանգության պատասխան','Срочный ответ по безопасности'):turn.finish.outcome==='answered'?st(l,'Zoe answered after checks','Զոյան պատասխանել է ստուգումներից հետո','Зоя ответила после проверок'):turn.finish.outcome==='chatted'?st(l,'Conversation reply','Զրույցի պատասխան','Ответ в переписке'):st(l,'Held for clinical review or no reply','Պահվել է բժշկական ստուգման համար կամ պատասխան չկա','Оставлено для клинической проверки или без ответа')}</p>
  <p className="zp-muted">{st(l,'Practice only. Nothing was sent to a member or care team.','Միայն փորձարկում։ Ոչինչ չի ուղարկվել անդամին կամ խնամքի թիմին։','Только практика. Ничего не отправлено участнику или команде помощи.')}</p>
  <p className="zp-muted">{turn.finish.model} · {why?.models.prompt??why?.models.config}</p>
 </>;
}
function EditRecord({state,l,onSave,busy}:{state:PracticeState;l:StaffLocale;onSave:(edit:PracticeEdit)=>void;busy:boolean}){
 const [kind,setKind]=useState<PracticeEdit['kind']>('ldl');
 const r=state.record;
 const [ldl,setLdl]=useState(String(r.memberRecord.ldl?.latest?.mmol??''));
 const [systolic,setSystolic]=useState(String(r.reading?.systolic??'')),[diastolic,setDiastolic]=useState(String(r.reading?.diastolic??''));
 const [medicine,setMedicine]=useState(r.memberRecord.ldl?.therapies[0]?.name??''),[dose,setDose]=useState(r.memberRecord.ldl?.therapies[0]?.dose??'');
 const [sideEffect,setSideEffect]=useState(r.sideEffect??'');
 return <form className="zp-form" onSubmit={e=>{e.preventDefault();onSave(kind==='ldl'?{kind,mmol:decimal(ldl)}:kind==='reading'?{kind,systolic:Number(systolic),diastolic:Number(diastolic)}:kind==='medicine'?{kind,name:medicine,dose}:{kind,text:sideEffect.trim()||null});}}>
  <label>{st(l,'Change','Փոխել','Изменить')}<select value={kind} onChange={e=>setKind(e.target.value as PracticeEdit['kind'])}>
   <option value="ldl">LDL</option><option value="reading">{st(l,'Reading','Չափում','Измерение')}</option><option value="medicine">{st(l,'Medicine','Դեղ','Лекарство')}</option><option value="sideEffect">{st(l,'Side effect','Կողմնակի ազդեցություն','Побочный эффект')}</option>
  </select></label>
  {kind==='ldl'&&<label>LDL (mmol/L)<input inputMode="decimal" required value={ldl} onChange={e=>{const n=decimal(e.target.value);e.target.setCustomValidity(n>=0.1&&n<=30?'':st(l,'Enter an LDL from 0.1 to 30.','Մուտքագրեք LDL 0.1-ից 30։','Введите LDL от 0.1 до 30.'));setLdl(e.target.value);}}/></label>}
  {kind==='reading'&&<><label>{st(l,'Systolic','Սիստոլիկ','Систолическое')}<input type="number" inputMode="numeric" min="40" max="300" required value={systolic} onChange={e=>setSystolic(e.target.value)}/></label><label>{st(l,'Diastolic','Դիաստոլիկ','Диастолическое')}<input type="number" inputMode="numeric" min="20" max="200" required value={diastolic} onChange={e=>setDiastolic(e.target.value)}/></label></>}
  {kind==='medicine'&&<><label>{st(l,'Medicine name','Դեղի անունը','Название лекарства')}<input required maxLength={120} value={medicine} onChange={e=>setMedicine(e.target.value)}/></label><label>{st(l,'Dose','Դեղաչափ','Доза')}<input required maxLength={60} value={dose} onChange={e=>setDose(e.target.value)}/></label></>}
  {kind==='sideEffect'&&<label>{st(l,'Side effect, blank to clear','Կողմնակի ազդեցություն, մաքրելու համար թողեք դատարկ','Побочный эффект, пустое поле для удаления')}<textarea maxLength={1000} value={sideEffect} onChange={e=>setSideEffect(e.target.value)}/></label>}
  <button className="zp-primary" disabled={busy}>{st(l,'Save record','Պահպանել տվյալները','Сохранить данные')}</button>
 </form>;
}
export function PracticeRoom(){
 const [l,setLocale]=useState<StaffLocale>('en'),[session,setSession]=useState<Session|null>(null),[text,setText]=useState(''),[notice,setNotice]=useState('');
 const [busy,start]=useTransition(),[sheet,setSheet]=useState<{kind:'why'|'wrong';turn:PracticeTurn}|{kind:'reset'|'choose'}|null>(null),[editing,setEditing]=useState(false);
 const [marks,setMarks]=useState<Record<string,Mark>>({}),[saving,setSaving]=useState<string|null>(null),[failed,setFailed]=useState<{sessionId:string;turn:PracticeTurn;mark:Mark}|null>(null);
 const [reason,setReason]=useState<Reason>('wrong_fact'),[correction,setCorrection]=useState('');
 const input=useRef<HTMLTextAreaElement>(null);
 const keyboard=useChatViewport(true);
 const {threadRef,contentRef,unread,newest}=useThreadScroll(`${session?.id}:${session?.version}`);
 useLayoutEffect(()=>{const field=input.current;if(field){field.style.height='auto';field.style.height=`${Math.min(field.scrollHeight,110)}px`;}},[text]);
 const errorText=(code:string)=>code==='conversation_full'?st(l,'This conversation is full. Reset it to keep practising.','Այս զրույցը լցված է։ Վերականգնեք այն՝ շարունակելու համար։','Эта переписка заполнена. Сбросьте её, чтобы продолжить.'):code.includes('limit')?st(l,'You have reached the daily practice limit. Try again tomorrow.','Դուք հասել եք օրական փորձարկման սահմանին։ Փորձեք վաղը։','Дневной лимит практики достигнут. Попробуйте завтра.'):code==='provider_unavailable'?st(l,'Zoe is unavailable for practice right now. Your record is still here.','Զոյան այժմ հասանելի չէ փորձարկման համար։ Ձեր տվյալներն այստեղ են։','Зоя сейчас недоступна для практики. Данные сохранены.'):code==='conflict'?st(l,'The conversation has been refreshed. Check the latest reply before trying again.','Զրույցը թարմացվել է։ Ստուգեք վերջին պատասխանը՝ կրկին փորձելուց առաջ։','Переписка обновлена. Проверьте последний ответ перед повторной попыткой.'):code==='busy'?st(l,'Zoe is still answering. Try again shortly.','Զոյան դեռ պատասխանում է։ Փորձեք մի փոքր ուշ։','Зоя ещё отвечает. Попробуйте чуть позже.'):st(l,'Could not save. Try again.','Չհաջողվեց պահպանել։ Փորձեք նորից։','Не удалось сохранить. Попробуйте снова.');
 function choose(patientId:string){if(busy)return;setNotice('');start(async()=>{try{const r=await startPracticeSession({patientId});if(r.ok){setSession(r.session);setMarks({});setText('');setSheet(null);newest();}else{if(r.session)setSession(r.session);setNotice(errorText(r.code));}}catch{setNotice(errorText('unavailable'));}});}
 function send(){if(!session||busy||!text.trim())return;const pending=text;setText('');setNotice('');newest();start(async()=>{try{const r=await sendPracticeMessage({sessionId:session.id,expectedVersion:session.version,text:pending});if(r.ok)setSession(r.session);else{if(r.session)setSession(r.session);setText(r.session?.state.turns.at(-1)?.text===pending.trim()?'':pending);setNotice(errorText(r.code));}}catch{setText(pending);setNotice(errorText('unavailable'));}});}
 function edit(edit:PracticeEdit){if(!session||busy)return;start(async()=>{try{const r=await changePracticeRecord({sessionId:session.id,expectedVersion:session.version,edit});if(r.ok){setSession(r.session);setSheet(null);setEditing(false);setNotice('');}else{if(r.session)setSession(r.session);setNotice(errorText(r.code));}}catch{setNotice(errorText('unavailable'));}});}
 function saveMark(turn:PracticeTurn,mark:Mark){if(!session||saving)return;const sessionId=session.id;setSaving(turn.id);setFailed(null);start(async()=>{try{const r=await markPracticeReply({sessionId,turnId:turn.id,...mark});if(r.ok){setMarks(prev=>({...prev,[turn.id]:mark}));setSheet(null);setCorrection('');}else setFailed({sessionId,turn,mark});}catch{setFailed({sessionId,turn,mark});}finally{setSaving(null);}});}
 // Turn ids repeat between sessions, so an unsaved correction must never follow into the next one.
 const unsaved=failed?.sessionId===session?.id?failed:null;
 useEffect(()=>{setFailed(null);setCorrection('');},[session?.id]);
 const patient=PRACTICE_PATIENTS.find(p=>p.id===session?.state.patientId);
 const chooser=<div className="zp-choices">{PRACTICE_PATIENTS.map(p=><button type="button" key={p.id} disabled={busy} onClick={()=>choose(p.id)}><strong>{patientCopy(p,l).name}</strong><span>{patientCopy(p,l).title}</span><small>{patientCopy(p,l).detail}</small></button>)}</div>;
 const close=()=>{if(!busy){setSheet(null);setEditing(false);}};
 return <main className="cv2-root zp-room" lang={l} data-practice-room>
  <header className="cv2-header"><h1><i className="cv2-orb" aria-hidden/>{zoeName(l)} {st(l,'practice','փորձարկում','практика')}</h1><select aria-label={st(l,'Language','Լեզու','Язык')} value={l} onChange={e=>setLocale(e.target.value as StaffLocale)}><option value="en">English</option><option value="hy">Հայերեն</option><option value="ru">Русский</option></select></header>
  <div className="cv2-greet"><h2>{(patient?patientCopy(patient,l).name:null)??st(l,'Choose a fictional member','Ընտրեք հորինված անդամ','Выберите вымышленного участника')}</h2><p>{st(l,'Practice only. Nothing goes to a member.','Միայն փորձարկում։ Ոչինչ չի գնում անդամին։','Только практика. Участнику ничего не уходит.')}</p></div>
  {session&&<div className="zp-toolbar"><button onClick={()=>{setNotice('');setSheet({kind:'choose'});}} disabled={busy}>{st(l,'Choose member','Ընտրել անդամ','Выбрать участника')}</button><button onClick={()=>{setNotice('');setSheet({kind:'reset'});}} disabled={busy}>{st(l,'Reset conversation','Վերականգնել զրույցը','Сбросить переписку')}</button></div>}
  <section ref={threadRef} className="cv2-thread" data-zoe-thread aria-label={st(l,'Practice conversation','Փորձարկման զրույց','Практическая переписка')} role="log" tabIndex={0}>
   <div ref={contentRef} className="cv2-messages">
    <p className="zp-muted">{st(l,'Fictional records only. Do not enter real member details.','Միայն հորինված տվյալներ։ Մի մուտքագրեք իրական անդամի տվյալներ։','Только вымышленные данные. Не вводите сведения реальных участников.')}</p>
    {!session?chooser:<>
     {!session.state.turns.length&&<div className="zp-starter"><p className="zp-muted">{st(l,'Try this question, or write your own below.','Փորձեք այս հարցը կամ գրեք ձերը ստորև։','Попробуйте этот вопрос или напишите свой ниже.')}</p><button type="button" onClick={()=>{setText(patient?.opening??'');input.current?.focus({preventScroll:true});}}>{patient?.opening}</button></div>}
     {session.state.turns.map((turn,index)=><Fragment key={turn.id}>
      {session.state.edits.filter(e=>e.at===index).map((e,i)=><p className="cv2-divider" key={i}>{st(l,'Record changed','Տվյալները փոխվել են','Данные изменены')}: {e.edit.kind==='ldl'?`LDL ${e.edit.mmol} mmol/L`:e.edit.kind==='reading'?`${e.edit.systolic}/${e.edit.diastolic}`:e.edit.kind==='medicine'?`${e.edit.name} ${e.edit.dose}`:e.edit.text||st(l,'Side effect cleared','Կողմնակի ազդեցությունը մաքրվել է','Побочный эффект удалён')}</p>)}
      <article className="cv2-msg cv2-me"><p className="cv2-say">{turn.text}</p></article>
      <article className="cv2-msg cv2-zoe" data-practice-reply><p className="cv2-from">{zoeName(l)}</p><p className="cv2-say">{answer(turn)||st(l,'No reply was sent by this route. Open the record to see why.','Այս ուղիով պատասխան չի ուղարկվել։ Բացեք տվյալները՝ պատճառը տեսնելու համար։','По этому маршруту ответ не отправлен. Откройте данные, чтобы узнать причину.')}</p>
       <div className="zp-reply-actions"><button onClick={()=>{setEditing(false);setSheet({kind:'why',turn});}}>{st(l,'What Zoe saw','Ինչ տեսավ Զոյան','Что увидела Зоя')}</button><button disabled={busy} aria-pressed={marks[turn.id]?.rating==='good'} onClick={()=>saveMark(turn,{rating:'good'})}>{st(l,'Good','Լավ','Хорошо')}</button><button disabled={busy} aria-pressed={marks[turn.id]?.rating==='wrong'} onClick={()=>{setCorrection(marks[turn.id]?.correction??'');setReason(marks[turn.id]?.reason??'wrong_fact');setSheet({kind:'wrong',turn});}}>{st(l,'Wrong','Սխալ','Неверно')}</button></div>
       {(marks[turn.id]||saving===turn.id)&&<p role="status" className="zp-muted">{saving===turn.id?st(l,'Saving…','Պահպանվում է…','Сохранение…'):marks[turn.id].rating==='good'?st(l,'Saved: good','Պահպանված է՝ լավ','Сохранено: хорошо'):st(l,'Saved: wrong','Պահպանված է՝ սխալ','Сохранено: неверно')}</p>}
       {unsaved?.turn.id===turn.id&&sheet?.kind!=='wrong'&&<><p role="alert">{st(l,'Not saved. Try again.','Չի պահպանվել։ Փորձեք նորից։','Не сохранено. Попробуйте снова.')}</p><button onClick={()=>saveMark(unsaved.turn,unsaved.mark)}>{st(l,'Retry save','Կրկին պահպանել','Повторить сохранение')}</button></>}
      </article>
     </Fragment>)}
     {session.state.edits.filter(e=>e.at===session.state.turns.length).map((e,i)=><p className="cv2-divider" key={i}>{st(l,'Record changed','Տվյալները փոխվել են','Данные изменены')}: {e.edit.kind==='ldl'?`LDL ${e.edit.mmol} mmol/L`:e.edit.kind==='reading'?`${e.edit.systolic}/${e.edit.diastolic}`:e.edit.kind==='medicine'?`${e.edit.name} ${e.edit.dose}`:e.edit.text}</p>)}
    </>}
    {busy&&!sheet&&<p role="status">{st(l,'Working…','Ընթացքում է…','Обработка…')}</p>}
    {notice&&<p role="status">{notice}</p>}
   </div>
  </section>
  {unread&&<button className="cv2-new" onClick={newest}>{st(l,'New message','Նոր հաղորդագրություն','Новое сообщение')}</button>}
  {session&&<footer className="cv2-bottom"><form className="cv2-composer" onSubmit={e=>{e.preventDefault();send();input.current?.focus({preventScroll:true});}}><textarea ref={input} rows={1} value={text} maxLength={4000} aria-label={st(l,'Your message','Ձեր հաղորդագրությունը','Ваше сообщение')} placeholder={st(l,'Speak as the fictional member…','Գրեք հորինված անդամի անունից…','Пишите от имени вымышленного участника…')} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&(!(window.matchMedia('(pointer: coarse)').matches)||e.ctrlKey||e.metaKey)){e.preventDefault();send();}}}/><button type="submit" disabled={busy||!text.trim()} aria-label={st(l,'Send','Ուղարկել','Отправить')} onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()}><ArrowUp size={18} aria-hidden/></button></form></footer>}
  {sheet&&<Sheet keyboard={keyboard} closeLabel={st(l,'Close','Փակել','Закрыть')} label={sheet.kind==='why'?(editing?st(l,'Change the record','Փոխել տվյալները','Изменить данные'):st(l,'What Zoe saw','Ինչ տեսավ Զոյան','Что увидела Зоя')):sheet.kind==='wrong'?st(l,'Correct this reply','Ուղղել այս պատասխանը','Исправить ответ'):sheet.kind==='reset'?st(l,'Reset conversation','Վերականգնել զրույցը','Сбросить переписку'):st(l,'Choose a fictional member','Ընտրեք հորինված անդամ','Выберите вымышленного участника')} close={close}>
   {sheet.kind==='choose'&&chooser}
   {sheet.kind==='why'&&<>{editing&&session?<EditRecord state={session.state} l={l} onSave={edit} busy={busy}/>:<><WhyView turn={sheet.turn} l={l}/><button className="zp-primary zp-sticky" onClick={()=>setEditing(true)}>{st(l,'Change the record','Փոխել տվյալները','Изменить данные')}</button></>}</>}
   {sheet.kind==='wrong'&&<form className="zp-form" onSubmit={e=>{e.preventDefault();saveMark(sheet.turn,{rating:'wrong',reason,correction:correction.trim()});}}><label>{st(l,'Reason','Պատճառ','Причина')}<select value={reason} onChange={e=>setReason(e.target.value as Reason)}>{reasons.map(([id,en,hy,ru])=><option key={id} value={id}>{st(l,en,hy,ru)}</option>)}</select></label><label>{st(l,'What Zoe should have said','Ինչ պետք է ասեր Զոյան','Что должна была сказать Зоя')}<textarea required maxLength={4000} rows={4} value={correction} onChange={e=>setCorrection(e.target.value)}/></label><button disabled={busy||!correction.trim()} className="zp-primary">{unsaved?st(l,'Retry save','Կրկին պահպանել','Повторить сохранение'):st(l,'Save correction','Պահպանել ուղղումը','Сохранить исправление')}</button>{unsaved&&<p role="alert">{st(l,'Not saved. Your correction is still here.','Չի պահպանվել։ Ձեր ուղղումը դեռ այստեղ է։','Не сохранено. Исправление осталось здесь.')}</p>}</form>}
   {sheet.kind==='reset'&&<><p>{st(l,'Start again with the original fictional record. Saved marks are kept.','Սկսեք նորից սկզբնական հորինված տվյալներով։ Պահպանված գնահատականները կմնան։','Начните заново с исходными вымышленными данными. Оценки сохранятся.')}</p><button disabled={busy} className="zp-primary" onClick={()=>{if(!session)return;start(async()=>{try{const r=await resetPracticeSession({sessionId:session.id,expectedVersion:session.version});if(r.ok){setSession(r.session);setMarks({});setText('');setNotice('');setSheet(null);newest();}else{if(r.session)setSession(r.session);setNotice(errorText(r.code));}}catch{setNotice(errorText('unavailable'));}});}}>{st(l,'Reset to the start','Վերադարձնել սկզբին','Вернуться к началу')}</button></>}
   {notice&&<p role="alert">{notice}</p>}
  </Sheet>}
 </main>;
}
