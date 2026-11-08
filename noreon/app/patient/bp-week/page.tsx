import {notFound} from "next/navigation";
import {PatientShell} from "@/components/patient/patient-shell";
import {requireRegistered} from "@/lib/patient/repository";
import {readMemberBpWeek} from "@/lib/bp-week/server";
import {bpDevicesEnabled} from "@/lib/bp-device/config";
import {MemberBpWeekContent} from "@/components/bp-week/member-week-content";
export const dynamic="force-dynamic";
export default async function BpWeekPage() {
 const {profile}=await requireRegistered();const read=await readMemberBpWeek();
 if(!read.enabled)notFound();
 return <PatientShell locale={profile.locale}><MemberBpWeekContent read={read} locale={profile.locale} now={new Date()} showDevice={bpDevicesEnabled()}/></PatientShell>;
}
