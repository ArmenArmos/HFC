import {staffDisplayText} from '@/lib/staff/display-text';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {taskStatusLabel} from '@/lib/staff/real-coordination/status-copy';
import {taskTitle,availableTaskOperations,taskOperationLabel,contactOutcomeChoices,contactOutcomeLabel,type ContactOutcome,type TaskOperation,type NurseTaskOperation} from '@/lib/staff/real-coordination/task-copy';
import type {CoordinationTask,CoordinationSnapshot,CoordinationTaskPage} from '@/lib/staff/real-coordination/schema';

export const taskFilters=['active','open','awaiting-member','awaiting-doctor','completed','cancelled','reassign'] as const;
export type TaskFilter=typeof taskFilters[number];
export function taskFilterLabel(l:StaffLocale,filter:TaskFilter){
 return filter==='active'?st(l,'Active','Ակտիվ','Активные'):filter==='reassign'?st(l,'Needs reassignment','Պահանջում է վերանշանակում','Требуется переназначение'):taskStatusLabel(l,filter);
}
type TaskProps={locale:StaffLocale;disabled:boolean;onDetails:(task:CoordinationTask)=>void;onOperation:(task:CoordinationTask,operation:NurseTaskOperation)=>void};
export function NurseTaskCard({task,locale:l,disabled,onDetails,onOperation}:TaskProps&{task:CoordinationTask}){
 return <div data-task-card={task.id}>
  <button type="button" className="ncv2-choice" disabled={disabled} onClick={()=>onDetails(task)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{taskTitle(task,l)}</button>
  <p className="cv2-time">{task.memberName} · {taskStatusLabel(l,task.status)}{task.dueAt&&<> · {yerevanStamp(task.dueAt,l)}</>}</p>
  <div className="ncv2-topics">{availableTaskOperations(task).map(operation=><button key={operation} type="button" className="ncv2-choice" disabled={disabled} onClick={()=>onOperation(task,operation)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{operation==='complete'?st(l,'Mark done','Նշել ավարտված','Отметить выполненной'):taskOperationLabel(l,operation)}</button>)}</div>
 </div>;
}
export function NurseTaskList({page,filter,locale:l,onFilter,onMore,...props}:TaskProps&{page:CoordinationTaskPage;filter:TaskFilter;onFilter:(filter:TaskFilter)=>void;onMore:()=>void}){
 return <section data-task-list><p><strong>{st(l,'Coordination tasks','Համակարգման առաջադրանքներ','Задачи координации')}</strong></p>
  <div className="ncv2-topics">{taskFilters.map(value=><button key={value} type="button" className="ncv2-choice" disabled={props.disabled} aria-pressed={filter===value} onClick={()=>onFilter(value)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{taskFilterLabel(l,value)}</button>)}</div>
  {page.tasks.length?<ul className="ncv2-list">{page.tasks.map(task=><li key={task.id}><NurseTaskCard {...props} locale={l} task={task}/></li>)}</ul>:<p>{st(l,'No tasks in this view.','Այս տեսքում առաջադրանքներ չկան։','В этом списке нет задач.')}</p>}
  {page.nextCursor&&<button type="button" className="ncv2-choice" disabled={props.disabled} onClick={onMore} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{st(l,'Load more tasks','Բեռնել ավելի շատ առաջադրանքներ','Загрузить ещё задачи')}</button>}
 </section>;
}
export function NurseTaskDetails({snapshot,locale:l,...props}:TaskProps&{snapshot:CoordinationSnapshot}){
 return <section data-task-details={snapshot.id}><NurseTaskCard {...props} task={snapshot} locale={l}/><p className="ncv2-body">{staffDisplayText(snapshot.instructions,l,true)}</p><p>{snapshot.ownerName}{snapshot.dueAt&&<> · {yerevanStamp(snapshot.dueAt,l)}</>}</p>
  <p><strong>{st(l,'Task history','Առաջադրանքի պատմություն','История задачи')}</strong></p>
  <ol className="ncv2-list">{[...snapshot.events].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id).map(event=><li key={event.id}><p>{event.operation==='contact'&&typeof event.detail.input.outcome==='string'?(contactOutcomeChoices.includes(event.detail.input.outcome as ContactOutcome)?contactOutcomeLabel(l,event.detail.input.outcome as ContactOutcome):undefined)||st(l,'Contact recorded','Կապը գրանցված է','Контакт записан'):taskOperationLabel(l,event.operation as TaskOperation)||event.operation} · {taskStatusLabel(l,event.new_status)||event.new_status}</p>{event.note&&<p className="ncv2-body">{staffDisplayText(event.note,l,true)}</p>}<p className="cv2-time">{event.actor_role==='system'?st(l,`Care team change, approved by ${event.actor_name}`,`Խնամքի թիմի փոփոխություն, հաստատել է ${event.actor_name}`,`Изменение команды заботы, одобрено: ${event.actor_name}`):<>{event.actor_name} · {{admin:st(l,'Administrator','Ադմինիստրատոր','Администратор'),doctor:st(l,'Doctor','Բժիշկ','Врач'),nurse:st(l,'Nurse','Բուժքույր','Медсестра')}[event.actor_role]??event.actor_role}</>} · {yerevanStamp(event.created_at,l)}</p></li>)}</ol>
 </section>;
}
