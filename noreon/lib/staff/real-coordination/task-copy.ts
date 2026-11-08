import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {pick} from '@/lib/locale';
import type {CoordinationTask} from './schema';
import {staffDisplayText} from '@/lib/staff/display-text';

// Fixed SQL titles only. HY/RU additions are drafts for Roo.
const systemTitles={
 nurse_handoff:{'Nurse handoff':['Nurse handoff','Փոխանցում բուժքրոջից','Передача от медсестры']},
 doctor_handover:{
  'From the doctor':['From the doctor','Բժշկից','От врача'],
  'Բժշկի կողմից':['From the doctor','Բժշկից','От врача'],
  'От врача':['From the doctor','Բժշկից','От врача'],
 },
 zoe_side_effect:{
  'Mild side effect from Zoe':['Mild side effect from Zoe','Թեթև կողմնակի ազդեցություն՝ Զոյայից','Лёгкий побочный эффект от Зои'],
  'Side effect reported: ankle swelling':['Side effect reported: ankle swelling','Հաղորդվել է կողմնակի ազդեցություն՝ կոճերի այտուց','Сообщён побочный эффект: отёк лодыжек'],
  'Side effect reported: dizziness':['Side effect reported: dizziness','Հաղորդվել է կողմնակի ազդեցություն՝ գլխապտույտ','Сообщён побочный эффект: головокружение'],
  'Side effect reported: nausea':['Side effect reported: nausea','Հաղորդվել է կողմնակի ազդեցություն՝ սրտխառնոց','Сообщён побочный эффект: тошнота'],
  'Side effect reported: dry cough':['Side effect reported: dry cough','Հաղորդվել է կողմնակի ազդեցություն՝ չոր հազ','Сообщён побочный эффект: сухой кашель'],
  'Side effect reported: headache':['Side effect reported: headache','Հաղորդվել է կողմնակի ազդեցություն՝ գլխացավ','Сообщён побочный эффект: головная боль'],
  'Side effect reported: frequent urination':['Side effect reported: frequent urination','Հաղորդվել է կողմնակի ազդեցություն՝ հաճախամիզություն','Сообщён побочный эффект: частое мочеиспускание'],
 },
} satisfies Record<string,Record<string,readonly [string,string,string]>>;

export function taskTitle(task:Pick<CoordinationTask,'title'|'kind'|'origin'|'sourceConversationId'>,locale:StaffLocale):string{
 if(task.origin){
  const titles:Record<string,readonly [string,string,string]>=systemTitles[task.origin];
  const expectedKind=task.origin==='nurse_handoff'?'doctor-referral':'contact-followup';
  if(task.kind===expectedKind&&Object.hasOwn(titles,task.title))return st(locale,...titles[task.title]);
 }
 // Origin-null staff titles, legacy rows and edited system titles stay as typed.
 return staffDisplayText(task.title,locale,true);
}

export const completionNoteLabel=(l:StaffLocale)=>st(l,'Completion note','Ավարտի նշում','Заметка о завершении');
export const taskUncertainText=(l:StaffLocale)=>st(l,'The result could not be confirmed. Load current task history before retrying. Your entries are retained.','Արդյունքը չհաջողվեց հաստատել։ Կրկին փորձելուց առաջ բեռնեք առաջադրանքի ընթացիկ պատմությունը։ Ձեր մուտքագրածը պահված է։','Не удалось подтвердить результат. Загрузите текущую историю задачи перед повторной попыткой. Введённые данные сохранены.');

