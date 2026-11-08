import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {readNurseAlerts} from '@/lib/care-alerts/nurse';
import {NurseUrgentAlerts} from '@/components/staff/nurse-urgent-alerts';
import {readCoordinationWorkspace} from '@/lib/staff/real-coordination/repository';
import {RealCoordinationTasks} from '@/components/staff/real-coordination-tasks';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {readReportedBpTasks} from '@/lib/care-queue/server';
import {ReportedBpTasks} from '@/components/staff/reported-bp-tasks';
export default async function RealTasksPage({searchParams}:{searchParams:Promise<{view?:string}>}){
 const workspace=await readCoordinationWorkspace();
 const locale=await staffLocale(workspace.actor.role);
 const view=(await searchParams).view==='sandbox'?'sandbox':'live';
 const isNurse=workspace.actor.role==='nurse';
 const client=isNurse?(await requireRealStaffForRender()).client:null;
 const alerts=client?await readNurseAlerts(client):undefined;
 const showBp=isNurse&&zoeAppV3Enabled();
 const bpTasks=showBp&&client?await readReportedBpTasks(client,view):null;
 return <><h1 className="text-h1">{st(locale,'Your tasks','Ձեր առաջադրանքները','Ваши задачи')}</h1>
  <NurseUrgentAlerts read={alerts} locale={locale}/>
  {showBp&&<ReportedBpTasks tasks={bpTasks} locale={locale} view={view}/>}
  <RealCoordinationTasks {...workspace} locale={locale}/></>;
}
