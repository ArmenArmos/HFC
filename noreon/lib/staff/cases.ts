import {staffVisibleState} from "./care-visibility";
import { AdmissionLimit, requestAdmissionIdentity } from '@/lib/security/admission';
import {emptyMonitoring,type MonitoringSnapshot} from "@/lib/service-workflow/follow-up";
import {reviewTaskFromRow} from './review-tasks';
import type {ReviewTask} from '@/lib/service-workflow/review-task';
import "server-only";
import { findDefaultDemoDoctor } from "./demo-assignment";
import { notFound } from "next/navigation";
import { z } from "zod";
import { workspaceAdmin } from "./admin";
import type { StaffIdentity } from "./types";
import type { DemoState } from "@/lib/patient/demo-model";
import { normalizeSharedWorkflow } from "@/lib/service-workflow/normalization";
import type { Database, Json } from "@/lib/db/types";

export type WorkspaceCase = {
  doseHistory: Database["public"]["Tables"]["workspace_dose_event_history"]["Row"][];
  monitoring: MonitoringSnapshot;
  reviewTasks: ReviewTask[];
  reviewedEvidenceRevision: number | null;
  reviewChanges: { revision: number; kind: string; reference_id: string | null; created_at: string }[];
  id: string;
  state: DemoState;
  revision: number;
  assignedDoctorId: string | null;
  assignedNurseId: string | null;
  careNotes: Database["public"]["Tables"]["staff_care_notes"]["Row"][];
  expiresAt: string;
  reports: Database["public"]["Tables"]["workspace_case_reports"]["Row"][];
  changes: { revision: number; kind: string; reference_id: string | null; created_at: string }[];
};
export function sharedDemoEnabled() {
  return process.env.NOREON_SHARED_DEMO === "true" && process.env.NEXT_PUBLIC_PATIENT_DEMO === "true";
}
export async function findWorkspaceCase(id: string, staff?: StaffIdentity, retries = 2): Promise<WorkspaceCase | null> {
  if (!sharedDemoEnabled() || !z.uuid().safeParse(id).success) return null;
  const { data: value, error } = await workspaceAdmin().rpc("workspace_case_snapshot", {p_id:id});
  if (error) throw new Error("Shared demo storage is unavailable. Please try again.");
  if (!value) return null;
  const snapshot = value as unknown as {doseHistory?: WorkspaceCase["doseHistory"];monitoring:MonitoringSnapshot;case: Database["public"]["Tables"]["workspace_cases"]["Row"]; reports: WorkspaceCase["reports"]; changes: WorkspaceCase["changes"]; reviewChanges: WorkspaceCase["changes"]; reviewTasks: Database["public"]["Tables"]["workspace_review_tasks"]["Row"][]};
  const row = snapshot.case;
  if (staff && staff.role !== "admin") {
    const access = await workspaceAdmin().rpc("staff_care_access", {p_id:id,p_actor:staff.id,p_native:false});
    if (access.error || access.data !== true) notFound();
  }
  const state = structuredClone(row.state) as unknown as DemoState;
  if (state.userId !== id || state.version !== 1) throw new Error("Invalid demo case");
  state.workspaceRevision = row.revision;
  if (state.workflow) {
    state.workflow.evidenceRevision = row.evidence_revision;
    state.workflow.draftEvidenceRevision = row.draft_evidence_revision;
  }
  // Legacy normalization is an explicit optimistic write, not a read-time projection.
  if (staff?.role !== "nurse" && normalizeSharedWorkflow(state)) {
    try {
      await persistWorkspaceCase(state);
    } catch (error) {
      if (retries <= 0 || !(error instanceof Error) || !/workspace case conflict/.test(error.message)) throw error;
      return findWorkspaceCase(id, staff, retries - 1);
    }
    return findWorkspaceCase(id, staff, retries);
  }
  const notes = staff ? await workspaceAdmin().from("staff_care_notes").select("*").eq("workspace_case_id",id).order("created_at",{ascending:false}) : {data:[]};
  return {id, doseHistory:snapshot.doseHistory??[], state:staff ? staffVisibleState(state,staff.role):state, assignedNurseId:row.assigned_nurse_id,careNotes:notes.data??[], monitoring:snapshot.monitoring??emptyMonitoring, revision:row.revision, assignedDoctorId:row.assigned_doctor_id,
    expiresAt:row.expires_at, reports:snapshot.reports, changes:snapshot.changes,
    reviewedEvidenceRevision:row.reviewed_evidence_revision, reviewChanges:snapshot.reviewChanges,
    reviewTasks:snapshot.reviewTasks.map(reviewTaskFromRow)};
}

