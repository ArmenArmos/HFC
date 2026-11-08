import {Check} from 'lucide-react';
import {useState,type ReactNode} from 'react';
import {Progress} from '@/components/ui/progress';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {itemTitle,itemDetail,visitCopy,valueText,visitBriefing,visitBlockCopy,briefingItemTitle} from '@/lib/nurse-visit/copy';
import {visitBlocks,visitQuestionPending,type ChatVisitQuestion as VisitQuestion} from '@/lib/nurse-visit/chat-order';
import {VisitMeasurementBlock,VisitShortcutCard,type VisitMeasurementDraft} from './visit-fields';
import {NurseSampleCollection} from './sample-collection';
import {collectionCopy,collectionCounts,collectionStatus} from '@/lib/nurse-visit/collection';
import {questionKey,type useNurseVisit} from './use-nurse-visit';

type Visit=ReturnType<typeof useNurseVisit>;
export function visitComposerLabel(visit:Visit,l:StaffLocale){
 const copy=visitCopy(l),f=visit.flow,q=visit.question;
 if(f?.commenting)return copy.commentLabel;
 if(f?.view==='complete'&&f.data?.items.some(item=>!item.mark?.done))return copy.reasonLabel;
 if(q?.kind==='item'&&q.item.kind==='measurement')return itemTitle(q.item,l);
 return `${st(l,'Visit with','Այց՝','Визит:')} ${f?.selection.memberName??''}`;
}
/** The row above the composer names the item, so the field itself stays one short line. */
export function visitComposerHint(visit:Visit,l:StaffLocale){
 if(!visitTakesWords(visit))return st(l,'Choose above','Ընտրեք վերևում','Выберите выше');
 if(visit.flow?.commenting||visit.flow?.view==='complete')return st(l,'Write here','Գրեք այստեղ','Напишите здесь');
 const field=visit.question?.kind==='item'&&visit.question.item.kind==='measurement'?visit.question.item.field:null;
 if(field==='weight')return visitCopy(l).weightInput;
 if(field==='waist')return visitCopy(l).waistInput;
 return visitBlockCopy(l).shortcut;
}
export function visitTakesWords(visit:Visit){return Boolean(visit.flow?.data&&!visit.flow.preview&&!visit.flow.data.completion&&visit.flow.data.visit.bookingStatus!=='cancelled');}

