import { PatientShell } from '@/components/patient/patient-shell';
import { ContactPreference } from '@/components/patient/contact-preference';
import { WhenWeReply } from '@/components/patient/when-we-reply';
import { requireRegisteredForRender } from '@/lib/patient/render-data';
import { readMemberContactStatus } from '@/lib/patient/member-preferences';
export const dynamic = 'force-dynamic';
export default async function ContactPage() {
  const { profile } = await requireRegisteredForRender(), l = profile.locale;
  const status = await readMemberContactStatus();
  return <PatientShell locale={l}><div className="max-w-2xl space-y-6">
    <ContactPreference locale={l} status={status}/>
    <WhenWeReply locale={l}/>
  </div></PatientShell>;
}
