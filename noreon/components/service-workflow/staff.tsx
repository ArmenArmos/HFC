"use client";
import {staffDisplayText} from '@/lib/staff/display-text';
import {ReviewTaskPanel,ReviewTaskHistory} from "./review-task-panel";
import {emptyMonitoring} from "@/lib/service-workflow/follow-up";
import {sameReportContent} from "@/lib/service-workflow/report-associations";
import {buildCaseLedger} from "@/lib/service-workflow/evidence-ledger";
import {localReportReviewStatus} from "@/lib/service-workflow/local-review";
import {sameReviewCoverage} from "@/lib/service-workflow/review-task";
import { CareHistory } from "@/components/patient-care/care-history";
import { bookingApplies } from "@/lib/service-workflow/reconciliation";
import { toast } from "sonner";
import { CasePanel, CaseTabs, CaseSectionButton } from "@/components/staff/case-sections";
import { publicationBlockers } from "@/lib/service-workflow/publication";
import { useState } from "react";
import Link from "next/link";
import type {
  ServiceWorkflow,
  TreatmentDraft,
} from "@/lib/service-workflow/types";
import type {
  PatientProfile,
  AssessmentDraft,
  Measurement,
} from "@/lib/patient/types";
import { workflowCare } from "@/lib/service-workflow/model";
import { fieldById } from "@/lib/clinical/seed/questions";
import { evaluate } from "@/lib/clinical/rules/engine";
import { CareSection, stamp, Status } from "@/components/patient-care/common";
import {
  ActionError,
  buttonClass,
  quietClass,
  inputClass,
  useWorkflowCommand,
} from "./shared";
import { CaseSummary } from "./case-summary";
import { automaticCareDraftAllowed, prepareCarePlanDraft } from "@/lib/service-workflow/care-plan-draft";
import { fictionalResultStatus, questionnaireEvidenceStatus } from "@/lib/service-workflow/review-copy";
import { DoctorReports } from "./doctor-reports";
import { useDemoReports } from "./reports-provider";
const evidenceLabels: Record<string, string> = {
  assessment: "Questionnaire updated", measurements: "Blood pressure readings updated",
  profile: "Member details updated", consent: "Consent updated", tests: "Recommended tests updated",
  requirements: "Current test requirements changed", receipts: "Applicable test receipts changed", pending: "Questionnaire completion changed",
  received: "Received test results updated", allResultsAt: "Results completion updated",
};
function evidenceChangeLabel(kind: string, id: string | null, reports: { id: string; file_name: string }[]) {
  if (kind.startsWith("report.")) {
    const name = reports.find(r => r.id === id)?.file_name;
    return `${name ?? "An imported report"} ${kind === "report.deleted" ? "removed" : "updated"}`;
  }
  return evidenceLabels[kind] ?? "Review evidence updated";
}
export function DoctorWorkspace({
  workflow: initialWorkflow,
  profile: initialProfile,
  assessment: initialAssessment,
  measurements: initialMeasurements,
  care: initialCare,
  reviewTasks: initialReviewTasks = [],
}: {
  workflow: ServiceWorkflow;
  profile: PatientProfile;
  assessment: AssessmentDraft | null;
  measurements: Measurement[];
  care?: import("@/lib/patient/demo-model").DemoState["care"];
  reviewTasks?: import("@/lib/service-workflow/review-task").ReviewTask[];
}) {
  const { reports, approvals, publish, shared, loaded, persistenceError, snapshot, reportEvidenceRevision, reportEvidenceSession, refresh } = useDemoReports();
  const w = snapshot?.state.workflow ?? initialWorkflow;
  const profile = snapshot?.state.state.profile ?? initialProfile;
  const assessment = snapshot ? snapshot.state.state.assessment : initialAssessment;
  const measurements = snapshot?.state.measurements ?? initialMeasurements;
  const care = snapshot?.state.care ?? initialCare;
  const { run, pending, activeCommand, error } = useWorkflowCommand(w);
  const [edited, setEdited] = useState<{ draft: TreatmentDraft; evidenceKey: string } | null>(null);
  const monitoring=snapshot?.monitoring??emptyMonitoring;
  const activeMonitoring=monitoring.requirements.filter(r=>r.status==='active');
  const [monitoringChoices,setMonitoringChoices]=useState<Record<string,'retain'|'supersede'|''>>({});
  const selectedMonitoring=activeMonitoring.flatMap(r=>{
    const decision=monitoringChoices[r.id]??monitoring.decisions.find(d=>d.requirement_id===r.id)?.decision;
    return decision?[{requirementId:r.id,decision}]:[];
  });
  const monitoringSaved=activeMonitoring.every(r=>{
    const saved=monitoring.decisions.find(d=>d.requirement_id===r.id);
    return saved&&saved.evidence_revision===(w.evidenceRevision??0)&&saved.publication_version===w.publication?.version&&sameReportContent(saved.draft,w.draft)&&saved.decision===selectedMonitoring.find(d=>d.requirementId===r.id)?.decision;
  });
  const [preview, setPreview] = useState(false);
  const [errorArea, setErrorArea] = useState<"consultation" | "draft" | "">("");
  function runDoctorCommand(
    area: "consultation" | "draft",
    command: Parameters<typeof run>[0],
    done?: () => void,
  ) {
    setErrorArea(area);
    if(command.type==="save-draft"&&shared) command={...command,monitoringDecisions:selectedMonitoring};
    const withEvidence = command.type === "save-draft" || command.type === "publish" ? {...command, evidenceRevision:w.evidenceRevision ?? 0, reportEvidenceRevision: shared ? 0 : reportEvidenceRevision, reportEvidenceSession: shared ? undefined : reportEvidenceSession} : command;
    run(withEvidence, async () => {
      if (shared) {
        try { if (!await refresh()) return false; } catch { return false; }
      }
      if (command.type === "save-draft") {setEdited(null);setMonitoringChoices({});}
      done?.();
      if (shared) return false;
    }, async () => {
      if (shared) await refresh().catch(() => undefined);
    });
  }
  const decision = evaluate({
    answers: assessment?.answers ?? {},
    observations: [],
  });
  const urgentOverride = !!assessment?.urgentRule || decision.urgency === "red";
  const doctor = w.doctors.find((d) => d.id === w.assignedDoctorId);
  const missing = w.tests.filter((t) => !w.receivedTestIds.includes(t.id));
  const fictionalResults = workflowCare(
    {
      ...w,
      publicationHistory: [],
      publication: {
        at: w.allResultsAt ?? w.startedAt,
        doctor: doctor?.name ?? "",
        version: 0,
        resultTestIds: w.receivedTestIds,
        draft: w.draft,
      },
    },
    [],
    false,
  ).results;
  const evidenceKey = JSON.stringify({ revision:w.evidenceRevision, reportEvidenceRevision, assessment, measurements, tests: w.tests, received: w.receivedTestIds, reports: reports.map(r => ({ id: r.id, revision: r.revision, state: r.state, reviewed: r.reviewed })), approvals: Object.entries(approvals).map(([id, a]) => ({ id, revision: a.revision })) });
  const prepared = (!shared || loaded) && !persistenceError
    ? prepareCarePlanDraft({ workflow: w, assessment, measurements, reports, approvals }) : null;
  const automaticDraft = automaticCareDraftAllowed(w) ? prepared : null;
  const draft = edited?.draft ?? automaticDraft ?? w.draft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(w.draft);
  const staleDraft = !!edited && edited.evidenceKey !== evidenceKey;

  const questionnaireComplete = !!assessment?.completedAt;
  const reportDataReady = !shared || (loaded && !!snapshot);
  const reportCount = reports.length;
  const checkedReportCount = reports.filter(
    (r) => approvals[r.id]?.revision === r.revision,
  ).length;
  const unchecked = reports.some(
    (r) => !approvals[r.id] || approvals[r.id].revision !== r.revision,
  );
  const consultationDone =
    w.consultation !== "undecided" &&
    (w.consultation !== "required" || w.appointment?.status === "completed");
  const testsDone =
    missing.length === 0 && (w.tests.length === 0 || !!w.allResultsAt);
  const domainBlockers = publicationBlockers({workflow:w, questionnaireComplete:!shared || questionnaireComplete, urgent:urgentOverride, reportsReady:!unchecked, reportEvidenceRevision:shared ? 0 : reportEvidenceRevision, reportEvidenceSession:shared ? undefined : reportEvidenceSession});
  const ready = domainBlockers.length === 0 && !dirty && !staleDraft && reportDataReady && !persistenceError;
  const reviewTasks=shared ? snapshot?.reviewTasks??[] : initialReviewTasks;
  const reviewTask=reviewTasks.find(t=>t.status==='open');
  const browserReview=localReportReviewStatus(w.publication,reportEvidenceSession,reportEvidenceRevision);
  const currentCoverage={reports:reports.map(r=>({id:r.id,revision:r.revision,approval:approvals[r.id]??null})),
    receipts:(w.receiptHistory??[]).filter(r=>w.requirements?.some(q=>q.requirementId===r.requirementId&&q.retiredAtRevision===null)).map(r=>({requirementId:r.requirementId,receivedAt:r.receivedAt}))};
  const noChangeBlocker=!ready ? (domainBlockers[0]?.message || 'Save the current reviewed draft first.')
    : !w.publication ? 'Publish the initial care plan first.'
    : JSON.stringify(w.draft)!==JSON.stringify(w.publication.draft) ? 'Publish the changed treatment draft.'
    : !sameReviewCoverage(w.publication.reviewCoverage,currentCoverage) ? 'Publish the changed or newly reviewed results before completing this review.' : '';
  const checklist = [
    {
      label: "Urgent guidance",
      detail: urgentOverride
        ? "Active · routine release is blocked"
        : "No red urgent guidance",
      done: !urgentOverride,
    },
    {
      label: "Questionnaire",
      detail: questionnaireComplete
        ? "Complete · review answers in the evidence section"
        : shared
          ? "Member needs to finish it"
          : "Incomplete · example case",
      done: questionnaireComplete,
    },
    {
      label: "Current tests",
      detail: !testsDone
        ? `${missing.length} result${missing.length === 1 ? "" : "s"} outstanding`
        : w.tests.length
          ? "All ordered results received"
          : "No current tests ordered",
      done: testsDone,
    },
    {
      label: "Historical reports",
      detail: !reportDataReady
        ? "Loading report history…"
        : persistenceError
          ? "Report history unavailable"
          : reportCount
            ? `${checkedReportCount} of ${reportCount} checked for plan inclusion`
            : "No imported history",
      done: reportDataReady && !persistenceError && !unchecked,
    },
    {
      label: "Consultation",
      detail:
        w.consultation === "undecided"
          ? "Decision needed"
          : w.consultation === "not-required"
            ? "Not required"
            : w.appointment?.status === "completed"
              ? "Completed"
              : "Required · not completed",
      done: consultationDone,
    },
    {
      label: "Treatment draft",
      detail: dirty ? "Unsaved changes" : w.draftSaved || w.events.some(e => e.text.endsWith("save-draft")) || w.publication ? "Saved" : "Example draft · not saved by you",
      done: !dirty && (!!w.publication || w.draftSaved || w.events.some(e => e.text.endsWith("save-draft"))),
    },
  ];
  const nextApprovalAction = staleDraft
    ? "Review the changed evidence, keep or update your text, then save it."
    : dirty
      ? "Save your review draft before continuing."
      : !doctor?.active
        ? "Ask backoffice to assign an active GP to this case."
        : urgentOverride
          ? "Follow the urgent guidance before routine review."
          : shared && !questionnaireComplete
            ? "The member needs to finish the health questions."
            : !testsDone
              ? "Ask backoffice to record the outstanding test results."
              : !reportDataReady || persistenceError
                ? "Wait for report history to load, or refresh if it could not load."
                : unchecked
                  ? "Open each historical report, check its results and include it in publication."
                  : w.consultation === "undecided"
                    ? "Choose whether a consultation is required."
                    : !consultationDone
                      ? w.appointment?.status === "scheduled"
                        ? "After the consultation, select Record consultation completed."
                        : "Arrange and complete the required consultation."
                      : "";
  const memberMustFinish = shared && !questionnaireComplete;
  function edit(key: keyof TreatmentDraft, value: string) {
    setPreview(false);
    setEdited({ evidenceKey: edited?.evidenceKey ?? evidenceKey, draft: {
      ...draft,
      [key]:
        key === "medicationTimes"
          ? value
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
          : value,
    } });
  }
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-caption text-muted-foreground">Assigned member</p>
          <h1 className="text-h1">{profile.name}</h1>
          <p className="mt-2 text-body2 text-muted-foreground">
            Assigned to {doctor?.name ?? "no active GP"}.
          </p>
        </div>
        <Status>
          {shared && !questionnaireComplete
              ? "Questionnaire incomplete"
              : urgentOverride
                ? "Urgent guidance active"
                : w.publication
                  ? `Published version ${w.publication.version}`
              : !assessment?.completedAt && !w.tests.length
              ? "Questionnaire in progress"
              : missing.length
              ? "Waiting for results"
              : "Ready for review"}
        </Status>
      </header>
      <nav aria-label="Case navigation" className="flex flex-wrap gap-3">
        <Link className={quietClass} href="/staff/doctor">Back to case list</Link>

      </nav>
      <CaseTabs />
      {!shared&&<CasePanel name="overview"><p className="rounded-md border p-4 text-body2">Monitoring requirements are available in the shared demo.</p></CasePanel>}
      <CasePanel name="overview">
      <CareSection
        title="Review status"
      >
        <ul className="grid grid-cols-2 gap-x-5 gap-y-3 xl:grid-cols-3" aria-label="Case review status">
          {checklist.map((item) => (
            <li key={item.label} className="border-b pb-3">
              <p className="text-body2 font-medium">
                <span aria-hidden="true">{item.done ? "✓ " : "○ "}</span>
                {item.label}
              </p>
              <p className="mt-1 text-caption text-muted-foreground">{item.detail}</p>
            </li>
          ))}
        </ul>
        {memberMustFinish && (
          <p role="status" className="rounded-md bg-muted p-3 text-body2">
            The member must finish the questionnaire before you can record a consultation decision or edit the shared treatment draft. You cannot complete it from the doctor workspace.
          </p>
        )}
        {urgentOverride && (
          <p role="status" className="rounded-md bg-muted p-3 text-body2">
            Urgent questionnaire guidance is active. Routine publication and consultation completion are unavailable. Follow the urgent guidance shown in the member workspace.
          </p>
        )}
        {shared && !loaded && (
          <p role="status" className="text-body2">Loading historical reports before publication can be approved.</p>
        )}

      </CareSection>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5" aria-label="Next action">
        <div className="max-w-2xl"><p className="text-caption font-semibold text-brand-teal">Next action</p><p className="mt-1 text-body2">{nextApprovalAction || "Preview the saved plan and publish when all requirements are met."}</p></div>
        <CaseSectionButton name={memberMustFinish || urgentOverride || unchecked || !testsDone || !reportDataReady ? "results" : "review"}>{memberMustFinish || urgentOverride || unchecked || !testsDone || !reportDataReady ? "Review evidence" : "Open treatment plan"}</CaseSectionButton>
      </section>
      </CasePanel>
        {persistenceError && (
          <div role="alert" className="space-y-2 rounded-md border border-destructive bg-destructive/10 p-3 text-body2">
            <p>{persistenceError} Your draft edits are kept here.</p>
            <button type="button" className={quietClass} disabled={!loaded} onClick={() => void refresh().catch(() => undefined)}>Retry loading evidence</button>
          </div>
        )}
      {dirty && (
        <p role="status" className="rounded-md bg-muted p-3 text-body2">
          You have unsaved review changes. Save the draft before leaving this
          workspace.
        </p>
      )}
      <div className="space-y-6">
        <div className="space-y-6">
          <CasePanel name="results">
          <CareSection
            title="Questionnaire findings"
            detail={questionnaireEvidenceStatus(w)}
          >
            <p className="text-caption">Source: {staffDisplayText(decision.algorithmVersion,'en')}</p>
            {decision.findings.length === 0 && (
              <p className="text-body2">
                No findings are available from the answers recorded so far.
              </p>
            )}
            {decision.findings.map((f) => (
              <article
                key={`${f.ruleId}-${f.triggeredBy}`}
                className="border-l-2 border-brand-teal pl-4"
              >
                <p className="text-body2 font-medium">
                  {f.reason.en ?? f.reason.hy}
                </p>
                <p className="mt-1 text-caption text-muted-foreground">
                  {staffDisplayText(f.urgency,'en')}
                </p>
                {f.source && <p className="text-caption">{staffDisplayText(f.source,'en')}</p>}
              </article>
            ))}
            <details>
              <summary className="cursor-pointer text-body2 font-medium">
                Source questionnaire answers (
                {Object.keys(assessment?.answers ?? {}).length})
              </summary>
              <dl className="mt-4 space-y-3">
                {Object.values(assessment?.answers ?? {}).map((a) => (
                  <div
                    id={`answer-${a.fieldId}`}
                    key={a.fieldId}
                    className="border-b pb-2"
                  >
                    <dt className="text-caption text-muted-foreground">
                      {fieldById(a.fieldId)?.label.en ??
                        fieldById(a.fieldId)?.label.hy ??
                        a.fieldId}
                    </dt>
                    <dd className="break-words text-body2">
                      {Array.isArray(a.value)
                        ? a.value.join(", ")
                        : String(a.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </CareSection>
          <CareSection title="Recorded measurements">
            {measurements.length === 0 ? (
              <p className="text-body2 text-muted-foreground">
                No manual readings recorded.
              </p>
            ) : (
              measurements.slice(0, 10).map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap justify-between gap-2 border-b pb-3"
                >
                  <p className="text-body2 font-medium">
                    {m.systolic}/{m.diastolic} mmHg{" "}
                    {m.pulse ? `, pulse ${m.pulse}` : ""}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {stamp(m.measuredAt, "en")}
                  </p>
                </div>
              ))
            )}
          </CareSection>
          </CasePanel>
          <CasePanel name="results">
          <CareSection
            title="Current test results"
            detail="Demo results. Each row shows whether it is included in the published plan. Missing reference ranges stay unknown."
          >
            {fictionalResults.length === 0 ? (
              <p className="text-body2 text-muted-foreground">
                No numeric results yet. Some ordered checks have no demo value.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-body2">
                  <thead>
                    <tr className="border-b">
                      <th className="py-3 pr-4">Marker</th>
                      <th className="py-3 pr-4">Result</th>
                      <th className="py-3 pr-4">Publication</th>
                      <th className="py-3">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fictionalResults.map((r) => (
                      <tr key={r.id} className="border-b">
                        <td className="py-3 pr-4 font-medium">{r.marker}</td>
                        <td className="whitespace-nowrap py-3 pr-4">
                          {r.value} {r.unit}
                        </td>
                        <td className="py-3 pr-4">{fictionalResultStatus(w, r.testId)}</td>
                        <td className="py-3 text-caption text-muted-foreground">
                          {r.sourceLabel}
                          <br />
                          {r.testId}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CareSection>
          <DoctorReports locale="en" doctorName={doctor?.name ?? "Unassigned GP"} memberName={profile.name} workflow={w} />
          <CareSection title="Ordered tests and receipt">
            {w.tests.map((t) => (
              <div
                key={t.id}
                className="flex items-start justify-between gap-3 border-b pb-3"
              >
                <div>
                  <p className="text-body2 font-medium">{t.title}</p>
                  <p className="text-caption text-muted-foreground">
                    {t.source}
                  </p>
                </div>
                <Status>
                  {w.receivedTestIds.includes(t.id)
                    ? "Received"
                    : "Outstanding"}
                </Status>
              </div>
            ))}
            <p className="text-caption text-muted-foreground">
              Demo receipt only. Review uploaded reports for extracted values.
            </p>
          </CareSection>
          </CasePanel>
        </div>
        <CasePanel name="review">
        <div className="space-y-6">

          <CareSection
            title="Consultation decision"
            detail="Record whether this case needs a GP consultation before the plan can be published."
          >
            {errorArea === "consultation" && <ActionError error={error} />}
            {memberMustFinish && <p className="text-body2 text-muted-foreground">The member must finish the questionnaire before you can record this decision.</p>}
            {dirty && <p className="text-body2 text-muted-foreground">Save the treatment draft below before recording this decision.</p>}
            {urgentOverride && <p className="text-body2 text-muted-foreground">Urgent guidance takes priority. You cannot mark the routine consultation complete while it is active.</p>}
            {activeCommand === "consultation" && <p role="status" className="text-body2">Saving consultation decision…</p>}
            <fieldset disabled={pending || memberMustFinish || dirty} className="space-y-3">
              {(["required", "not-required"] as const).map((value) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center gap-3 rounded-md border p-3"
                >
                  <input
                    type="radio"
                    name="consultation"
                    checked={w.consultation === value}
                    onChange={() =>
                      runDoctorCommand("consultation", { type: "consultation", decision: value })
                    }
                  />
                  {value === "required"
                    ? "Consultation required"
                    : "No consultation required"}
                </label>
              ))}
            </fieldset>
            {w.appointment ? (
              <>
                <p className="text-body2">
                  {stamp(w.appointment.at, "en")} ·{" "}
                  {w.appointment.mode} · {w.appointment.status}
                </p>
                <button
                  className={quietClass}
                  disabled={pending || dirty || memberMustFinish || urgentOverride || w.appointment.status !== "scheduled"}
                  aria-busy={activeCommand === "complete-consultation"}
                  onClick={() => runDoctorCommand("consultation", { type: "complete-consultation" })}
                >
                  {activeCommand === "complete-consultation" ? "Saving consultation…" : "Record consultation completed"}
                </button>
              </>
            ) : (
              <p className="text-body2 text-muted-foreground">
                No GP appointment arranged.
              </p>
            )}
          </CareSection>
          {!shared && <div className="space-y-2 rounded-md border p-3">
            {reviewTask && <p className="text-body2">Fictional case review pending. Review the current evidence and publish the plan to complete it.</p>}
            <p className="text-body2 text-muted-foreground">{browserReview==='changed' ? 'Report changes in this browser need review before the next publication.' : browserReview==='unavailable' ? 'Reports from an earlier browser session are not available here. Add and review the source reports again before publishing.' : browserReview==='initial' ? 'This browser-only demo completes review by publishing the reviewed plan.' : 'Browser reports match this session’s publication. Case evidence is reviewed separately.'}</p>
          </div>}
          {shared && reviewTask && snapshot && <ReviewTaskPanel task={reviewTask} caseId={snapshot.state.userId} caseRevision={snapshot.state.workspaceRevision!} evidenceRevision={w.evidenceRevision??0} blockedReason={noChangeBlocker} refresh={refresh} />}
          <CareSection
            title="Treatment draft"
            detail="Only an approved snapshot appears in the member view. Example medicines are not prescriptions."
          >
            {errorArea === "draft" && <ActionError error={error} />}
            {memberMustFinish && <p className="text-body2 text-muted-foreground">The member must finish the questionnaire before you can edit or save the shared treatment draft.</p>}
            {prepared && (
              <div className="space-y-3 rounded-md bg-muted p-4">
                <p className="text-body2">
                  {automaticDraft && !edited
                    ? "Prepared from questionnaire findings, recent blood pressure and selected checked reports."
                    : "Prepare a new draft from the current evidence."}
                </p>
                <p className="text-caption text-muted-foreground">Next steps follow the screening protocol. Medicine fields are not generated. Check the draft before approving it.</p>
                {(!automaticDraft || !!edited) && (
                  <button type="button" className={quietClass} disabled={pending || (dirty && !staleDraft)} onClick={() => {
                    const next = prepareCarePlanDraft({ workflow: { ...w, draft }, assessment, measurements, reports, approvals });
                    if (next) { setEdited({ draft: next, evidenceKey }); setPreview(false); }
                  }}>{staleDraft ? "Replace text with an updated draft" : "Prepare review draft"}</button>
                )}
              </div>
            )}
            {(staleDraft || domainBlockers.some(b => b.code === "evidence")) && <div className="space-y-2 rounded-md border p-3"><p role="alert" className="text-body2">Evidence has changed or this draft has no recorded evidence review. Your text is preserved. Check the changes before saving.</p>{snapshot?.changes.length ? <details><summary className="min-h-11 cursor-pointer text-body2">Evidence changes ({snapshot.changes.length})</summary><ul className="list-disc pl-5 text-body2">{snapshot.changes.map((c,i) => <li key={`${c.revision}:${i}`}>{evidenceChangeLabel(c.kind, c.reference_id, reports)} · {stamp(c.created_at, "en")}</li>)}</ul></details> : <p className="text-body2">Review the current questionnaire, results, reports and readings. Earlier change history may be unavailable.</p>}<button type="button" className={quietClass} disabled={pending || !reportDataReady || !!persistenceError} onClick={() => setEdited({draft,evidenceKey})}>I have reviewed this evidence, keep my draft</button></div>}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (staleDraft || !reportDataReady || persistenceError) return;
                runDoctorCommand("draft", { type: "save-draft", draft }, () => { setPreview(false); toast.success("Review draft saved. It is not yet visible to the member."); });
              }}
            >
              <fieldset className="space-y-4" disabled={pending || memberMustFinish}>
                {(
                  [
                    ["explanation", "Plain-language explanation"],
                    ["instructions", "Treatment and lifestyle instructions"],
                    ["followUp", "Follow-up plan"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} htmlFor={`review-${key}`} className="block space-y-2 text-body2">
                    <span>{label}</span>
                    <textarea
                      id={`review-${key}`}
                      className={inputClass}
                      rows={4}
                      value={draft[key]}
                      maxLength={1800}
                      onChange={(e) => edit(key, e.target.value)}
                    />
                  </label>
                ))}
                <details>
                  <summary className="cursor-pointer text-body2 font-medium">
                    Optional example medication and reminder times
                  </summary>
                  <div className="mt-4 space-y-4">
                    {(
                      [
                        ["medicationName", "Example medicine name"],
                        ["medicationDose", "Example dose"],
                        [
                          "medicationInstructions",
                          "Example medicine instructions",
                        ],
                        [
                          "medicationTimes",
                          "Reminder times, comma-separated (08:00, 20:00)",
                        ],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} htmlFor={`review-${key}`} className="block space-y-2 text-body2">
                        <span>{label}</span>
                        <input
                          id={`review-${key}`}
                          className={inputClass}
                          value={
                            Array.isArray(draft[key])
                              ? (draft[key] as string[]).join(", ")
                              : draft[key]
                          }
                          onChange={(e) => edit(key, e.target.value)}
                          maxLength={300}
                        />
                      </label>
                    ))}
                  </div>
                </details>
                {!!activeMonitoring.length&&<section className="space-y-3 rounded-lg border p-4"><h3 className="text-h3">Monitoring in the next publication</h3><p className="text-body2">Choose whether each requirement should continue unchanged or be superseded. Saving the reviewed draft records these choices together.</p>{activeMonitoring.map(r=><label key={r.id} className="block text-body2">{stamp(r.starts_at,"en")} to {stamp(r.ends_at,"en")} · {r.required_count} readings<select className={inputClass} value={selectedMonitoring.find(d=>d.requirementId===r.id)?.decision??''} onChange={e=>{const choice=e.target.value;setMonitoringChoices(old=>{const next={...old};if(choice==='retain'||choice==='supersede')next[r.id]=choice;else next[r.id]='';return next;});setPreview(false);}}><option value="">Choose an outcome</option><option value="retain">Retain this requirement unchanged</option><option value="supersede">Supersede this requirement</option></select></label>)}{!monitoringSaved&&<p className="text-body2">Save current monitoring decisions before publishing.</p>}</section>}
                <button className={buttonClass} aria-busy={activeCommand === "save-draft"} disabled={pending || !reportDataReady || !!persistenceError || staleDraft || (!dirty && monitoringSaved && !(edited && domainBlockers.some(b => b.code === "evidence")))}>
                  {activeCommand === "save-draft" ? "Saving draft…" : "Save review draft"}
                </button>
              </fieldset>
            </form>
            <div className="space-y-3 border-t pt-5">
              <p className="text-caption text-muted-foreground">
                {dirty
                  ? "Save your changes before previewing."
                  : "The saved draft below is the exact text that will be published."}
              </p>
              <details><summary className="min-h-11 cursor-pointer text-body2 font-medium">Publication requirements</summary><ul className="space-y-1 text-body2" aria-label="Publication requirements">
                {checklist.map((item) => (
                  <li key={item.label}>
                    <span aria-hidden="true">{item.done ? "✓ " : "○ "}</span>
                    {item.label}: {item.detail}
                  </li>
                ))}
              </ul></details>
              {nextApprovalAction && <p role="status" className="rounded-md bg-muted p-3 text-body2"><strong>Next action: </strong>{nextApprovalAction}</p>}
              <button
                className={quietClass}
                disabled={pending || dirty || staleDraft || memberMustFinish}
                onClick={() => setPreview(!preview)}
              >
                {preview ? "Close publication preview" : "Preview publication"}
              </button>
              {missing.length > 0 && (
                <p className="text-body2">
                  Waiting for {missing.length} test result
                  {missing.length === 1 ? "" : "s"}.
                </p>
              )}
              {w.consultation === "undecided" && (
                <p className="text-body2">
                  Record a consultation decision before publishing.
                </p>
              )}
              {w.consultation === "required" &&
                w.appointment?.status !== "completed" && (
                  <p className="text-body2">
                    Complete the required consultation before publishing.
                  </p>
                )}
              {unchecked && (
                <p className="text-body2">
                  Review uploaded reports in Results & reports before publishing.
                </p>
              )}
              {urgentOverride && (
                <p role="status" className="rounded-md bg-muted p-3 text-body2">
                  Urgent questionnaire guidance takes priority. Routine publication is blocked; follow the urgent guidance shown in the member workspace.
                </p>
              )}
              {preview && (
                <div className="space-y-4 rounded-xl bg-surface-subtle-teal p-5">
                  <h3 className="text-h3">Member publication preview</h3>
                  <p className="whitespace-pre-wrap text-body2">
                    {w.draft.explanation || "No explanation saved."}
                  </p>
                  <p className="whitespace-pre-wrap text-body2">
                    {w.draft.instructions}
                  </p>
                  <p className="whitespace-pre-wrap text-body2">
                    {w.draft.followUp}
                  </p>
                  {w.draft.medicationName && (
                    <p className="text-body2">
                      {w.draft.medicationName}{" "}
                      {w.draft.medicationDose}. {w.draft.medicationInstructions}{" "}
                      {w.draft.medicationTimes.join(", ")}
                    </p>
                  )}
                  <button
                    className={buttonClass}
                    aria-busy={activeCommand === "publish"}
                    disabled={pending || !ready || !monitoringSaved || memberMustFinish}
                    onClick={() =>
                      runDoctorCommand("draft", { type: "publish" }, () => {
                        publish(`${w.startedAt}:${w.revision + 1}`);
                        toast.success("Plan published. The member can now see the approved results and care plan.");
                        setPreview(false);
                      })
                    }
                  >
                    {activeCommand === "publish" ? "Publishing plan…" : "Approve and send to member view"}
                  </button>
                  {(!ready || !monitoringSaved) && <p role="status" className="text-body2"><strong>To enable approval: </strong>{domainBlockers[0]?.message || (!monitoringSaved ? "Save the monitoring decisions for this publication." : nextApprovalAction) || "Wait for the current action to finish."}</p>}
                  <p className="text-caption">
                    {shared ? "Publishes to the assigned client’s shared demo case and adds an in-app notification. No SMS or WhatsApp message is sent." : "Publishes in this browser only. No notification is sent."}
                  </p>
                </div>
              )}
            </div>
          </CareSection>
        </div>
        </CasePanel>
      </div>
      <CasePanel name="history"><ReviewTaskHistory tasks={reviewTasks} /><CareHistory care={workflowCare(w,care?.events ?? [],care?.acknowledgements ?? care?.acknowledged ?? false)} locale={profile.locale} /></CasePanel>
      <CasePanel name="review">
      <details className="rounded-xl border bg-background p-5"><summary className="min-h-11 cursor-pointer text-body2 font-semibold">Optional evidence review summary</summary>
      <CaseSummary evidenceLedger={buildCaseLedger({workflow:w,assessment,measurements,reports,durableMeasurements:monitoring.readings})} evidenceRevision={w.evidenceRevision??0} />
      </details></CasePanel>

    </>
  );
}
export function BackofficeWorkspace({
  workflow: w,
  profile,
}: {
  workflow: ServiceWorkflow;
  profile: PatientProfile;
}) {
  const { run, pending, error } = useWorkflowCommand(w);
  const { clear } = useDemoReports();
  const [name, setName] = useState("");
  const [reset, setReset] = useState(false);
  const missing = w.tests.filter((t) => !w.receivedTestIds.includes(t.id));
  return (
    <>
      <header>
        <h1 className="text-h1">Keep care moving</h1>
        <p className="mt-2 text-body2 text-muted-foreground">
          GP roster, assignment and review queues for {profile.name}.
        </p>
      </header>
      <ActionError error={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <CareSection
          title="GP roster"
          detail="Add a demo GP. This creates no account or clinical access."
        >
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run({ type: "add-doctor", name }, () => setName(""));
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Doctor name</span>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
                placeholder="Doctor name"
              />
            </label>
            <button className={buttonClass} disabled={pending}>
              Add GP
            </button>
          </form>
          <div className="divide-y">
            {w.doctors.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-caption text-muted-foreground">
                    {d.active ? "Active" : "Inactive"}
                    {d.id === w.assignedDoctorId
                      ? " · Assigned to this case"
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className={quietClass}
                    disabled={
                      pending || !d.active || d.id === w.assignedDoctorId
                    }
                    onClick={() => run({ type: "assign", doctorId: d.id })}
                  >
                    Assign case
                  </button>
                  <button
                    className={quietClass}
                    disabled={pending}
                    onClick={() =>
                      run({
                        type: "doctor-status",
                        doctorId: d.id,
                        active: !d.active,
                      })
                    }
                  >
                    {d.active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CareSection>
        <CareSection title="Case progress">
          <dl className="space-y-4">
            {[
              [
                "Active test bookings",
                w.bookings.filter((b) => b.status === "scheduled").length,
              ],
              ["Results outstanding", missing.length],
              ["Consultation decision", w.consultation],
              [
                "GP appointment",
                w.appointment
                  ? `${stamp(w.appointment.at, "en")} (${w.appointment.status})`
                  : "Not booked",
              ],
              [
                "Review queue",
                w.publication
                  ? "Published"
                  : w.allResultsAt
                    ? "Ready for doctor"
                    : "Waiting for results",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-4 border-b pb-3 text-body2"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </CareSection>
        <CareSection
          title="Results receipt queue"
          detail="Record a demo result. No laboratory is contacted. Book a test first."
        >
          {missing.length === 0 ? (
            <Status>All results received</Status>
          ) : (
            missing.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
              >
                <p className="text-body2">{t.title}</p>
                <button
                  className={quietClass}
                  disabled={
                    pending ||
                    !w.bookings.some(
                      (b) =>
                        bookingApplies(w,b,t.id),
                    )
                  }
                  onClick={() => run({ type: "receive", testIds: [t.id] })}
                >
                  Mark result received
                </button>
              </div>
            ))
          )}
        </CareSection>
        <CareSection title="Booking queue">
          {w.bookings.length === 0 ? (
            <p className="text-body2">No test bookings yet.</p>
          ) : (
            w.bookings.map((b) => (
              <div key={b.id} className="space-y-1 border-b pb-3">
                <p className="text-body2 font-medium">
                  {stamp(b.at, profile.locale)} · {b.mode} · {b.status}{b.review ? " · Needs review" : ""}
                </p>
                <p className="text-caption text-muted-foreground">
                  {b.testIds
                    .map((id) => b.testSnapshots?.find(t=>t.id===id)?.title ?? w.tests.find((t) => t.id === id)?.title ?? id)
                    .join(", ")}
                </p>
              </div>
            ))
          )}
        </CareSection>
      </div>
      <CareSection title="Activity history">
        <ol className="space-y-4">
          {w.events
            .slice()
            .reverse()
            .map((event, i) => (
              <li
                key={`${event.at}-${i}`}
                className="grid gap-1 border-l-2 border-brand-teal pl-4 sm:grid-cols-[12rem_1fr]"
              >
                <time className="text-caption text-muted-foreground">
                  {stamp(event.at, profile.locale)}
                </time>
                <p className="text-body2">{event.text}</p>
              </li>
            ))}
        </ol>
      </CareSection>
      <details className="rounded-xl border border-dashed p-5">
        <summary className="cursor-pointer font-medium">
          Reset demo workflow
        </summary>
        <p className="my-3 max-w-2xl text-body2">
          Clears bookings, receipt, draft and publication for this service.
          Questionnaire answers stay. Temporary reports and approvals in this
          browser tab are also cleared.
        </p>
        {reset ? (
          <div className="flex gap-3">
            <button
              className={buttonClass}
              disabled={pending}
              onClick={() =>
                run({ type: "reset" }, () => {
                  clear();
                  setReset(false);
                })
              }
            >
              Confirm service reset
            </button>
            <button className={quietClass} onClick={() => setReset(false)}>
              Keep current service
            </button>
          </div>
        ) : (
          <button className={quietClass} onClick={() => setReset(true)}>
            Reset service workflow
          </button>
        )}
      </details>
    </>
  );
}
