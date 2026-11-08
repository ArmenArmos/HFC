import {randomUUID} from 'node:crypto';
import {redirect} from 'next/navigation';
import type {Route} from 'next';
import {doctorHomePath} from '@/lib/staff-zoe/workspace-config';
import {directorySchema} from '@/lib/patient-care/clinical-case-repository';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {MemberSearch} from '@/components/real-review/member-search';
import {runMemberSearch} from '@/lib/staff/member-search-command';
import {withTestAccountFlags} from '@/lib/staff/test-accounts';
import {z} from 'zod';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {readDoctorQueue,type ProgrammeRpc} from '@/lib/programme/runtime';
import {ProgrammeQueue} from '@/components/staff/programme-queue';
import {readFirstNoteQueue,type FirstNoteRpc} from '@/lib/first-note/runtime';
import {FirstNoteQueue} from '@/components/staff/first-note-queue';

export default async function RealQueuePage(){
 const {client,identity}=await requireRealStaffForRender();
 // The member list is clinical: a care coordinator works from the logistics queue instead.
 if(identity.role==='coordinator')redirect(doctorHomePath('coordinator') as Route);
 // Three independent reads, each scoped by the database: run them together.
 const [locale,result,directory,nurseDirectory]=await Promise.all([
  staffLocale(identity.role),
  runMemberSearch({query:'',cursor:null},async()=>await client.rpc('patient_clinical_case_search',{p_query:''})).then(r=>withTestAccountFlags(client,r)),
  identity.role==='admin'?client.rpc('patient_clinical_doctor_directory'):null,
  identity.role==='admin'?client.rpc('patient_clinical_nurse_directory'):null,
 ]);
 if(directory?.error)throw Error('Doctor directory unavailable.');
 const doctors=directory?directorySchema.parse(directory.data):[];
 if(nurseDirectory?.error)throw Error('Nurse directory unavailable.');
 // Programme rhythm (dark): the doctor's open reviews; the database decides the switch and scope.
 const [programme,firstNotes]=await Promise.all([
  identity.role==='doctor'?readDoctorQueue(client as unknown as ProgrammeRpc):null,
  identity.role==='doctor'||identity.role==='admin'?readFirstNoteQueue(client as unknown as FirstNoteRpc):null,
 ]);
 const scopeKey=`${identity.id}:${identity.role}:${identity.clinicId??''}`;
 const nurses=nurseDirectory?z.array(z.object({id:z.uuid(),name:z.string(),clinic:z.string(),clinicId:z.uuid()})).parse(nurseDirectory.data):[];
 return <>
  <h1 className="text-h1">{identity.role==='admin'?st(locale,'Member review requests','Անդամների վերանայման հարցումներ','Заявки на проверку участников'):st(locale,'Your assigned member reviews','Ձեզ կցված անդամները','Проверки назначенных вам участников')}</h1>
  <p className="text-body2 text-muted-foreground">{identity.role==='admin'?st(locale,'Assign each request to an active doctor. Clinical evidence and publication are available to the assigned doctor.','Յուրաքանչյուր հարցում կցեք գործող բժշկի։ Կլինիկական տվյալներն ու հրապարակումը հասանելի են կցված բժշկին։','Назначьте каждую заявку действующему врачу. Медицинские данные и публикация доступны назначенному врачу.'):identity.role==='nurse'?st(locale,'Collect measurements and evidence, record contact, and refer clinical questions to the doctor.','Գրանցեք չափումներն ու տվյալները, նշեք կապի փորձերը և կլինիկական հարցերն ուղղեք բժշկին։','Собирайте измерения и данные, отмечайте контакты и направляйте медицинские вопросы врачу.'):st(locale,'Review assigned evidence and treatment plans.','Վերանայեք կցված անդամների տվյալներն ու բուժման պլանները։','Проверьте данные назначенных участников и планы лечения.')}</p>
  {(identity.role==='doctor'||identity.role==='admin')&&<FirstNoteQueue queue={firstNotes} locale={locale} now={new Date()}/>}
  {programme&&<ProgrammeQueue queue={programme} locale={locale}/>}
  {/* Keep the private query within this actor/scope; signal fresh server data without remounting it. */}
  <MemberSearch key={scopeKey} scopeKey={scopeKey} refreshToken={randomUUID()} initialPage={result.ok?result.page:null} role={identity.role} doctors={doctors} nurses={nurses} locale={locale}/>
 </>;
}
