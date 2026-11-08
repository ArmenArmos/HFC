import {notFound} from 'next/navigation';
import {requireRealAdminForRender} from '@/lib/staff/real-staff-render';
import {CareSection} from '@/components/patient-care/common';
import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';
import {readConsultationQueue} from '@/lib/doctor-completion/consultation-runtime';
import type {DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import {arrangeConsultation} from '@/lib/doctor-completion/consultation-actions';
import {ConsultationQueueView} from '@/components/staff/consultation-queue';
import {readMemberContacts} from '@/lib/staff/member-contact';
export const dynamic='force-dynamic';

/** Consultations a doctor asked for, for a Noreon admin to arrange. No clinical reason is shown. */
export default async function ConsultationsPage(){
 if(!doctorCompletionEnabled())notFound();
 const {client}=await requireRealAdminForRender();
 const data=await readConsultationQueue(client as unknown as DocumentRpc);
 if(data&&!data.enabled)notFound();
 // QA F-01: the admin needs a way to reach each member; admin-only and refused by the database for anyone else.
 const contacts=data?await readMemberContacts(client as unknown as DocumentRpc,data.cases.map(c=>c.memberId)):null;
 return <div className="space-y-6">
  <header className="max-w-3xl space-y-2"><h1 className="text-h1">Consultations to arrange</h1>
   <p className="text-body2 text-muted-foreground">A doctor asked to speak with these members before sharing new results. Call or write to the member to agree a time, then mark it arranged here. The member sees the time and how it happens. The hold ends when the doctor records the consultation as completed.</p></header>
  {data?<ConsultationQueueView data={data} contacts={contacts} submissionIds={Object.fromEntries(data.cases.map(c=>[c.memberId,crypto.randomUUID()]))} command={arrangeConsultation}/>
   :<CareSection title="Consultations unavailable"><p role="status" className="text-body2">The list could not be loaded. Reload to try again.</p></CareSection>}
 </div>;
}
