import Link from 'next/link';
import type {Route} from 'next';
import type {Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {taskReasons,statusLabel,type CareQueueTask} from '@/lib/care-queue/contracts';
import {CareSection} from '@/components/patient-care/common';

export function ReportedBpTasks({tasks,locale,view}:{tasks:CareQueueTask[]|null;locale:Locale;view:'live'|'sandbox'}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if(tasks?.length===0)return null;
 return <CareSection title={t('Member-reported blood pressure','Անդամի հաղորդած ճնշումը','Давление со слов участника')}>
  {tasks===null?<p role="status">{t('Blood pressure tasks could not load. Open Care queue to check.','Ճնշման առաջադրանքները չբեռնվեցին։ Ստուգեք խնամքի հերթը։','Не удалось загрузить задачи по давлению. Проверьте очередь задач.')}</p>
   :<ul className="divide-y">{tasks.map(task=><li key={task.id} className="space-y-2 py-3" data-care-queue-task={task.id}><p className="text-body2">{task.memberName}: {taskReasons(task,locale)}</p><p className="text-caption text-muted-foreground">{statusLabel(task.status,locale)}</p><Link className="inline-flex min-h-11 items-center underline" href={`/staff/real/care-queue${view==='sandbox'?'?view=sandbox':''}#task-${task.id}` as Route}>{t('Open task in Care queue','Բացել առաջադրանքը խնամքի հերթում','Открыть задачу в очереди')}</Link></li>)}</ul>}
 </CareSection>;
}
