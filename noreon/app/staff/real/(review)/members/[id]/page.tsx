import {consultationProposal} from '@/lib/patient-care/consultation-proposal';
import {clinicalConsultationProposal} from '@/lib/patient-care/clinical-review-engine';
import {bpUnit} from '@/lib/bp-unit';
import {isUnverifiedBp,unverifiedBpLabel,bpObservationCounts} from '@/lib/patient/bp-provenance';
import {nurseChatEnabled} from '@/lib/nurse-chat/config';
import {RealCoordinationTasks} from "@/components/staff/real-coordination-tasks";
import {readCoordinationWorkspace} from "@/lib/staff/real-coordination/repository";
import { notFound,unstable_rethrow } from "next/navigation";
import Link from "next/link";
import {doctorChatV2Enabled} from '@/lib/staff-zoe/workspace-config';
import type { Route } from "next";
import { MessagesSquare } from "lucide-react";
import {currentAiDraft} from '@/lib/ai-plan/current';
import {currentClinicalReview} from '@/lib/patient-care/clinical-review-current';
import { snapshotSchema } from "@/lib/patient-care/clinical-case-repository";
import { requireRealStaffForRender } from "@/lib/staff/real-staff-render";
import { RealReviewControls } from "@/components/real-review/review-controls";
import { PublishConfirmationProvider } from "@/components/real-review/publish-confirmation";
import { DraftForm } from "@/components/real-review/forms";
import { CareTasks } from "@/components/staff/care-tasks";
import { CaseSections, CaseTabs, CasePanel } from "@/components/staff/case-sections";
import { CareSection, stamp } from "@/components/patient-care/common";
import { z } from "zod";
import { fieldById } from "@/lib/clinical/seed/questions";
import { getStaffBookingRequests } from "@/lib/real-booking/repository";
import { RealStaffBooking } from "@/components/real-booking/staff";
import { PilotStaffBooking } from "@/components/real-booking/pilot-staff";
import { getStaffAppointmentData } from "@/lib/real-booking/appointment-repository";
import { legacyBookingMode, withClinicalHold, evidenceClinicalHold } from "@/lib/real-booking/legacy-mode";
import type { PilotBookingData } from "@/lib/real-booking/appointment-schema";
import { changeStaffAppointment,cancelStaffAppointment,startStaffAppointmentNotice,retryStaffAppointmentNotice,reconcileStaffAppointmentNotice } from "@/lib/real-booking/appointment-actions";
import {RealVisitEvidence}from'@/components/staff/real-visit-evidence';
import {readVisitEvidence,type VisitRpc}from'@/lib/staff/visit-evidence-runtime';
import {recordRealVisitEvidence,refreshRealVisitEvidence}from'@/lib/staff/visit-evidence-actions';
import {RealLabStages}from'@/components/staff/real-lab-stages';
import {readLabStages}from'@/lib/staff/lab-stage-runtime';
import {recordRealLabStage}from'@/lib/staff/lab-stage-actions';
import {labStages}from'@/lib/staff/lab-stage-schema';
import {staffLocale}from'@/lib/staff/staff-locale';
import {calendarDate}from'@/lib/staff/yerevan-time';
import {VisitChecklist}from'@/components/staff/visit-checklist';
import {st,type StaffLocale}from'@/lib/staff/staff-locale-copy';
import {bpDevicesEnabled}from'@/lib/bp-device/config';
import {readBpMemberDevices,type BpRpc}from'@/lib/bp-device/runtime';
import {recordBpDeviceCommand}from'@/lib/bp-device/actions';
import {BpDevicePanel}from'@/components/staff/bp-device-panel';
import {BpReadingsHistory}from'@/components/staff/bp-readings-history';
import {doctorCompletionEnabled}from'@/lib/doctor-completion/config';
import {readDoctorDocuments,readDoctorPlanVersions,type DocumentRpc}from'@/lib/doctor-completion/document-runtime';
import {recordMemberDocumentRelease}from'@/lib/doctor-completion/document-actions';
import {MemberDocuments}from'@/components/staff/member-documents';
import {UploadOverrideNotice}from'@/components/staff/upload-override-notice';
import {readUploadOverrides}from'@/lib/staff/upload-overrides';
import {MemberUploads}from'@/components/staff/member-uploads';
import {readMemberUploadApprovals}from'@/lib/lab-ai/member-approval-server';
import {approveMemberUpload}from'@/lib/lab-ai/actions';
import {readMemberHistoryForStaff}from'@/lib/member-history/server';
import {readStaffLabResults}from'@/lib/lab-ai/staff-results-server';
import {resultsCardItems}from'@/lib/lab-ai/staff-results';
import {LabAiResults,LabResultsCard}from'@/components/staff/lab-ai-results';
import {readClinicLabSources} from '@/lib/patient-care/clinic-lab-sources';
import {readRequiredEvidenceSources} from '@/lib/patient-care/required-evidence';
import {multiMedicineEnabled} from '@/lib/patient-care/regimen-config';
import {readDoctorRegimenReview} from '@/lib/patient-care/regimen-runtime';
import {RegimenChanges,RegimenList} from '@/components/patient-care/regimen-changes';
import {readMemberContacts}from'@/lib/staff/member-contact';
import {MemberContactLine}from'@/components/staff/member-contact';
import {readApprovedGpReport,readGpReport,resultsBlockFromReport,type GpRpc}from'@/lib/gp-report/runtime';
import {languageBlocks}from'@/lib/gp-report/document';
import {approveMemberGpReport}from'@/lib/gp-report/actions';
import {GpReportPanel}from'@/components/staff/gp-report-panel';
import {readDoctorMember,type ProgrammeRpc}from'@/lib/programme/runtime';
import {confirmProgrammePlan}from'@/lib/programme/actions';
import {ProgrammePanel}from'@/components/staff/programme-panel';
import {labAiEnabled}from'@/lib/lab-ai/config';
import {readTestAccountFlags}from'@/lib/staff/test-accounts';
import {TestAccountBadge,TestAccountFlagForm,TestAccountResetButton}from'@/components/staff/test-account-controls';
import {resetTestAccount,setTestAccount}from'@/lib/staff/test-account-actions';
import {BpWeekMedicinesPanels}from'@/components/staff/bp-week-medicines-panels';
import {readStaffBpWeek,type BpWeekRpc}from'@/lib/bp-week/server';
import {readStaffMedicineReasons,readStaffMedicines,type MedicinesRpc}from'@/lib/member-medicines/server';
import {readMemberUrgent}from'@/lib/doctor-inbox/member-urgent-server';
import {MemberUrgentSection}from'@/components/staff/member-urgent';
import {readLabOverview,type LabRpcClient}from'@/lib/lab-ai/doctor-runtime';
import {readStaffMemberSafety}from'@/lib/member-safety/staff';
import {decideMemberSafetyHold}from'@/lib/member-safety/actions';
import {MemberSafetyPanel}from'@/components/staff/member-safety-panel';
import {SAFETY_COPY}from'@/lib/member-safety/contract';
import {readDoctorAiPlan}from'@/lib/ai-plan/server';
import {AiPlanPanel,AiPlanPrepare}from'@/components/staff/ai-plan-panel';
import {readNurseVisitRecord,type NurseVisitRpc}from'@/lib/nurse-visit/runtime';
import {NurseVisitRecordPanel}from'@/components/staff/nurse-visit-record';
import {readDoctorFirstNote,type FirstNoteRpc}from'@/lib/first-note/runtime';
import {firstNoteNext,prepareFirstNote}from'@/lib/first-note/compose';
import {approveFirstNote}from'@/lib/first-note/actions';
import {FirstNotePanel}from'@/components/staff/first-note-panel';
import type {Answers}from'@/lib/clinical/types';
import {readDoctorLdl,type LdlRpc}from'@/lib/ldl/runtime';
import {addLdlEvent,addLdlTherapy,endLdlTherapy,removeLdlEvent,setLdlGoal}from'@/lib/ldl/actions';
import {LdlGoalPanel}from'@/components/staff/ldl-goal-panel';
import {cancelLdlRetest}from'@/lib/ldl/response-actions';
import {readLipidPlanner}from'@/lib/lipid-planner/runtime';
import {buildLipidPlan}from'@/lib/lipid-planner/plan';
import {LipidPlanCard}from'@/components/staff/lipid-plan-card';
function answerText(key: string, answer: unknown, locale: StaffLocale) {
  const field = fieldById(key);
  const value = answer && typeof answer === "object" && "value" in answer ? answer.value : answer;
  const label = (v: unknown) => field?.options?.find(option => option.value === v)?.label[locale] ?? (v == null ? st(locale, "Not recorded", "Չի գրանցվել","Не записано") : typeof v === "string" ? v : JSON.stringify(v));
  return Array.isArray(value) ? value.map(label).join(", ") : label(value);
}
/** Starts a read now and lets the render await it later, in the original order. A failure
 * stays with the promise (no unhandled rejection) and surfaces at that later await. */