export async function getWorkspaceCase(id: string, staff: StaffIdentity): Promise<WorkspaceCase> {
  const item = await findWorkspaceCase(id, staff);
  if (!item) notFound();
  return item;
}
export async function requireMemberCase(): Promise<WorkspaceCase> {
  const { readDemoSnapshot } = await import("@/lib/patient/demo");
  const snapshot = await readDemoSnapshot();
  const session = snapshot?.state;
  if (!session || !session.state.profile || !session.state.consentAccepted) throw new Error("unauthorized");
  const item = snapshot.workspaceCase;
  if (!item) throw new Error("not_found");
  return item;
}
export async function persistWorkspaceCase(state: DemoState, publicationKey: string | null = null, actorId: string | null = null) {
  const admin = workspaceAdmin();
  normalizeSharedWorkflow(state);
  const { workspaceRevision: initialRevision, ...plain } = structuredClone(state);
  let workspaceRevision = initialRevision;
  if (plain.workflow) {
    delete plain.workflow.evidenceRevision;
    delete plain.workflow.draftEvidenceRevision;
    delete plain.workflow.draftReportEvidenceRevision;
    delete plain.workflow.draftReportEvidenceSession;
  }
  if (workspaceRevision === undefined) {
    const assignedDoctorId = await findDefaultDemoDoctor(admin, sharedDemoEnabled(), process.env.NOREON_DEMO_GP_EMAIL);
    const {workflow, ...initial} = plain;
    const identity = await requestAdmissionIdentity();
    const { data: admitted, error } = await admin.rpc("workspace_create_case_admitted", {p_id:state.userId,p_source:identity.source,p_doctor:assignedDoctorId ?? undefined,p_state:initial as unknown as Json});
    if (!error && typeof admitted === "number" && admitted < 0) throw new AdmissionLimit(-admitted);
    if (error) throw new Error("This demo case changed. Refresh and try again.");
    state.workspaceRevision = 0;
    if (workflow) {
      const initialized = await admin.rpc("workspace_initialize_workflow",{p_id:state.userId,p_expected_revision:0,p_workflow:workflow as unknown as Json});
      if (initialized.error) throw new Error(initialized.error.message);
      state.workspaceRevision = initialized.data;
    }
    return;
  }
  const existing = await admin.from("workspace_cases").select("state").eq("id",state.userId).single();
  if (existing.error) throw new Error("This case is unavailable.");
  if (!(existing.data.state as unknown as DemoState).workflow && plain.workflow) {
    const initialized = await admin.rpc("workspace_initialize_workflow",{p_id:state.userId,p_expected_revision:workspaceRevision,p_workflow:plain.workflow as unknown as Json});
    if (initialized.error) throw new Error(initialized.error.message);
    state.workspaceRevision = initialized.data;
    workspaceRevision = initialized.data;
  }
  const { data, error } = await admin.rpc("workspace_save_case_audited", {
    p_actor: actorId ?? undefined, p_id: state.userId, p_expected_revision: workspaceRevision,
    p_state: plain as unknown as Json, p_publication_key: publicationKey ?? undefined,
  });
  if (error || typeof data !== "number") throw new Error(error?.message ?? "This case changed. Refresh and try again.");
  state.workspaceRevision = data;
}

export async function assignedCaseDoctor(item: WorkspaceCase) {
  if (!item.assignedDoctorId) return null;
  const db = workspaceAdmin();
  // A left embed preserves the doctor's display when the clinic is unavailable.
  const { data } = await db.from("workspace_staff").select("user_id,display_name,active,clinic_id,role,clinic:workspace_clinics!workspace_staff_clinic_id_fkey(active)")
    .eq("user_id", item.assignedDoctorId).maybeSingle();
  if (!data || data.role !== "doctor" || !data.clinic_id) return null;
  return { id: data.user_id, name: data.display_name, active: data.active && !!data.clinic?.active };
}
