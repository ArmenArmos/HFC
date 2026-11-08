'use client';
import {staffDisplayText} from '@/lib/staff/display-text';
import Link from 'next/link';
import {ArrowRight,UserRound} from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import {useRecordRefresh} from '@/components/staff/record-refresh';
import { coordinationCommand, refreshCoordinationTask, readCoordinationPage, searchCoordinationMembers } from '@/lib/staff/real-coordination/actions';
import { taskKinds, type CoordinationActor, type CoordinationTask, type CoordinationSnapshot, type CoordinationMember, type CoordinationCommand, type CoordinationTaskPage, type CoordinationMemberPage } from '@/lib/staff/real-coordination/schema';
import { stamp } from '@/components/patient-care/common';
import { buttonClass, fieldClass } from './shell';
import {SelectField} from '@/components/ui/select-field';
import {staffServerText} from '@/lib/staff/staff-server-copy';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {pick} from '@/lib/locale';
import {taskTitle,taskNoteLabel,taskUncertainText,taskOperationLabel as opLabel,contactOutcomeChoices,contactOutcomeLabel,contactOutcomeFieldLabel,type TaskOperation as Operation,type ContactOutcome} from '@/lib/staff/real-coordination/task-copy';
import {taskStatusLabel as statusLabel} from '@/lib/staff/real-coordination/status-copy';
export type CoordinationActions={coordinationCommand:typeof coordinationCommand;refreshCoordinationTask:typeof refreshCoordinationTask;readCoordinationPage:typeof readCoordinationPage;searchCoordinationMembers:typeof searchCoordinationMembers};
const pageActions:CoordinationActions={coordinationCommand,refreshCoordinationTask,readCoordinationPage,searchCoordinationMembers};
const kindsHy: Record<CoordinationTask['kind'], string> = { 'contact-followup': 'Կապի հետագա հսկողություն', 'evidence-collection': 'Տվյալների հավաքում', 'booking-coordination': 'Ամրագրման համակարգում', 'doctor-referral': 'Ուղղորդում բժշկին' };
const kindsRu: Record<CoordinationTask['kind'],string> = {"contact-followup": "Последующая связь", "evidence-collection": "Сбор данных", "booking-coordination": "Координация записи на визит", "doctor-referral": "Направление к врачу"};
const kindLabel = (l: StaffLocale, kind: CoordinationTask['kind']) => pick(l,{en:taskKinds,hy:kindsHy,ru:kindsRu})[kind];
function details(data: FormData) { const due = String(data.get('dueAt') || ''); return { title: String(data.get('title') || ''), instructions: String(data.get('instructions') || ''), dueAt: due ? new Date(`${due}+04:00`).toISOString() : null }; }
function localDate(value: string | null) { return value ? new Date(Date.parse(value) + 4 * 60 * 60 * 1000).toISOString().slice(0, 16) : ''; }
function OwnerField({ member, referral = false, value, onValueChange, l }: {
    l: StaffLocale;
    member?: CoordinationMember;
    referral?: boolean;
    value?: string;
    onValueChange?:(value:string)=>void;
}) { const owners=member?.owners.filter(owner=>!referral||owner.role==='doctor')||[];return <label className="block space-y-1 text-body2">{st(l,'Owner','Պատասխանատու',"Ответственный")}{!owners.length&&<span className="block text-caption text-muted-foreground">{st(l,'No eligible owner. Assign an active doctor or nurse to this member first.','Համապատասխան պատասխանատու չկա։ Նախ այս անդամին կցեք ակտիվ բժիշկ կամ բուժքույր։',"Нет подходящего ответственного. Сначала назначьте участнику действующего врача или медсестру.")}</span>}<SelectField name="ownerId" defaultValue={value} value={onValueChange?value:undefined} onValueChange={onValueChange} required placeholder={owners.length?undefined:st(l,'No eligible owner','Համապատասխան պատասխանատու չկա',"Нет подходящего ответственного")} options={owners.map(owner => ({value:owner.id,label:owner.name,description:owner.role==='doctor'?st(l,'Doctor','Բժիշկ','Врач'):st(l,'Nurse','Բուժքույր','Медсестра')}))}/></label>; }
function DetailFields({ task, l }: {
    task?: CoordinationTask;
    l: StaffLocale;
}) { return <><label className="block space-y-1 text-body2">{st(l,'Title','Վերնագիր',"Название")}<input name="title" defaultValue={task?.title} maxLength={160} required className={fieldClass}/></label><label className="block space-y-1 text-body2">{st(l,'Operational instructions','Գործառնական ցուցումներ',"Организационные инструкции")}<textarea name="instructions" defaultValue={task?.instructions} maxLength={2000} rows={3} required className={fieldClass}/></label><label className="block space-y-1 text-body2">{st(l,'Due at, Armenia time (optional)','Ժամկետը, Հայաստանի ժամանակով (ըստ ցանկության)',"Срок по времени Армении (необязательно)")}<input name="dueAt" type="datetime-local" defaultValue={localDate(task?.dueAt || null)} className={fieldClass}/></label></>; }
function CreateTask({ memberPage, caseId, onChanged, l, actions=pageActions }: {
    actions?:CoordinationActions;
    l: StaffLocale;
    memberPage: CoordinationMemberPage;
    caseId?: string;
    onChanged:(task:CoordinationTask, recorded?:boolean)=>void;
}) {
    const {coordinationCommand,refreshCoordinationTask,searchCoordinationMembers}=actions;
    const refresh = useRecordRefresh();
    const [memberId, setMemberId] = useState(caseId || '');
    const [members,setMembers]=useState(memberPage.members);
    const [memberCursor,setMemberCursor]=useState(memberPage.nextCursor);
    const [memberSource,setMemberSource]=useState(memberPage);
    const [ownerId,setOwnerId]=useState('');
    const [search,setSearch]=useState('');
    const [searched,setSearched]=useState('');
    const [kind, setKind] = useState<CoordinationTask['kind']>('contact-followup');
    const [message, setMessage] = useState('');
    const [pending, start] = useTransition();
    const busy = useRef(false);
    const identity = useRef({ taskId: crypto.randomUUID(), requestId: crypto.randomUUID() });
    const [uncertain, setUncertain] = useState<CoordinationCommand | null>(null);
    // Refresh directory data without resetting draft fields or request identity.
    if(memberSource!==memberPage){
        setMemberSource(memberPage);
        setMembers(memberPage.members);
        setMemberCursor(memberPage.nextCursor);
        setSearched('');
    }
    const selectedMember=members.find(member=>member.id===memberId);
    if(ownerId&&!selectedMember?.owners.some(owner=>owner.id===ownerId&&(kind!=='doctor-referral'||owner.role==='doctor')))setOwnerId('');
    function findMembers(more=false){if(busy.current||uncertain)return;busy.current=true;start(async()=>{try{const query=more?searched:search;const result=await searchCoordinationMembers({search:query,cursor:more?memberCursor:null});if(!result.ok){setMessage(staffServerText(l,result.error));return;}setMembers(previous=>more?[...previous,...result.page.members]:result.page.members);setMemberCursor(result.page.nextCursor);setSearched(query);if(!more)setMemberId('');setMessage(result.page.members.length?st(l,'Choose a member from the search results.','Ընտրեք անդամին որոնման արդյունքներից։',"Выберите участника из результатов поиска."):st(l,'No assigned members match this search.','Այս որոնմանը համապատասխանող կցված անդամներ չկան։',"Среди назначенных участников нет совпадений."));}catch{setMessage(st(l,'Assigned members could not load. Try again.','Կցված անդամներին չհաջողվեց բեռնել։ Կրկին փորձեք։',"Не удалось загрузить назначенных участников. Попробуйте снова."));}finally{busy.current=false;}});}
    return <details className="rounded-lg border bg-card p-4"><summary className="min-h-11 cursor-pointer text-body2 font-medium">{st(l,'Create an operational task','Ստեղծել գործառնական առաջադրանք',"Создать организационную задачу")}</summary><form className="mt-3 max-w-xl space-y-3" onSubmit={event => { event.preventDefault(); if (busy.current)
        return; const form = event.currentTarget; const data = new FormData(form); let command: unknown; try {
        command = uncertain || { caseId: memberId, ...identity.current, revision: 0, operation: 'create', input: { kind, ...details(data), ownerId: String(data.get('ownerId') || '') } };
    }
    catch {
        setMessage(st(l,'Check the due time.','Ստուգեք ժամկետը։',"Проверьте срок."));
        return;
    } busy.current = true; start(async () => { try {
        const result = await coordinationCommand(command);
        if (!result.ok) {
            if (result.uncertain)
                setUncertain(command as CoordinationCommand);
            setMessage(staffServerText(l,result.error));
            return;
        }
        form.reset();
        setOwnerId('');
        setUncertain(null);
        identity.current = { taskId: crypto.randomUUID(), requestId: crypto.randomUUID() };
        setMessage(st(l,'Task created.','Առաջադրանքը ստեղծված է։',"Задача создана."));
        const fresh=await refreshCoordinationTask(result.id);if(fresh.ok)onChanged(fresh.task,true);
        refresh();
    }
    catch {
        setUncertain(command as CoordinationCommand);
        setMessage(st(l,'The result could not be confirmed. Confirm the same request before creating another task.','Արդյունքը չհաջողվեց հաստատել։ Նոր առաջադրանք ստեղծելուց առաջ հաստատեք նույն հարցումը։',"Не удалось подтвердить результат. Подтвердите тот же запрос, прежде чем создавать следующую задачу."));
    }
    finally {
        busy.current = false;
    } }); }}>
 <fieldset disabled={pending || !!uncertain} className="space-y-3">{!caseId&&<div className="space-y-2"><label className="block space-y-1 text-body2">{st(l,'Find an assigned member','Գտնել կցված անդամին',"Найти назначенного участника")}<input value={search} onChange={event=>setSearch(event.target.value)} maxLength={100} className={fieldClass}/></label><button type="button" onClick={()=>findMembers()} className="min-h-11 rounded-md border px-4 text-body2">{st(l,'Search members','Որոնել անդամներին',"Найти участников")}</button>{memberCursor&&<button type="button" onClick={()=>findMembers(true)} className="ml-2 min-h-11 rounded-md border px-4 text-body2">{st(l,'Load more members','Բեռնել ավելի շատ անդամներ',"Загрузить ещё участников")}</button>}</div>}<label className="block space-y-1 text-body2">{st(l,'Member','Անդամ',"Участник")}<SelectField value={memberId} onValueChange={setMemberId} required options={[{value:'',label:st(l,'Choose a member','Ընտրեք անդամին',"Выберите участника")},...members.map(member => ({value:member.id,label:member.name || st(l,'Member','Անդամ',"Участник")}))]}/></label><label className="block space-y-1 text-body2">{st(l,'Task kind','Առաջադրանքի տեսակ',"Тип задачи")}<SelectField value={kind} onValueChange={next => setKind(next as CoordinationTask['kind'])} options={Object.keys(taskKinds).map(value => ({value,label:kindLabel(l,value as CoordinationTask['kind'])}))}/></label><DetailFields l={l}/><OwnerField l={l} value={ownerId} onValueChange={setOwnerId} member={selectedMember} referral={kind === 'doctor-referral'}/></fieldset>
 <button disabled={pending || !memberId} className={buttonClass} aria-busy={pending}>{pending ? st(l,'Creating task…','Առաջադրանքը ստեղծվում է…',"Создание задачи…") : uncertain ? st(l,'Confirm previous task request','Հաստատել նախորդ առաջադրանքի հարցումը',"Подтвердить предыдущий запрос задачи") : st(l,'Create task','Ստեղծել առաջադրանք',"Создать задачу")}</button>{message && <p role="status" className="text-body2">{message}</p>}
 </form></details>;
}
export function TaskRow({ initial, actor, onChanged, l, memberHref, actions=pageActions }: {
    memberHref?:`/staff/real/nurse-chat?member=${string}`;
    actions?:CoordinationActions;
    l: StaffLocale;
    initial: CoordinationTask;
    actor: CoordinationActor;
    onChanged:(task:CoordinationTask, recorded?:boolean)=>void;
}) {
    const {coordinationCommand,refreshCoordinationTask}=actions;
    const refresh = useRecordRefresh();
    const [snapshot, setSnapshot] = useState<CoordinationSnapshot | null>(null);
    const [snapshotSource,setSnapshotSource]=useState(initial);
    const base = snapshot && snapshot.revision >= initial.revision ? snapshot : initial;
    const authority = snapshot && snapshotSource===initial ? snapshot : initial;
    const needsOwner = !['completed','cancelled'].includes(base.status) && !authority.eligibleOwners.some(owner=>owner.id===base.ownerId && (base.kind!=='doctor-referral'||owner.role==='doctor'));
    const task={...base,memberName:authority.memberName,eligibleOwners:authority.eligibleOwners,needsReassignment:needsOwner,ownerName:authority.eligibleOwners.find(owner=>owner.id===base.ownerId)?.name||(base.ownerId===initial.ownerId?initial.ownerName:base.ownerName)};
    const currentOwners:CoordinationMember={id:task.caseId,name:task.memberName,owners:task.eligibleOwners};
    const [expanded, setExpanded] = useState(false);
    const [operation, setOperation] = useState<Operation>('contact');
    const [notes,setNotes]=useState<Partial<Record<Operation,string>>>({});
    const [message, setMessage] = useState('');
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const [pending, start] = useTransition();
    const busy = useRef(false);
    const [uncertain, setUncertain] = useState<CoordinationCommand | null>(null);
    const request = useRef(crypto.randomUUID());
    const requiredRevision = useRef(0);
    const pendingForm = useRef<HTMLFormElement | null>(null);
    const terminal = ['completed', 'cancelled'].includes(task.status);
    const manager = actor.role === 'admin' || actor.role === 'doctor';
    const referral = task.kind === 'doctor-referral';
    const ops: Operation[] = [];
    // A care coordinator reads tasks and acts on none of them (patient_coordination_command refuses them).
    if (!terminal && actor.role !== 'coordinator') {
        if (manager) {
            if (!task.needsReassignment)
                ops.push('edit');
            ops.push('reassign', 'cancel');
        }
        else if (actor.id === task.creatorId && !task.needsReassignment && !referral)
            ops.push('cancel');
        if (!task.needsReassignment) {
            if (actor.role !== 'admin')
                ops.push('contact');
            if (!referral)
                ops.push(task.status === 'open' ? 'await-member' : 'reopen', 'complete');
            else if (task.status === 'open' && actor.role !== 'admin')
                ops.push('refer');
            else if (task.status === 'awaiting-doctor' && actor.role === 'doctor')
                ops.push('resolve');
        }
    }
    const selected = ops.includes(operation) ? operation : ops[0];
    async function load() { const result = await refreshCoordinationTask(task.id); if (!result.ok) {
        setNeedsRefresh(true);
        setMessage(staffServerText(l,result.error));
        return;
    } if (result.task.revision < requiredRevision.current) { setNeedsRefresh(true); setMessage(st(l,"Saved. The updated task has not loaded yet. Refresh before recording another change.",'Պահպանված է։ Թարմացված առաջադրանքը դեռ չի բեռնվել։ Նոր փոփոխություն գրանցելուց առաջ թարմացրեք։',"Сохранено. Обновлённая задача ещё не загрузилась. Обновите её перед записью следующего изменения.")); return; }
    requiredRevision.current = 0; setSnapshot(result.task); setSnapshotSource(initial); setNeedsRefresh(false); if (uncertain && result.task.events.some(event => event.request_id === uncertain?.requestId)) {
        setUncertain(null);
        pendingForm.current?.reset(); pendingForm.current = null;
        const recordedOperation=uncertain.operation;setNotes(previous=>({...previous,[recordedOperation]:''}));
        request.current = crypto.randomUUID();
        setMessage(st(l,'Your previous change is recorded in task history.','Ձեր նախորդ փոփոխությունը գրանցված է առաջադրանքի պատմության մեջ։',"Ваше предыдущее изменение записано в истории задачи."));
    }
    else
        setMessage(st(l,'Current task loaded. Review the history before recording another change.','Ընթացիկ առաջադրանքը բեռնված է։ Նոր փոփոխություն գրանցելուց առաջ ստուգեք պատմությունը։',"Текущая задача загружена. Просмотрите историю перед записью следующего изменения."));
    return result.task; }
    function run(form: HTMLFormElement) { if (busy.current || needsRefresh || !selected)
        return; const data = new FormData(form); let input: Record<string, unknown> = {}; try {
        if (selected === 'edit')
            input = details(data);
        else if (selected === 'reassign')
            input = { ownerId: String(data.get('ownerId') || '') };
        else if (selected === 'contact')
            input = { outcome: String(data.get('outcome') || ''), note: String(data.get('note') || '') };
        else if (!['await-member', 'reopen'].includes(selected))
            input = { note: String(data.get('note') || '') };
    }
    catch {
        setMessage(st(l,'Check the due time.','Ստուգեք ժամկետը։',"Проверьте срок."));
        return;
    } const command = uncertain || { caseId: task.caseId, taskId: task.id, revision: task.revision, requestId: request.current, operation: selected, input } as CoordinationCommand; busy.current = true; pendingForm.current = form; setMessage(''); start(async () => { try {
        const result = await coordinationCommand(command);
        if (!result.ok) {
            setNeedsRefresh(!result.error.startsWith('Check'));
            if (result.uncertain)
                setUncertain(command);
            else {
                setUncertain(null);
                request.current = crypto.randomUUID();
            }
            setMessage(staffServerText(l,result.error));
            return;
        }
        form.reset();setNotes(previous=>({...previous,[command.operation]:''})); pendingForm.current = null; requiredRevision.current = result.revision;
        request.current = crypto.randomUUID();
        setUncertain(null);
        setNeedsRefresh(true);
        setMessage(st(l,'Recorded. Loading the current task…','Գրանցված է։ Ընթացիկ առաջադրանքը բեռնվում է…',"Записано. Загрузка текущей задачи…"));
        const updated=await load();
        if(updated)onChanged(updated,true);refresh();
    }
    catch {
        setUncertain(command);
        setNeedsRefresh(true);
        setMessage(taskUncertainText(l));
    }
    finally {
        busy.current = false;
    } }); }
    return <li className="border-b last:border-b-0"><div className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(9rem,14rem)_auto] md:items-center"><div className="min-w-0"><p className="break-words text-body2 font-medium">{taskTitle(task,l)}</p><p className="break-words text-caption text-muted-foreground">{task.memberName || st(l,'Member','Անդամ',"Участник")} · {kindLabel(l,task.kind)}</p><Link href={memberHref??`/staff/real/members/${task.caseId}`} aria-label={pick(l,{en:`Open member ${task.memberName || 'Member'}`,hy:`Բացել անդամին՝ ${task.memberName || 'Անդամ'}`,ru:`Открыть участника ${task.memberName || 'Участник'}`})} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-body2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><UserRound className="size-4" aria-hidden/>{st(l,'Open member','Բացել անդամին',"Открыть участника")}<ArrowRight className="size-4" aria-hidden/></Link></div><div className="min-w-0 space-y-1"><p className="text-body2">{task.needsReassignment ? st(l,'Needs reassignment','Պահանջում է վերանշանակում',"Требуется переназначение") : statusLabel(l,task.status)}</p><p className="break-words text-caption text-muted-foreground">{task.ownerName}{task.dueAt ? ` · ${st(l,'Due','Ժամկետը՝',"Срок")} ${stamp(task.dueAt, l)}` : ''}</p></div><button type="button" aria-label={`${st(l,'Open','Բացել',"Открыть")} ${taskTitle(task,l)}`} aria-expanded={expanded} onClick={() => { setExpanded(value => !value); if (!expanded && !snapshot && !busy.current) {
        busy.current = true;
        start(async () => { try {
            const updated=await load();if(updated)onChanged(updated);
        }
        catch {
            setNeedsRefresh(true);
            setMessage(st(l,'Current task could not load. Check your access and try again.','Ընթացիկ առաջադրանքը չհաջողվեց բեռնել։ Ստուգեք Ձեր հասանելիությունը և կրկին փորձեք։',"Не удалось загрузить текущую задачу. Проверьте доступ и попробуйте снова."));
        }
        finally {
            busy.current = false;
        } });
    } }} className="min-h-11 rounded-md border px-4 text-body2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">{expanded ? st(l,'Close task','Փակել առաջադրանքը',"Закрыть задачу") : st(l,'Open task','Բացել առաջադրանքը',"Открыть задачу")}</button></div>
 {expanded && <div className="space-y-4 border-t bg-muted/20 p-4"><p className="max-w-2xl whitespace-pre-wrap text-body2">{staffDisplayText(task.instructions,l,true)}</p>{task.needsReassignment && <p role="status" className="text-body2">{st(l,'The owner is no longer eligible for this case. An administrator or assigned doctor can choose a current owner or cancel obsolete work with a reason.','Պատասխանատուն այլևս իրավասու չէ այս դեպքի համար։ Ադմինիստրատորը կամ կցված բժիշկը կարող է ընտրել ընթացիկ պատասխանատու կամ պատճառը նշելով չեղարկել հնացած աշխատանքը։',"Ответственный больше не имеет доступа к этому случаю. Администратор или назначенный врач может выбрать нового ответственного или отменить неактуальную задачу, указав причину.")}</p>}
 {Object.entries(notes).some(([op,value])=>!!value&&op!==selected)&&<details><summary className="min-h-11 cursor-pointer text-body2">{st(l,'Your unsaved entries are retained','Ձեր չպահպանված մուտքագրածը պահված է',"Ваши несохранённые данные сохранены в форме")}</summary>{Object.entries(notes).filter(([op,value])=>!!value&&op!==selected).map(([op,value])=><p key={op} className="whitespace-pre-wrap text-body2">{opLabel(l,op as Operation)}: {value}</p>)}</details>}
 {!!ops.length && <form className="max-w-xl space-y-3" onSubmit={event => { event.preventDefault(); run(event.currentTarget); }}><fieldset disabled={pending || needsRefresh || !!uncertain} className="space-y-3"><label className="block space-y-1 text-body2">{st(l,'Task action','Առաջադրանքի գործողություն',"Действие с задачей")}<SelectField aria-label={st(l,'Task action','Առաջադրանքի գործողություն','Действие с задачей')} value={selected} onValueChange={next => setOperation(next as Operation)} options={ops.map(op => ({value:op,label:opLabel(l,op)}))}/></label>{selected === 'edit' ? <DetailFields key={task.revision} task={task} l={l}/> : selected === 'reassign' ? <OwnerField l={l} member={currentOwners} referral={referral} value={task.ownerId}/> : selected === 'contact' ? <><label className="block space-y-1 text-body2">{contactOutcomeFieldLabel(l)}<SelectField name="outcome" options={contactOutcomeChoices.map(value=>({value,label:contactOutcomeLabel(l,value)}))}/></label><label className="block space-y-1 text-body2">{taskNoteLabel(l,'contact')}<textarea name="note" value={notes[selected]||''} onChange={event=>setNotes(previous=>({...previous,[selected]:event.target.value}))} maxLength={2000} required rows={3} className={fieldClass}/></label></> : !['await-member', 'reopen'].includes(selected) ? <label className="block space-y-1 text-body2">{taskNoteLabel(l,selected)}<textarea name="note" value={notes[selected]||''} onChange={event=>setNotes(previous=>({...previous,[selected]:event.target.value}))} maxLength={2000} required rows={3} className={fieldClass}/></label> : null}</fieldset><button disabled={pending || needsRefresh} className={buttonClass} aria-busy={pending}>{pending ? st(l,'Recording change…','Փոփոխությունը գրանցվում է…',"Запись изменения…") : uncertain ? st(l,'Confirm previous task request','Հաստատել նախորդ առաջադրանքի հարցումը',"Подтвердить предыдущий запрос задачи") : opLabel(l,selected)}</button></form>}
 <button type="button" aria-label={`${st(l,'Refresh','Թարմացնել',"Обновить")} ${taskTitle(task,l)}`} disabled={pending} className="min-h-11 rounded-md border px-4 text-body2" onClick={() => { if (busy.current)
            return; busy.current = true; start(async () => { try {
            const updated=await load();if(updated)onChanged(updated);
        }
        catch {
            setNeedsRefresh(true);
            setMessage(st(l,'Current task could not load. Your entries are retained.','Ընթացիկ առաջադրանքը չհաջողվեց բեռնել։ Ձեր մուտքագրածը պահված է։',"Не удалось загрузить текущую задачу. Введённые данные сохранены."));
        }
        finally {
            busy.current = false;
        } }); }}>{st(l,'Refresh task history','Թարմացնել առաջադրանքի պատմությունը',"Обновить историю задачи")}</button>{message && <p role="status" className="text-body2">{message}</p>}
 <details><summary className="min-h-11 cursor-pointer text-body2">{st(l,'Task history','Առաջադրանքի պատմություն',"История задачи")}{snapshot ? ` (${snapshot.events.length})` : ''}</summary>{snapshot?.events.length ? <ol className="divide-y">{snapshot.events.map(event => <li key={event.id} className="space-y-1 py-3"><p className="text-body2 font-medium">{event.operation === 'contact' && typeof event.detail.input.outcome === 'string' ? (contactOutcomeChoices.includes(event.detail.input.outcome as ContactOutcome) ? contactOutcomeLabel(l,event.detail.input.outcome as ContactOutcome) : undefined) || st(l,'Contact recorded','Կապը գրանցված է',"Контакт записан") : opLabel(l,event.operation as Operation) || event.operation} · {statusLabel(l,event.new_status) || event.new_status}</p>{event.note && <p className="whitespace-pre-wrap text-body2">{event.note}</p>}<p className="text-caption text-muted-foreground">{event.actor_role==='system'?st(l,`Care team change, approved by ${event.actor_name}`,`Խնամքի թիմի փոփոխություն, հաստատել է ${event.actor_name}`,`Изменение команды заботы, одобрено: ${event.actor_name}`):<>{event.actor_name} · {{admin:st(l,'Administrator','Ադմինիստրատոր','Администратор'),doctor:st(l,'Doctor','Բժիշկ','Врач'),nurse:st(l,'Nurse','Բուժքույր','Медсестра')}[event.actor_role]??event.actor_role}</>} · {stamp(event.created_at, l)}</p></li>)}</ol> : <p className="text-body2 text-muted-foreground">{st(l,'Load current task history to see recorded changes.','Բեռնեք առաջադրանքի ընթացիկ պատմությունը՝ գրանցված փոփոխությունները տեսնելու համար։',"Загрузите текущую историю задачи, чтобы увидеть записанные изменения.")}</p>}</details></div>}
 </li>;
}
function matchesTask(task:CoordinationTask,filter:string){return filter==='active'?!['completed','cancelled'].includes(task.status):filter==='reassign'?task.needsReassignment:task.status===filter;}
function mergeTasks(previous:CoordinationTask[],incoming:CoordinationTask[]){return Array.from(new Map([...previous,...incoming].map(task=>[task.id,task])).values());}
export function RealCoordinationTasks({page,memberPage,actor,caseId,locale:l='en',nurseChat=false,onTaskChanged,actions=pageActions}:{page:CoordinationTaskPage;memberPage:CoordinationMemberPage;actor:CoordinationActor;caseId?:string;locale?:StaffLocale;nurseChat?:boolean;onTaskChanged?:(task:CoordinationTask)=>void;actions?:CoordinationActions}) {
 const {readCoordinationPage}=actions;
 const [view,setView]=useState<(CoordinationTaskPage & {filter:string;source:CoordinationTaskPage})|null>(null);const selectedFilter=useRef('active');
 const current=view?(view.filter==='active'&&view.source!==page?{...view,tasks:mergeTasks(view.tasks,page.tasks).filter(task=>matchesTask(task,'active'))}:view):{...page,filter:'active',source:page};
 const [message,setMessage]=useState('');const [pending,start]=useTransition();const busy=useRef(false);
 const filters=[['active',st(l,'Active','Ակտիվ',"Активные")],['open',statusLabel(l,'open')],['awaiting-member',statusLabel(l,'awaiting-member')],['awaiting-doctor',statusLabel(l,'awaiting-doctor')],['completed',statusLabel(l,'completed')],['cancelled',statusLabel(l,'cancelled')],['reassign',st(l,'Needs reassignment','Պահանջում է վերանշանակում',"Требуется переназначение")]];
 function changeView(filter:string,more=false){if(busy.current)return;selectedFilter.current=filter;busy.current=true;setMessage('');start(async()=>{try{const result=await readCoordinationPage({caseId,filter,cursor:more?current.nextCursor:null});if(!result.ok){setMessage(staffServerText(l,result.error));return;}const tasks=more?mergeTasks(current.tasks,result.page.tasks):result.page.tasks;setView({...result.page,tasks,filter,source:page});}catch{setMessage(st(l,'Current tasks could not load. Your current view is retained. Try again.','Ընթացիկ առաջադրանքները չհաջողվեց բեռնել։ Ձեր ընթացիկ տեսքը պահված է։ Կրկին փորձեք։',"Не удалось загрузить текущие задачи. Текущий список сохранён. Попробуйте снова."));}finally{busy.current=false;}});}
 function onChanged(task:CoordinationTask,recorded=false){onTaskChanged?.(task);setView(previous=>{const base=previous||{...page,filter:selectedFilter.current,source:page};return {...base,tasks:mergeTasks(base.tasks,[task]).filter(row=>matchesTask(row,base.filter))};});if(recorded)setMessage(st(l,'Your task change is recorded.','Ձեր առաջադրանքի փոփոխությունը գրանցված է։',"Ваше изменение задачи записано."));}
 return <section className="space-y-4" aria-labelledby="coordination-tasks"><div><h2 id="coordination-tasks" className="text-h2">{st(l,'Coordination tasks','Համակարգման առաջադրանքներ',"Задачи координации")}</h2><p className="text-caption text-muted-foreground">{st(l,'Operational follow-up and contact records. Clinical decisions stay with the assigned doctor.','Գործառնական հետագա քայլեր և կապի գրառումներ։ Կլինիկական որոշումները մնում են կցված բժշկին։',"Организационные действия и записи о связи. Клинические решения принимает назначенный врач.")}</p></div>{actor.role!=='nurse'&&actor.role!=='coordinator'&&<CreateTask actions={actions} l={l} memberPage={memberPage} caseId={caseId} onChanged={onChanged}/>}<div className="flex flex-wrap gap-2" aria-label={st(l,'Task filters','Առաջադրանքների զտիչներ',"Фильтры задач")}>{filters.map(([value,label])=><button type="button" key={value} aria-pressed={current.filter===value} disabled={pending} onClick={()=>changeView(value)} className={`min-h-11 rounded-md border px-3 text-body2 ${current.filter===value?'border-primary bg-primary text-primary-foreground':'hover:bg-muted'}`}>{label}</button>)}</div>{pending&&<p role="status" className="text-caption text-muted-foreground">{st(l,'Loading current tasks…','Ընթացիկ առաջադրանքները բեռնվում են…',"Загрузка текущих задач…")}</p>}{message&&<p role="status" className="text-body2">{message}</p>}{current.tasks.length?<ul className="rounded-lg border bg-card px-4">{current.tasks.map(task=><TaskRow memberHref={nurseChat?`/staff/real/nurse-chat?member=${task.caseId}`:undefined} actions={actions} key={task.id} initial={task} actor={actor} onChanged={onChanged} l={l}/>)}</ul>:<p className="rounded-lg border p-5 text-body2 text-muted-foreground">{st(l,'No tasks in this view.','Այս տեսքում առաջադրանքներ չկան։',"В этом списке нет задач.")}</p>}{current.nextCursor&&<button type="button" disabled={pending} onClick={()=>changeView(current.filter,true)} className="min-h-11 rounded-md border px-4 text-body2">{st(l,'Load more tasks','Բեռնել ավելի շատ առաջադրանքներ',"Загрузить ещё задачи")}</button>}<button type="button" disabled={pending} onClick={()=>changeView(current.filter)} className="min-h-11 rounded-md border px-4 text-body2">{st(l,'Refresh task list','Թարմացնել առաջադրանքների ցանկը',"Обновить список задач")}</button></section>;
}