function started<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}
function sexLabel(value: string | null | undefined, locale: StaffLocale) {
  if (!value) return st(locale, "Sex not recorded", "Սեռը չի գրանցվել","Пол не указан");
  return fieldById("q1.sex")?.options?.find(item => item.value === value)?.label[locale] ?? value;
}
export default async function RealMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { client, identity,actorScope } = await requireRealStaffForRender();
  const doctor = identity.role === "doctor";
  const bpOn=bpDevicesEnabled();
  const completion = doctor && doctorCompletionEnabled();
  // Reads are scoped by the database for this staff session. Independent reads start
  // together instead of one after another, and each is still awaited in the original order,
  // so redirects, not-found and error handling behave as before. The access order is kept:
  // the pilot and BP reads came first and still start at once; for a doctor or nurse the case
  // snapshot must prove the assignment before anything else runs; then the coordination read
  // must pass its scope check before bookings, contacts and the clinical panels are read. So a
  // clinician or scope that is refused gets 404 before any of those reads, as before.
  const pilotRead=started(getStaffAppointmentData(id));
  const bpRead=bpOn?started(readBpMemberDevices(client as unknown as BpRpc,id)):null;
  const admin=identity.role === "admin";
  const snapshotRead=admin?null:started(Promise.resolve(client.rpc("patient_clinical_case_snapshot", { p_user_id: id })));
  const coordinationRead=started((snapshotRead?snapshotRead.then(r=>{if(r.error)throw Error("Member access not proven");}):Promise.resolve()).then(()=>readCoordinationWorkspace(id)));
  const afterAccess=<T,>(read:()=>Promise<T>)=>started(coordinationRead.then(read));
  // TEST badge (and, for an admin, the test account controls) only after access is proven.
  const testRead=afterAccess(()=>readTestAccountFlags(client as never,[id]).then(f=>f.has(id)));
  const bookingRead=afterAccess(()=>getStaffBookingRequests(id));
  const contactsRead=admin?afterAccess(()=>readMemberContacts(client as unknown as DocumentRpc, [id])):null;
  // AI-read lab results (dark; Khikar 18 Oct 14:38): the assigned doctor and administrators, read only; the database records each read.
  const labResultsRead=admin||doctor?afterAccess(()=>readStaffLabResults(client, id)):null;
  // Nurse visit timeline and comments (dark until nurse_visit_settings.enabled). The database leaves
  // measurement values out for the admin; the member never reads this.
  const nurseVisitRead=afterAccess(()=>readNurseVisitRecord(client as unknown as NurseVisitRpc, id));
  // Safety holds (dark, DT P342/P371/P389): the assigned doctor or an admin; nurses are refused by the database.
  const safetyRead=identity.role==='nurse'?null:afterAccess(()=>readStaffMemberSafety(client as unknown as Parameters<typeof readStaffMemberSafety>[0],id));
  const clinical=admin?null:{
    snapshot:snapshotRead!,
    visit:afterAccess(()=>readVisitEvidence({memberId:id,client:client as unknown as VisitRpc})),
    lab:afterAccess(()=>readLabStages({memberId:id,client:client as unknown as VisitRpc})),
    completion:completion?afterAccess(()=>Promise.all([readDoctorDocuments(client as unknown as DocumentRpc, id), readDoctorPlanVersions(client as unknown as DocumentRpc, id), labAiEnabled() ? readLabOverview(client as unknown as LabRpcClient, id) : Promise.resolve(undefined)])):null,
    history:doctor?afterAccess(()=>readMemberHistoryForStaff(client, id)):null,
    gp:doctor?afterAccess(()=>readGpReport(client as unknown as GpRpc, id)):null,
    // D1/D2 (dark): assigned nurse and doctor; each read says off while its switch is off. A failed read shows "Unavailable".
    bpWeek:afterAccess(()=>readStaffBpWeek(client as unknown as BpWeekRpc, id).catch(error=>{unstable_rethrow(error);return null;})),
    medicines:afterAccess(()=>readStaffMedicines(client as unknown as BpWeekRpc, id).catch(error=>{unstable_rethrow(error);return null;})),
    // Reasons the member gave Zoe for skipped or unticked doses (dark: member_medicine_settings.asks). Empty on failure.
    medicineReasons:afterAccess(()=>readStaffMedicineReasons(client as unknown as BpWeekRpc, id)),
    // AI-prepared plan draft (dark): assigned doctor; the database switch decides. A failed read hides the feature.
    aiPlan:doctor?afterAccess(()=>readDoctorAiPlan(client,id)):null,
    // First note "what I see and what comes next" (dark): assigned doctor; the database switch decides.
    firstNote:doctor?afterAccess(()=>readDoctorFirstNote(client as unknown as FirstNoteRpc,id)):null,
    // LDL goal (dark: ldl_goal_settings): assigned doctor only; the database decides and records the read.
    ldl:doctor?afterAccess(()=>readDoctorLdl(client as unknown as LdlRpc,id)):null,
    // Lipid follow-up plan (dark: ldl_goal_settings.lipid_planner_enabled): assigned doctor only; read-only, nothing is stored.
    lipidPlanner:doctor?afterAccess(()=>readLipidPlanner(client as unknown as LdlRpc,id)):null,
    // Open alerts and the open 103 window for this member: assigned doctor; the database scopes both reads. A failed read says so.
    urgent:doctor?afterAccess(()=>readMemberUrgent(client as unknown as MedicinesRpc,id)):null,
  };
  const locale = await staffLocale(identity.role);
  const t = (en: string, hy: string, ru: string) => st(locale, en, hy, ru);
  let pilot:Awaited<ReturnType<typeof getStaffAppointmentData>>|null=null;
  let pilotData:PilotBookingData|undefined;
  try{pilot=await pilotRead;pilotData=pilot.data;}catch(error){unstable_rethrow(error);}
  function visitsFor(data:PilotBookingData|undefined,hold=false){
    if(!data)return <CareSection title={t("Visits","Այցեր","Визиты")}>{hold&&<p role="status" className="text-body2">{t("The assigned program needs clinical review before booking.","Նշանակված ծրագիրը պլանավորումից առաջ կլինիկական վերանայման կարիք ունի։","Перед записью назначенная программа требует проверки врачом.")}</p>}<p role="status" className="text-body2">{t("Visits are unavailable. Reload to check the saved arrangements.","Այցերն անհասանելի են։ Թարմացրեք էջը՝ պահպանված պայմանավորվածությունները ստուգելու համար։","Визиты недоступны. Обновите страницу, чтобы проверить сохраненные договоренности.")}</p></CareSection>;
    // Pilot switched off with no pilot history: the member is on the legacy request flow, shown by RealStaffBooking.
    if(legacyBookingMode(data))return null;
    // QA F-04: an open test request (often a home visit) blocks a new clinic booking; say so instead of the generic review warning.
    if(data.unavailableReason==='legacy-reconciliation'&&!data.appointments.length)return <CareSection title={t("Visits","Այցեր","Визиты")}><p role="status" className="text-body2">{t("No clinic visit is booked. This member has an open test request, shown under Test requests below (for example a home visit). A clinic visit can be booked once that request is completed or cancelled.","Կլինիկայում այց գրանցված չէ։ Անդամն ունի բաց հետազոտության հարցում, որը ներքևում է (օրինակ՝ տնային այց)։ Կլինիկայում այց կարելի է գրանցել այդ հարցումն ավարտելուց կամ չեղարկելուց հետո։","Визит в клинику не назначен. У этого участника есть открытая заявка на анализы, показанная ниже в разделе заявок на анализы (например, визит на дом). Записать визит в клинику можно после завершения или отмены этой заявки.")}</p></CareSection>;
    return <PilotStaffBooking data={data} locale={locale} commandIds={Object.fromEntries(data.appointments.map(appointment=>[appointment.id,crypto.randomUUID()]))} changeAction={changeStaffAppointment.bind(null,id)} retryCommandIds={Object.fromEntries(data.appointments.map(appointment=>[appointment.id,crypto.randomUUID()]))} retryAction={retryStaffAppointmentNotice.bind(null,id)} recoveryCommandIds={Object.fromEntries(data.appointments.map(appointment=>[appointment.id,crypto.randomUUID()]))} recoveryAction={reconcileStaffAppointmentNotice.bind(null,id)} startAction={startStaffAppointmentNotice.bind(null,id)} startCommandIds={Object.fromEntries(data.appointments.map(appointment=>[appointment.id,crypto.randomUUID()]))} cancelAction={cancelStaffAppointment.bind(null,id)} cancelCommandIds={Object.fromEntries(data.appointments.map(appointment=>[appointment.id,crypto.randomUUID()]))} refreshHref={`/staff/real/members/${id}`} />;
  }
  // B7 BP monitor panel, dark behind NOREON_BP_DEVICES_ENABLED. The database decides scope.
  let bpData:Awaited<ReturnType<typeof readBpMemberDevices>>|null=null;
  if(bpRead)try{bpData=await bpRead;}catch(error){unstable_rethrow(error);}
  const bpPanel=!bpOn?null:bpData?<BpDevicePanel data={bpData} locale={locale} role={identity.role==='admin'?'admin':identity.role==='nurse'?'nurse':'doctor'} submissionIds={{assign:crypto.randomUUID(),end:crypto.randomUUID()}} command={recordBpDeviceCommand.bind(null,`/staff/real/members/${id}`)}/>:<CareSection title={t("BP monitor","Ճնշման սարք","Тонометр")}><p role="status" className="text-body2">{t("BP monitor details are unavailable. Reload to check them.","Ճնշման սարքի տվյալներն անհասանելի են։ Թարմացրեք էջը՝ ստուգելու համար։","Данные тонометра недоступны. Обновите страницу, чтобы проверить их.")}</p></CareSection>;
  const safetyPanel=async()=>{
    if(!safetyRead)return null;
    let safety:Awaited<ReturnType<typeof readStaffMemberSafety>>=null;
    try{safety=await safetyRead;}catch(error){unstable_rethrow(error);}
    if(safety==='refused')return null;
    if(!safety)return <CareSection title={st(locale,SAFETY_COPY.staff.title.en,SAFETY_COPY.staff.title.hy,SAFETY_COPY.staff.title.ru)}><p role="status" className="text-body2">{st(locale,SAFETY_COPY.staff.unavailable.en,SAFETY_COPY.staff.unavailable.hy,SAFETY_COPY.staff.unavailable.ru)}</p></CareSection>;
    return safety.enabled?<MemberSafetyPanel data={safety} memberId={id} locale={locale} decide={decideMemberSafetyHold}/>:null;
  };
  if (admin) {
    const coordination = await coordinationRead;
    const bookingRequests = await bookingRead;
    // QA F-01: the admin arranges visits and consultations by contacting the member.
    const contacts = await contactsRead;
    const labResults = labResultsRead ? await labResultsRead : undefined;
    // Read-only admin conversation (database switch); an unreadable switch hides the link.
    const conversationLink = await client.rpc("admin_conversation_read_enabled").then(r => r.data === true, () => false);
    const nurseVisits = await nurseVisitRead;
    const isTest = await testRead;
    // Administrators never read clinical evidence, so an unproven pilot state stays an outage for them.
    return <div className="mx-auto max-w-3xl space-y-6"><header className="space-y-2"><p className="text-caption text-muted-foreground">{t("Member arrangements","Անդամի պայմանավորվածություններ","Договоренности с участником")}</p><h1 className="text-h1">{pilot?.workspace.member.name || t("Member","Անդամ","Участник")}{isTest&&<> <TestAccountBadge/></>}</h1><p className="break-all text-caption text-muted-foreground">{t("Member reference","Անդամի հղում","Идентификатор участника")}: {id}</p>{conversationLink&&<p><Link href={`/staff/real/conversations/${id}` as Route} className="inline-flex min-h-11 items-center gap-2 text-body2 font-semibold underline underline-offset-4"><MessagesSquare className="size-4" aria-hidden/>{t("Conversation (read-only)","Զրույց (միայն դիտելու համար)","Разговор (только чтение)")}</Link></p>}</header><section aria-labelledby="member-contact" className="space-y-2 rounded-xl border bg-background p-4 sm:p-5"><h2 id="member-contact" className="text-h3">{t("Contact","Կապ","Контакты")}</h2><MemberContactLine contact={contacts ? contacts[id] : null}/></section><section aria-labelledby="test-account" className="space-y-3 rounded-xl border bg-background p-4 sm:p-5"><h2 id="test-account" className="text-h3">{t("Test account","Փորձնական հաշիվ","Тестовая учетная запись")}</h2>{isTest&&<TestAccountResetButton memberId={id} name={pilot?.workspace.member.name ?? null} action={resetTestAccount}/>}<TestAccountFlagForm memberId={id} isTest={isTest} action={setTestAccount}/></section><UploadOverrideNotice rows={await readUploadOverrides(client as never,id)} locale={locale}/>{labResults!==undefined&&<LabResultsCard items={resultsCardItems(labResults,id)} locale={locale}/>}{await safetyPanel()}{visitsFor(pilotData)}<NurseVisitRecordPanel data={nurseVisits} locale={locale}/>{bpPanel}<RealStaffBooking requests={bookingRequests} locale={locale} /><RealCoordinationTasks {...coordination} caseId={id} locale={locale}/>{labResults!==undefined&&<LabAiResults data={labResults} locale={locale}/>}</div>;
  }
  const reads = clinical!;
  const response = await reads.snapshot;
  if (response.error) { if (response.error.code === "42501") notFound(); throw Error("Member evidence is unavailable. Please try again."); }
  const coordination = await coordinationRead;
  const bookingRequests = await bookingRead;
  const [bpWeek, medicinesRead, medicineReasons] = await Promise.all([reads.bpWeek, reads.medicines, reads.medicineReasons]);
  const snapshot = snapshotSchema.parse(response.data);
  // QA 174: required laboratory results can be received from a clinic lab result a doctor confirmed.
  const clinicLab = doctor ? await readClinicLabSources(client as never, id) : null;
  const requiredEvidence = doctor ? await readRequiredEvidenceSources(client as never, id) : null;
  // Plans with several medicines (dark): both switches on. An unreadable review keeps the editor and closes publishing.
  const regimenRead = doctor && multiMedicineEnabled() ? await readDoctorRegimenReview(client as never, id).catch(() => null) : undefined;
  const regimenOn = regimenRead !== undefined && regimenRead?.enabled !== false;
  const regimenReview = regimenOn ? regimenRead : undefined;
  const evidence = snapshot.evidence;
  // A hold in the stored evidence must show even when the booking source or pilot read failed.
  const hold = evidenceClinicalHold(snapshot);
  const visits = visitsFor(pilotData ? withClinicalHold(pilotData, hold) : undefined, hold);
  let visitData:Awaited<ReturnType<typeof readVisitEvidence>>|null=null;
  try{visitData=await reads.visit;}catch(error){
    unstable_rethrow(error);
    if(typeof error==='object'&&error!==null&&'code'in error&&error.code==='42501')notFound();
  }
  const visitEvidence=visitData?<RealVisitEvidence data={visitData} locale={locale} actorScope={actorScope} canRecord={identity.role==='nurse'} visitId={crypto.randomUUID()} openSubmissionId={crypto.randomUUID()} appendSubmissionId={crypto.randomUUID()} commandAction={recordRealVisitEvidence.bind(null,id)} refreshAction={refreshRealVisitEvidence.bind(null,id)}/>:<CareSection title={t("Visit evidence","Այցի տվյալներ","Данные визита")}><p role="status" className="text-body2">{t("Visit evidence is unavailable. Reload to check the saved records.","Այցի տվյալներն անհասանելի են։ Թարմացրեք էջը՝ պահպանված գրառումները ստուգելու համար։","Данные визита недоступны. Обновите страницу, чтобы проверить сохраненные записи.")}</p></CareSection>;
  let labData:Awaited<ReturnType<typeof readLabStages>>|null=null;
  try{labData=await reads.lab;}catch(error){unstable_rethrow(error);}
  const labPanel=labData?<RealLabStages data={labData} locale={locale} role={doctor?'doctor':'nurse'} submissionIds={Object.fromEntries(labData.samples.flatMap(sample=>labStages.map(stage=>[`${sample.entryId}:${stage}`,crypto.randomUUID()])))} commandAction={recordRealLabStage.bind(null,id)}/>:<CareSection title={t("Sample stages","Նմուշների ընթացքը","Этапы обработки образцов")}><p role="status" className="text-body2">{t("Sample stages are unavailable. Reload to check them.","Նմուշների ընթացքն անհասանելի է։ Թարմացրեք էջը՝ ստուգելու համար։","Этапы обработки образцов недоступны. Обновите страницу, чтобы проверить их.")}</p></CareSection>;
  // B5 document release (dark): assigned doctor only; the database enforces scope.
  const [documents, versions, lab] = reads.completion ? await reads.completion : [null, null, undefined];
  // Staff copy follows the database switch; an unreadable switch keeps the copy shown.
  const completionShown = completion && documents?.enabled !== false;
  const documentPanel = !completion ? null : documents ? <MemberDocuments data={documents} memberId={id} locale={locale} submissionIds={Object.fromEntries(documents.documents.flatMap(doc => (["release","withdraw"] as const).map(action => [`${doc.fileId}:${action}`, crypto.randomUUID()])))} command={recordMemberDocumentRelease.bind(null, id)} lab={lab} /> : <CareSection title={t("Lab documents for this member","Անդամի լաբորատոր փաստաթղթերը","Лабораторные документы участника")}><p role="status" className="text-body2">{t("Lab documents are unavailable. Reload to check them.","Լաբորատոր փաստաթղթերն անհասանելի են։ Թարմացրեք էջը՝ ստուգելու համար։","Лабораторные документы недоступны. Обновите страницу, чтобы проверить их.")}</p></CareSection>;
  // Member-reported earlier results: assigned doctor only in the UI; RLS enforces the scope.
  const labResults = labResultsRead ? await labResultsRead : undefined;
  const memberUploads = doctor ? <MemberUploads data={await reads.history} memberId={id} locale={locale} ai={labResults} approval={labResults?.enabled ? { data: await readMemberUploadApprovals(client, id), memberId: id, approve: approveMemberUpload } : undefined} /> : null;
  const resultsCard = labResults !== undefined ? <LabResultsCard items={resultsCardItems(labResults, id)} locale={locale} /> : null;
  const latest = snapshot.publications?.[0];
  const aiPlan = reads.aiPlan ? await reads.aiPlan : null;
  const aiOn = aiPlan?.enabled ? aiPlan : null;
  // The newest reviewed eGFR the page already holds, for the plan form's medicine checks; the doctor can type one otherwise.
  const latestEgfr = aiOn?.labValues.filter(v=>v.catalogueRef==="egfr"&&v.value!==null&&(v.status==="verified"||v.status==="corrected")).sort((a,b)=>(b.collectedOn??"").localeCompare(a.collectedOn??""))[0]?.value ?? null;
  const aiGeneration = aiOn?.latest ?? null;
  // Current only on the same case evidence AND the same lab values and review states (Codex #280 F2).
  const aiCurrent = !!aiGeneration && !!aiOn && aiGeneration.evidenceToken === snapshot.evidenceToken && aiGeneration.labToken === aiOn.labToken && aiGeneration.caseRevision <= snapshot.revision;
  const proposedConsultation = (aiCurrent ? consultationProposal(snapshot.review?.engine.urgency,aiGeneration?.items.find(item=>item.source?.kind==='rule'&&item.source.ref==='consultation-window')?.timing) : null) ?? clinicalConsultationProposal(snapshot,locale);
  const aiPrepare = aiOn && !aiOn.published && !latest ? <AiPlanPrepare locale={locale} memberId={id} reviewed={aiOn.labValues.filter(v=>v.status==='verified'||v.status==='corrected').length} unreviewed={aiOn.labValues.filter(v=>v.status==='unverified').length} autoConfirmed={aiOn.labValues.filter(v=>v.status==='auto_accepted').length} prepared={aiCurrent} /> : null;
  const safetySection = await safetyPanel();
  const firstNote = reads.firstNote ? await reads.firstNote : null;
  const firstNoteOn = firstNote?.enabled ? firstNote : null;
  let firstNotePanel = null;
  if (firstNoteOn && (firstNoteOn.note || (!firstNoteOn.planActive && !firstNoteOn.urgent && firstNoteOn.completedAt))) {
    // The prepared text: rules-engine findings in fixed wording, and the booked visit when there is one.
    const draft = firstNoteOn.note ? null : prepareFirstNote({ answers: (evidence.assessment?.answers ?? {}) as Answers, completedAt: evidence.assessment?.completed_at ?? null,
      urgentRule: evidence.assessment?.urgent_rule ?? null, firstName: evidence.profile.name?.split(" ")[0] || null, ...firstNoteNext(pilotData?.appointments) });
    firstNotePanel = <FirstNotePanel key={evidence.assessment?.revision ?? 0} data={firstNoteOn} draft={typeof draft === "string" ? null : draft} assessmentRevision={evidence.assessment?.revision ?? 0} memberId={id} locale={locale} submissionId={crypto.randomUUID()} approve={approveFirstNote} now={new Date().toISOString()} />;
  }
  const ldl = reads.ldl ? await reads.ldl : undefined;
  // A failed read shows nothing, as for the first note: the switch cannot be known, and the feature stays dark.
  const ldlPanel = ldl?.enabled ? <LdlGoalPanel data={ldl} memberId={id} locale={locale} actions={{addEvent:addLdlEvent,removeEvent:removeLdlEvent,addTherapy:addLdlTherapy,endTherapy:endLdlTherapy,setGoal:setLdlGoal,cancelRetest:cancelLdlRetest}} /> : null;
  const urgent = reads.urgent ? await reads.urgent.catch(() => ({ alerts: [], window: null, incomplete: true })) : null;
  const lipidRead = reads.lipidPlanner ? await reads.lipidPlanner : null;
  const lipidPlan = lipidRead?.enabled ? buildLipidPlan(lipidRead) : null;
  const lipidPanel = lipidPlan ? <LipidPlanCard plan={lipidPlan} locale={locale} /> : null;
  // GP report (dark): assigned doctor only; the database switch and assignment decide.
  const gp = reads.gp ? await reads.gp : null;
  const resultsBlock = gp?.status==='ready'?resultsBlockFromReport(gp):null;
  // When the latest approval covers exactly the current records, the preview is that approved version.
  const gpApproved = gp?.status === 'ready' ? gp.read.versions.find(v => v.sourceToken === gp.read.token) ?? null : null;
  const gpFrozenCandidate = gpApproved ? await readApprovedGpReport(client as unknown as GpRpc, id, gpApproved.version) : null;
  const gpFrozen = gp?.status==='ready'&&Boolean(gpFrozenCandidate?.report.results)===Boolean(gp.report.results)?gpFrozenCandidate:null;
  // Programme rhythm (dark): assigned doctor only; the database switch and assignment decide.
  const programme = doctor ? await readDoctorMember(client as unknown as ProgrammeRpc, id) : null;
  const programmePanel = programme?.enabled ? <ProgrammePanel data={programme} memberId={id} locale={locale} submissionId={crypto.randomUUID()} confirm={confirmProgrammePlan} /> : null;
  // Keyed by the report token: a changed report remounts the panel, so an approval tick never carries over (review item 11).
  const gpPanel = !gp || gp.status === 'off' ? null : gp.status === 'ready' ? <GpReportPanel resultsBlock={resultsBlock?.status==='ready'?resultsBlock:undefined} key={gp.read.token} memberId={id} locale={locale} token={gp.read.token} submissionId={crypto.randomUUID()} blocks={{hy:languageBlocks(gpFrozen?.report??gp.report,gpFrozen?.approval??null,'hy'),en:languageBlocks(gpFrozen?.report??gp.report,gpFrozen?.approval??null,'en')}} versions={gp.read.versions} currentApproved={gpFrozen?.approval.version ?? null} approve={approveMemberGpReport} /> : <CareSection title={t("GP report","Բժշկի հաշվետվություն","Отчет врача")}><p role="status" className="text-body2">{t("The GP report is unavailable. Reload to check it.","Բժշկի հաշվետվությունն անհասանելի է։ Թարմացրեք էջը՝ ստուգելու համար։","Отчет врача недоступен. Обновите страницу, чтобы проверить его.")}</p></CareSection>;
  return <PublishConfirmationProvider><CaseSections>
    {doctor&&doctorChatV2Enabled()&&<Link href={`/staff/real/doctor-chat-v2/patient/${id}` as Route} className="inline-flex min-h-11 items-center text-body2 font-semibold underline">{t("Open chat","Բացել զրույցը","Открыть чат")}</Link>}
    <header className="space-y-2"><p className="text-caption text-muted-foreground">{t("Assigned member","Կցված անդամ","Назначенный участник")} · {doctor ? t("doctor","բժիշկ","врач") : t("nurse","բուժքույր","медсестра")}</p><h1 className="text-h1">{evidence.profile.name || t("Member","Անդամ","Участник")}{await testRead&&<> <TestAccountBadge/></>}</h1><p className="text-caption text-muted-foreground">{t("Born","Ծնվել է","Дата рождения")} {evidence.profile.birthDate ? calendarDate(evidence.profile.birthDate, locale) : t("not recorded","չի գրանցվել","не записано")} · {sexLabel(evidence.profile.biologicalSex, locale)}</p></header>
    {nurseChatEnabled()&&<Link href={(doctor?`/staff/real/conversations/${id}`:`/staff/real/nurse-chat?member=${id}`) as Route} className="inline-flex min-h-11 items-center gap-2 text-body2 font-semibold underline underline-offset-4"><MessagesSquare className="size-4" aria-hidden/>{t('Open member conversation','Բացել անդամի զրույցը','Открыть разговор с участником')}</Link>}
    {urgent&&<MemberUrgentSection urgent={urgent} locale={locale}/>}
    <CaseTabs nurse={!doctor} locale={locale} gpReport={Boolean(gpPanel)} />
    <CasePanel name="overview">
      {firstNotePanel}
      {ldlPanel}
      {lipidPanel}
      {aiPrepare}
      {resultsCard}
      {safetySection}
      {visits}
      <NurseVisitRecordPanel data={await nurseVisitRead} locale={locale}/>
      {visitEvidence}
      {!doctor && <VisitChecklist visit={visitData?.visits[0]} locale={locale} />}
      {labPanel}
      <UploadOverrideNotice rows={await readUploadOverrides(client as never,id)} locale={locale}/>
      {documentPanel}
      {memberUploads}
      {bpPanel}
      <BpWeekMedicinesPanels week={bpWeek} medicines={medicinesRead} reasons={medicineReasons} memberId={id} locale={locale} now={new Date()} />
      <RealStaffBooking requests={bookingRequests} locale={locale} />
      {evidence.assessment?.urgent_rule && <p role="alert" className="rounded-lg border border-destructive p-4">{t("Urgent guidance is active.","Գործում է շտապ ուղեցույց։","Действуют срочные рекомендации.")}</p>}
      <CareSection title={t("Review status","Վերանայման կարգավիճակ","Статус проверки")}><dl className="grid gap-4 sm:grid-cols-3"><div><dt className="text-caption text-muted-foreground">{t("Questionnaire","Հարցաշար","Анкета")}</dt><dd className="text-body2">{evidence.assessment?.completed_at ? t("Completed","Ավարտված է","Завершена") : t("Incomplete","Ավարտված չէ","Не завершена")}</dd></div><div><dt className="text-caption text-muted-foreground">{t("Source reports","Աղբյուր հաշվետվություններ","Исходные отчеты")}</dt><dd className="text-body2">{t(`${evidence.reports.length} recorded`,`Գրանցված՝ ${evidence.reports.length}`,`Записано: ${evidence.reports.length}`)}</dd></div><div><dt className="text-caption text-muted-foreground">{t("Blood pressure readings","Ճնշման չափումներ","Измерения давления")}</dt><dd className="text-body2">{bpObservationCounts(evidence.measurements,locale)}</dd></div></dl></CareSection>
      <CareSection title={t("Published care","Հրապարակված խնամք","Опубликованный план лечения")}>{latest ? <><p className="text-body2">{t("Published","Հրապարակվել է","Опубликовано")} {stamp(latest.publishedAt, locale)}</p><details><summary className="min-h-11 cursor-pointer text-body2">{t("Published instructions","Հրապարակված ցուցումներ","Опубликованные указания")}</summary><p className="whitespace-pre-wrap text-body2">{latest.draft.instructions}</p></details>{regimenReview?.versions[0]?.current && <section className="pt-2"><h3 className="text-body2 font-medium">{t("Medicines in the published plan","Հրապարակված պլանի դեղերը","Лекарства в опубликованном плане")}</h3>{regimenReview.versions[0].medicines.length ? <RegimenList medicines={regimenReview.versions[0].medicines} /> : <p className="text-body2">{t("No medicines in this version.","Այս տարբերակում դեղեր չկան։","В этой версии нет лекарств.")}</p>}</section>}</> : <p className="text-body2">{t("No care plan published.","Խնամքի պլան դեռ հրապարակված չէ։","План лечения еще не опубликован.")}</p>}</CareSection>
    </CasePanel>
    <CasePanel name="results">
      <CareSection title={t("Questionnaire evidence","Հարցաշարի տվյալներ","Данные анкеты")}><details><summary className="min-h-11 cursor-pointer text-body2">{t("Recorded answers","Գրանցված պատասխաններ","Записанные ответы")} ({Object.keys(evidence.assessment?.answers || {}).length})</summary><dl className="divide-y">{Object.entries(evidence.assessment?.answers || {}).map(([key, value]) => <div key={key} className="py-3"><dt className="text-caption text-muted-foreground">{fieldById(key)?.label[locale] || key}</dt><dd className="break-words text-body2">{answerText(key, value, locale)}</dd></div>)}</dl></details></CareSection>
      <CareSection title={t("Recorded measurements","Գրանցված չափումներ","Записанные измерения")}><p className="text-caption text-muted-foreground">{bpObservationCounts(evidence.measurements,locale)}</p>{evidence.measurements.length ? <ul className="divide-y">{evidence.measurements.map(m => <li key={m.id} className="py-3 text-body2">{m.systolic}/{m.diastolic} {bpUnit(locale)} · {t("Pulse","Զարկերակ","Пульс")} {m.pulse ?? t("not recorded","չի գրանցվել","не записано")} · {stamp(m.measured_at, locale)}{isUnverifiedBp(m)&&<> · {unverifiedBpLabel(locale)}</>}</li>)}</ul> : <p className="text-body2">{t("No measurements recorded.","Չափումներ գրանցված չեն։","Измерения не записаны.")}</p>}</CareSection>
      {bpData?.readings&&<BpReadingsHistory readings={bpData.readings} locale={locale}/>}
      {!doctor && <CareSection title={t("Source evidence","Աղբյուր փաստաթղթեր","Исходные документы")}>{evidence.reports.length ? <ul className="divide-y">{evidence.reports.map((report, i) => <li key={report.id} className="py-3 text-body2"><a className="inline-flex min-h-11 items-center underline" href={`/staff/real/members/${id}/reports/${report.id}`} target="_blank" rel="noreferrer">{t(`Open report ${i + 1}`,`Բացել հաշվետվություն ${i + 1}`,`Открыть отчет ${i + 1}`)}</a><span className="ml-3 text-caption text-muted-foreground">{report.state}</span></li>)}</ul> : <p className="text-body2">{t("No reports recorded.","Հաշվետվություններ գրանցված չեն։","Отчеты не записаны.")}</p>}</CareSection>}
      {doctor && <RealReviewControls reviewCurrent={currentClinicalReview(snapshot,identity.id)} draftCurrent={!aiOn||currentAiDraft(snapshot,aiOn)} urgent={!!urgent?.window||!!urgent?.alerts.some(a=>a.priority==='urgent')||!!evidence.assessment?.urgent_rule} key={`${snapshot.revision}:${snapshot.evidenceToken}`} snapshot={snapshot} clinicLab={clinicLab} requiredEvidence={requiredEvidence} requestId={crypto.randomUUID()} section="evidence" completion={completionShown} locale={locale} />}
    </CasePanel>
    {doctor && <CasePanel name="review"><RealReviewControls consultationProposal={proposedConsultation} reviewCurrent={currentClinicalReview(snapshot,identity.id)} draftCurrent={!aiOn||currentAiDraft(snapshot,aiOn)} urgent={!!urgent?.window||!!urgent?.alerts.some(a=>a.priority==='urgent')||!!evidence.assessment?.urgent_rule} key={`${snapshot.revision}:${snapshot.evidenceToken}`} snapshot={snapshot} clinicLab={clinicLab} requiredEvidence={requiredEvidence} requestId={crypto.randomUUID()} section="treatment" completion={completionShown} locale={locale} regimen={regimenReview} />{aiPrepare && !aiGeneration && aiPrepare}{aiGeneration && aiOn && !aiOn.published && <AiPlanPanel memberId={id} generation={aiGeneration} stale={!aiCurrent} locale={locale} />}<CareSection title={t("Treatment draft","Բուժման սևագիր","Черновик лечения")} id="treatment">{snapshot.draftStale && <p role="alert" className="text-body2">{t("Evidence or assignment changed. Review current evidence before saving again.","Տվյալները կամ նշանակումը փոխվել են։ Կրկին պահպանելուց առաջ վերանայեք ընթացիկ տվյալները։","Данные или назначение изменились. Проверьте текущие данные перед повторным сохранением.")}</p>}<DraftForm key={`${snapshot.id}:${latest?.planId??''}`} snapshot={snapshot} locale={locale} regimen={regimenOn} medicineChecks={{others:medicinesRead?.enabled?medicinesRead.self.filter(m=>!m.stoppedAt).map(m=>m.name):[],egfr:latestEgfr}} ai={aiCurrent && aiOn && !aiOn.published ? {generationId:aiGeneration!.id,values:{explanation:aiGeneration!.draft.explanation,instructions:aiGeneration!.draft.instructions,followUp:aiGeneration!.draft.followUp}} : null} /></CareSection></CasePanel>}
    <CasePanel name="followup">{programmePanel}<RealCoordinationTasks {...coordination} caseId={id} locale={locale}/><CareTasks native id={id} revision={snapshot.revision} notes={snapshot.careNotes || []} locale={locale} /></CasePanel>
    {gpPanel && <CasePanel name="gp">{gpPanel}</CasePanel>}
    <CasePanel name="history"><CareSection title={t("Published versions","Հրապարակված տարբերակներ","Опубликованные версии")}>{completionShown && versions?.length ? <ol className="divide-y">{versions.map(v => <li key={v.planId} className="space-y-1 py-3"><p className="text-body2 font-medium">{t(`Version ${v.version}`,`Տարբերակ ${v.version}`,`Версия ${v.version}`)}{v.current ? ` · ${t("current","ընթացիկ","текущая")}` : ""} · {stamp(v.publishedAt, locale)}</p>{v.changeSummary && <p className="whitespace-pre-wrap break-words text-body2 text-muted-foreground">{v.changeSummary}</p>}{(() => { const regimen = regimenReview?.versions.find(r => r.planId === v.planId); return regimen && <div className="space-y-2 pt-1">{regimen.changes.length > 0 && <RegimenChanges changes={regimen.changes} locale={locale} />}<RegimenList medicines={regimen.medicines} /></div>; })()}</li>)}</ol> : latest ? snapshot.publications?.map(plan => <p key={plan.planId} className="text-body2">{stamp(plan.publishedAt, locale)}</p>) : <p className="text-body2">{t("No publication history available in this workspace.","Այս աշխատատարածքում հրապարակումների պատմություն չկա։","В этом рабочем пространстве нет истории публикаций.")}</p>}</CareSection></CasePanel>
  </CaseSections></PublishConfirmationProvider>;
}
