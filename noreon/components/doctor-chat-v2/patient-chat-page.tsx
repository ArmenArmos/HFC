import {staffLiveAvailable,staffVoiceAvailable} from '@/lib/staff-zoe/voice';
/** WP V: voice for this role, and Gemini Live only when voice itself is on. */
const staffVoiceProps=async(role:'NURSE'|'DOCTOR')=>{const voiceAvailable=await staffVoiceAvailable(role);return voiceAvailable&&await staffLiveAvailable(role)?{voiceAvailable,voiceLive:true}:{voiceAvailable};};
import 'server-only';
import {z} from 'zod';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {readChatMemberIdentities} from '@/lib/staff/chat-member-identity-read';
import {memberPageSchema} from '@/lib/staff/real-coordination/schema';
import {readDoctorLdl} from '@/lib/ldl/runtime';
import {readDoctorPlanVersions} from '@/lib/doctor-completion/document-runtime';
import {resultsReportEnabled} from '@/lib/gp-report/config';
import {readLab} from '@/lib/lab-ai/doctor-runtime';
import {readStaffClinicalHeader} from '@/lib/clinical-review/header-read';
import {PatientChat} from './patient-chat';
import '@/components/chat-v2/chat.css';
import './doctor-chat.css';
export async function patientChatPage(memberId:string,focusAlertId?:string,focusLabId?:string){
 const {client,identity}=await requireRealStaffForRender();
 const locale=await staffLocale(identity.role);
 const refuse=()=> <main className="p-6"><p>{st(locale,'This chat is not available for your account.','Այս զրույցը հասանելի չէ ձեր հաշվին։','Этот чат недоступен для вашей учётной записи.')}</p></main>;
 if(identity.role!=='doctor'||!z.uuid().safeParse(memberId).success)return refuse();
 try{
  const status=await client.rpc('staff_zoe_status');if(status.error||status.data!==true)return refuse();
  // The identity read checks the doctor's current assignment. Rendering must not create a conversation.
  const member=(await readChatMemberIdentities(client as never,[memberId]))?.find(row=>row.id===memberId);
  if(!member)return refuse();
  const teamRead=await client.rpc('patient_coordination_members',{p_search:memberId,p_limit:50});
  const team=memberPageSchema.safeParse(teamRead.data);
  const owners=!teamRead.error&&team.success?team.data.members.find(row=>row.id===memberId)?.owners??null:null;
  const ldl=await readDoctorLdl(client as never,memberId).catch(()=>null);
  const versions=await readDoctorPlanVersions(client as never,memberId).catch(()=>null);
  const clinical=await readStaffClinicalHeader(client,memberId,ldl).catch(()=>null);
  const lab=focusLabId?await readLab(client as never,memberId,focusLabId):null;
  const validatedLab=lab&&lab!=='access'&&lab.enabled&&lab.fileId===focusLabId?focusLabId:undefined;
  return <PatientChat key={`${identity.id}:${memberId}`} {...await staffVoiceProps('DOCTOR')} doctorId={identity.id} doctorName={identity.name} focusAlertId={focusAlertId} focusLabId={validatedLab} member={member} locale={locale} owners={owners} risk={ldl?.enabled?ldl.goals[0]?.category??null:null} planVersion={versions?.find(v=>v.current)?.version??null} resultsReport={resultsReportEnabled()} clinical={clinical}/>;
 }catch{return refuse();}
}