export function NurseVisit({visit:v,locale:l,onAction,draft}:{visit:Visit;locale:StaffLocale;onAction:(action:()=>void)=>void;draft:string}){
 const [detailsOpen,setDetailsOpen]=useState(false);
 const [readingDrafts,setReadingDrafts]=useState<Record<string,VisitMeasurementDraft>>({});
 const f=v.flow;if(!f)return null;
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru),copy=visitCopy(l),data=f.data,q=v.question;
 const reply=(content:ReactNode,question?:string)=><article className="cv2-msg cv2-zoe" data-visit-question={question}><div className="cv2-say ncv2-card">{content}</div></article>;
 const chip=(label:string,action:()=>void,key?:string,replay=false)=><button key={key??label} type="button" className="ncv2-choice" disabled={replay?v.sending:v.frozen} onClick={()=>onAction(action)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{label}</button>;
 const retry=t('Try again','Փորձել կրկին','Попробовать снова');
 if(!data)return reply(<><p role="status">{f.loaded?t('This visit is unavailable. It may have changed, been cancelled, or your access may have changed. Try opening your visit again.','Այս այցն անհասանելի է։ Այն կարող է փոխված կամ չեղարկված լինել, կամ ձեր հասանելիությունը փոխված լինի։ Փորձեք կրկին բացել այցը։','Этот визит недоступен. Возможно, он изменён или отменён либо изменился ваш доступ. Попробуйте открыть визит снова.'):t('Loading your visit…','Ձեր այցը բեռնվում է…','Загружаем ваш визит…')}</p>{v.uncertain?chip(retry,()=>{void v.retry();},'retry',true):f.loaded&&chip(retry,()=>{void v.refresh();})}</>);
 const block=visitBlockCopy(l),blocks=visitBlocks(data),position=q?blocks.findIndex(b=>b.questions.some(question=>questionKey(question)===questionKey(q)))+1:0;
 const terminal=Boolean(data.completion||data.visit.bookingStatus==='cancelled');
 const group=terminal?blocks.find(b=>b.id==='samples'):position?blocks[position-1]:null;
 const open=data.items.filter(item=>!item.mark?.done),pendingSamples=collectionCounts(data.items).pending;
 const early=new Date(Date.parse(data.visit.startsAt)+4*3600_000).toISOString().slice(0,10)>data.today;
 const rows:{key:string;at:string;node:ReactNode}[]=data.items.flatMap(item=>{
  const mark=item.mark;if(!mark||item.kind==='sample')return [];
  let words:string;
  if(mark.done&&mark.values&&'systolic'in mark.values)words=`${mark.values.systolic}/${mark.values.diastolic}${mark.values.pulse===null?'':`, ${t('pulse','զարկերակ','пульс')} ${mark.values.pulse}`}`;
  else if(mark.done&&mark.values)words=valueText(item,mark,l)??'';
  else words=`${mark.done?copy.done:copy.notDone}: ${itemTitle(item,l)}`;
  return [{key:item.key,at:mark.recordedAt,node:<><p className="cv2-time">{mark.nurseName}</p><p>{words}</p>{mark.note&&<p className="ncv2-body">{mark.note}</p>}</>}];
 });
 for(const step of data.steps){if(step.step==='completed')continue;rows.push({key:`step:${step.step}`,at:step.at,node:<><p className="cv2-time">{step.by}</p><p>{copy.stepButtons[step.step]}</p></>});}
 if(data.completion)rows.push({key:'completed',at:data.completion.completedAt,node:<><p>{copy.completionSummary(data)}</p>{data.completion.reason&&<p className="ncv2-body">{copy.reasonHeading}: {data.completion.reason}</p>}</>});
 const error=f.error===copy.changed?t('This visit changed. Open the visit again to check it.','Այցը փոխվել է։ Ստուգելու համար կրկին բացեք այցը։','Данные визита изменились. Откройте визит снова, чтобы проверить его.'):f.error===copy.completeFailed?t('The visit could not be completed. Open the visit again and check it.','Այցը չհաջողվեց ավարտել։ Կրկին բացեք այցը և ստուգեք։','Не удалось завершить визит. Откройте визит снова и проверьте его состояние.'):f.error;
 const briefing=reply(<><p data-visit-briefing>{visitBriefing(data,l)}</p>
   <p className="cv2-time">{block.baselineUnavailable}</p>
   <details data-visit-details open={detailsOpen} onToggle={event=>setDetailsOpen(event.currentTarget.open)}><summary aria-expanded={detailsOpen}>{block.details}</summary>
   <div data-visit-checklist><p>{copy.visitSteps}</p><ul className="ncv2-list">
    {blocks.filter(b=>b.id!=='finish').map(b=><li key={b.id} data-visit-block-status={b.id} data-done={b.questions.every(question=>!visitQuestionPending(data,question))}>{b.questions.every(question=>!visitQuestionPending(data,question))?copy.done:copy.todo}: {b.id==='arrival'?block.arrival:b.id==='bp'?copy.bpTitle:b.id==='body'?block.weightWaist:collectionCopy(l).title}</li>)}
    {data.steps.filter(step=>step.step!=='completed').map(step=><li key={step.step}><span>{copy.done}: {copy.stepButtons[step.step as keyof typeof copy.stepButtons]}</span><p className="cv2-time">{step.by} · {yerevanStamp(step.at,l)}</p></li>)}
    {data.items.filter(item=>item.kind!=='sample'||collectionStatus(item)!=='collected').map(item=><li key={item.key} data-checklist-item={item.key}>
     <span>{item.mark?.done&&<Check size={16} aria-hidden/>}{item.mark?.done?copy.done:item.mark?copy.notDone:copy.todo}: {briefingItemTitle(item,l)}</span>
     {item.mark&&<><p className="cv2-time">{item.mark.nurseName} · {yerevanStamp(item.mark.recordedAt,l)}</p>{item.mark.values&&<p>{valueText(item,item.mark,l)}</p>}{item.mark.note&&<p className="ncv2-body">{item.mark.note}</p>}</>}
    </li>)}
   </ul>{data.items.some(i=>i.kind==='sample')&&data.items.filter(i=>i.kind==='sample').every(i=>collectionStatus(i)==='collected')&&<p>{block.allCollected}</p>}{!f.preview&&!data.completion&&data.visit.bookingStatus!=='cancelled'&&data.items.some(i=>i.kind==='sample')&&chip(collectionCopy(l).title,()=>v.choose({kind:'collection'}))}</div>
   <details data-visit-baseline><summary>{block.baseline}</summary><ul className="ncv2-list">
    <li>{block.repeatedBp}<p>{data.items.some(i=>i.key==='measure:bp')?block.singleBp:block.missingItem}</p></li>
    <li>{block.weightWaist}{!['measure:weight','measure:waist'].every(key=>data.items.some(i=>i.key===key))&&<p>{block.missingItem}</p>}</li>
   </ul></details>
   <p><strong>{copy.careTeamHeading}</strong></p><p>{copy.careTeamBody}</p>{early&&!data.completion&&<p>{copy.onDay}</p>}</details></>);
 const actOn=(question:VisitQuestion,action:()=>void)=>{if(!q||questionKey(q)!==questionKey(question))v.choose(question);action();};
 const controls=(question:VisitQuestion)=>{
  if(question.kind!=='item')return null;
  const item=question.item,selected=q&&questionKey(q)===item.key;
  if(f.commenting)return selected?<><p>{copy.commentLabel}</p>{item.kind==='measurement'&&<p>{copy.commentHelp}</p>}{chip(copy.goBack,()=>v.cancelComment())}{chip(t('Continue without a comment','Շարունակել առանց մեկնաբանության','Продолжить без комментария'),()=>v.cancelComment(true))}</>:null;
  return <>
   {item.kind!=='measurement'&&(item.mark?.done?<>
    <p data-visit-done className="flex min-h-11 items-center gap-2"><Check size={16} aria-hidden/>{copy.done}</p>
    <button type="button" data-visit-undo className="ncv2-choice min-h-11 min-w-11 text-sm" aria-label={`${block.undo}: ${itemTitle(item,l)}`} disabled={v.frozen||f.commenting} onClick={()=>onAction(()=>actOn(question,()=>{void v.answer(false);} ))}>{block.undo}</button>
   </>:<button type="button" className="ncv2-tick" aria-pressed={false} disabled={v.frozen||f.commenting} onClick={()=>onAction(()=>actOn(question,()=>{void v.answer(true);} ))}><Check size={16} aria-hidden/>{item.kind==='device'?copy.deviceDone:copy.done}</button>)}
   {(item.kind==='measurement'||!item.mark?.done)&&chip(item.kind==='measurement'?copy.measurementNotTaken:copy.notDone,()=>actOn(question,()=>{void v.answer(false);}))}
   {chip(copy.addComment,()=>{if(!selected)v.choose(question);v.addComment(draft);})}
   {!item.mark&&chip(t('Skip for now','Առայժմ բաց թողնել','Пропустить пока'),()=>actOn(question,v.skip))}
  </>;
 };
 const pendingBpChecks=data.items.filter(item=>item.kind==='check'&&(item.section==='bp'||item.section==='safety')&&!item.mark&&!f.skipped.includes(item.key)).length;
 const itemRow=(question:VisitQuestion)=>{
  if(question.kind!=='item'||terminal)return null;
  const item=question.item;if(item.kind==='sample')return null;
  const draftKey=`${f.key}:${item.key}:${item.mark?.recordedAt??''}`;
  return <div key={item.key} data-visit-item={item.key} className="ncv2-group-item">
   <p><strong>{itemTitle(item,l)}</strong>{item.mark?.done&&<Check size={16} aria-hidden/>}</p>
   {item.kind==='measurement'?<VisitMeasurementBlock key={`${item.key}:${item.mark?.recordedAt??''}`} item={item} locale={l} pendingChecks={item.field==='bp'?pendingBpChecks:0} noteChanged={q?.kind==='item'&&q.item.key===item.key&&(f.comment??'').trim()!==(f.commentBaseline??'').trim()} draft={readingDrafts[draftKey]} onDraft={fields=>setReadingDrafts(previous=>({...previous,[draftKey]:fields}))} disabled={v.frozen||f.commenting} onNext={words=>onAction(()=>actOn(question,()=>{void v.answer(true,words);}))}/>:<p className="cv2-time">{itemDetail(item,l)}</p>}
   {item.mark?.note&&<p className="ncv2-body">{item.mark.note}</p>}{controls(question)}
  </div>;
 };
 const groupTitle=group?.id==='arrival'?block.arrival:group?.id==='bp'?copy.bpTitle:group?.id==='body'?block.weightWaist:group?.id==='samples'?collectionCopy(l).title:copy.completeLabel;
 const protocolSection=(section:'bp'|'safety'|'sampling')=>{
  const questions=group?.questions.filter((question):question is Extract<VisitQuestion,{kind:'item'}>=>question.kind==='item'&&question.item.kind==='check'&&question.item.section===section)??[];
  if(!questions.length||terminal)return null;
  return <div data-visit-all-done-section={section} key={section}>
   {questions.map(itemRow)}
   {questions.some(question=>!question.item.mark)&&<button type="button" className="ncv2-choice" disabled={v.frozen||f.commenting||f.comment.trim()!==f.commentBaseline.trim()||early} onClick={()=>onAction(()=>{void v.allDone(section);})}>{block.allDone}</button>}
  </div>;
 };
 return <>
  {!f.briefingLast&&briefing}
  {rows.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.key.localeCompare(b.key)).map(row=><article key={row.key} data-visit-answer={row.key} className="cv2-msg cv2-me"><div className="cv2-say"><p className="cv2-time">{yerevanStamp(row.at,l)}</p>{row.node}</div></article>)}
  {f.briefingLast&&briefing}
  {f.preview&&reply(<VisitShortcutCard data={data} draft={f.preview} locale={l} disabled={v.frozen} onChange={v.editPreview} onCancel={v.discardPreview} onConfirm={()=>{void v.confirmPreview();}}/>,'preview')}
  {!f.preview&&q&&position>0&&<div data-visit-progress className="ncv2-visit-progress"><p>{block.progress(position,blocks.length)}</p><Progress value={position} min={0} max={blocks.length} size="sm" aria-label={block.progress(position,blocks.length)}/></div>}
  {!f.preview&&(f.view==='change'?reply(<><p>{t('Change an answer','Փոխել պատասխանը','Изменить ответ')}</p>{data.items.filter(item=>item.kind!=='sample').map(item=>chip(itemTitle(item,l),()=>v.choose({kind:'item',item}),item.key))}{data.items.some(i=>i.kind==='sample')&&<details className="ncv2-protocol-details"><summary>{collectionCopy(l).title}</summary><NurseSampleCollection data={data} locale={l} disabled={v.frozen} collect={v.collect} reload={v.refresh}/></details>}{chip(copy.goBack,()=>v.view('question'))}</>,'change'):
   f.view==='complete'?reply(<><p><strong>{copy.completeQuestion}</strong></p><p>{copy.completeExplanation}</p>{pendingSamples?<p role="status">{collectionCopy(l).pending}</p>:open.length?<><p>{copy.incompleteCount(open.length)}</p><ul>{open.map(item=><li key={item.key}>{itemTitle(item,l)}</li>)}</ul><p>{copy.reasonLabel}</p></>:<><p>{copy.allDone}</p>{chip(copy.completeLabel,()=>{void v.complete();})}</>}{chip(copy.goBack,()=>v.view('question'))}</>,'complete'):
   (q||terminal)&&group&&reply(<section data-visit-group={group.id}><p><strong>{groupTitle}</strong></p>
    {q?.kind==='finish'?<><p>{open.length?copy.counts(open.length):copy.allItemsDone}</p>{data.items.filter(item=>item.kind!=='sample'&&(!item.mark?.done||f.skipped.includes(item.key))).map(item=>chip(itemTitle(item,l),()=>v.choose({kind:'item',item}),item.key))}{f.skipped.filter(key=>key.startsWith('step:')).map(key=>{const step=key.slice(5) as keyof typeof copy.stepButtons;return data.steps.some(entry=>entry.step===step)?null:chip(copy.stepButtons[step],()=>v.choose({kind:'step',step}),key);})}{chip(t('Change an answer','Փոխել պատասխանը','Изменить ответ'),()=>v.view('change'))}{chip(copy.completeLabel,()=>v.view('complete'))}</>:
     <>
      {(['bp','safety','sampling'] as const).map(protocolSection)}
      {group.questions.filter(question=>!(question.kind==='item'&&question.item.kind==='check')).map(question=>question.kind==='item'?itemRow(question):null)}
      {group.id==='samples'&&<NurseSampleCollection data={data} locale={l} disabled={v.frozen||f.commenting} collect={v.collect} reload={v.refresh} remainingOnly/>}
      {group.questions.filter((question):question is Extract<VisitQuestion,{kind:'step'}>=>question.kind==='step'&&(data.steps.some(s=>s.step===question.step)||visitQuestionPending(data,question))&&data.visit.bookingStatus!=='cancelled'&&(!early||question.step==='confirmed')).map(question=><div key={question.step} className="ncv2-group-item">{data.steps.some(step=>step.step===question.step)?<p><Check size={16} aria-hidden/>{copy.stepButtons[question.step]}</p>:<><button type="button" className="ncv2-choice" disabled={v.frozen||question.step==='samples-collected'&&(pendingSamples>0||!data.items.some(i=>i.kind==='sample'&&collectionStatus(i)==='collected'))||question.step==='samples-at-lab'&&!data.steps.some(s=>s.step==='samples-collected')} onClick={()=>onAction(()=>actOn(question,()=>{void v.answer(true);}))}>{copy.stepButtons[question.step]}</button>{chip(t('Skip for now','Առայժմ բաց թողնել','Пропустить пока'),()=>actOn(question,v.skip),`skip:${question.step}`)}</>}</div>)}
      {group.id==='samples'&&q?.kind==='collection'&&pendingSamples===0&&chip(block.next,()=>v.view('question'))}
     </>}
    {f.editing?.kind==='item'&&chip(copy.goBack,()=>v.view('question'),'back-from-item')}
   </section>,q?questionKey(q):undefined))}
  {(v.sending||error)&&reply(<><p role="status">{v.sending?copy.saving:error}</p>{(v.uncertain||f.allDonePartial)&&chip(retry,()=>{void v.retry();},'retry',true)}{!v.frozen&&!f.allDonePartial&&error&&!(draft&&q?.kind==='item'&&q.item.kind==='measurement')&&chip(retry,()=>{void v.refresh();})}</>)}
 </>;
}