const contactOutcomes: Record<string, string> = { 'contact-attempted': 'Contact attempted', reached: 'Reached', unreachable: 'Unreachable' };
const labels = { contact: 'Record contact', 'await-member': 'Await member response', reopen: 'Resume task', complete: 'Complete coordination', refer: 'Refer to assigned doctor', resolve: 'Resolve doctor referral', edit: 'Edit task', reassign: 'Reassign owner', cancel: 'Cancel task', create: 'Create task' };
export type TaskOperation = keyof typeof labels;
const contactOutcomesHy: Record<string, string> = { 'contact-attempted': 'Կապի փորձ', reached: 'Կապ հաստատվեց', unreachable: 'Անհասանելի' };
const labelsHy: Record<TaskOperation, string> = { contact: 'Գրանցել կապը', 'await-member': 'Սպասել անդամի պատասխանին', reopen: 'Վերսկսել առաջադրանքը', complete: 'Ավարտել համակարգումը', refer: 'Ուղղորդել կցված բժշկին', resolve: 'Լուծել բժշկի ուղղորդումը', edit: 'Խմբագրել առաջադրանքը', reassign: 'Փոխել պատասխանատուին', cancel: 'Չեղարկել առաջադրանքը', create: 'Ստեղծել առաջադրանք' };
const contactOutcomesRu: Record<string,string> = {"contact-attempted": "Попытка связи", "reached": "Связь установлена", "unreachable": "Связаться не удалось"};
const labelsRu: Record<TaskOperation,string> = {"contact": "Записать контакт", "await-member": "Ожидать ответа участника", "reopen": "Возобновить задачу", "complete": "Завершить координацию", "refer": "Направить назначенному врачу", "resolve": "Закрыть направление к врачу", "edit": "Изменить задачу", "reassign": "Переназначить ответственного", "cancel": "Отменить задачу", "create": "Создать задачу"};
export const taskOperationLabel = (l: StaffLocale, op: TaskOperation) => pick(l,{en:labels,hy:labelsHy,ru:labelsRu})[op];
export const contactOutcomeChoices=['contact-attempted','reached','unreachable'] as const;
export type ContactOutcome=typeof contactOutcomeChoices[number];
export const contactOutcomeLabel=(l:StaffLocale,outcome:ContactOutcome)=>pick(l,{en:contactOutcomes,hy:contactOutcomesHy,ru:contactOutcomesRu})[outcome];
export const contactOutcomeFieldLabel=(l:StaffLocale)=>st(l,'Contact outcome','Կապի արդյունք',"Результат связи");
export const taskNoteLabel=(l:StaffLocale,operation:TaskOperation)=>operation==='contact'?st(l,'Contact note','Կապի նշում',"Заметка о связи"):operation==='cancel'?st(l,'Cancellation reason','Չեղարկման պատճառ',"Причина отмены"):operation==='resolve'?st(l,'Resolution note','Լուծման նշում',"Заметка о решении"):operation==='refer'?st(l,'Referral note','Ուղղորդման նշում',"Заметка о направлении"):completionNoteLabel(l);
export type NurseTaskOperation='complete'|'contact'|'await-member'|'reopen'|'refer';
export const taskNeedsNote=(operation:NurseTaskOperation)=>operation!=='await-member'&&operation!=='reopen';
/** Matches the nurse actions in TaskRow, including referral and reassignment gates. */
export function availableTaskOperations(task:CoordinationTask):NurseTaskOperation[]{
 if(['completed','cancelled'].includes(task.status))return [];
 const eligibleOwner=task.eligibleOwners.some(owner=>owner.id===task.ownerId&&(task.kind!=='doctor-referral'||owner.role==='doctor'));
 if(!eligibleOwner)return [];
 if(task.kind==='doctor-referral')return task.status==='open'?['contact','refer']:['contact'];
 return ['contact',task.status==='open'?'await-member':'reopen','complete'];
}
export const canTaskOperation=(task:CoordinationTask,operation:NurseTaskOperation)=>availableTaskOperations(task).includes(operation);

/** The server filters pages before paging; rows changed here since then must be filtered the same way. */
export function taskMatchesFilter(task:{status:string;needsReassignment?:boolean},filter:string){
 const live=!['completed','cancelled'].includes(task.status);
 return filter==='active'?live:filter==='reassign'?live&&task.needsReassignment===true:task.status===filter;
}
