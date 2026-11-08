import {PatientShell} from "@/components/patient/patient-shell";
import {MemberTeamContent} from "@/components/patient-care/member-team-content";
import {carePageData} from "@/lib/patient-care/repository";
import {memberContact} from "@/lib/patient-care/member-contact";
import {realReviewEnabled} from "@/lib/patient-care/real-review-config";
export default async function CareTeamPage() {
  const {profile,care}=await carePageData();
  const contact=await memberContact();
  return <PatientShell locale={profile.locale}><MemberTeamContent locale={profile.locale} clinician={care.plan?.clinician??null} contact={contact} reviewEnabled={realReviewEnabled(process.env)}/></PatientShell>;
}
