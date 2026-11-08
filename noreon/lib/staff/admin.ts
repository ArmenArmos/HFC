import {staffVisibleState} from "./care-visibility";
import {reviewTaskFromRow} from './review-tasks';
import "server-only";
import { doctorDirectoryRows } from "./directory-data";

import { workspaceAdmin } from "./auth";
import { requireStaff } from "./auth";
import type { StaffCase, StaffClinic, StaffDoctor } from "./types";

export { workspaceAdmin } from "./auth";

export async function listClinics(): Promise<StaffClinic[]> {
  await requireStaff("admin");
  const { data, error } = await workspaceAdmin().from("workspace_clinics").select("id,name,address,active").order("name");
  if (error) throw new Error("Could not load clinics");
  return data;
}

export async function listDoctors(includeEmail = true): Promise<StaffDoctor[]> {
  await requireStaff("admin");
  const db = workspaceAdmin();
  const { data, error } = await db.from("workspace_staff").select("user_id,display_name,clinic_id,active").eq("role", "doctor").order("display_name");
  if (error) throw new Error("Could not load doctors");
  return doctorDirectoryRows(data, includeEmail, async (id) => {
    const { data: user, error: userError } = await db.auth.admin.getUserById(id);
    return userError ? null : user.user.email ?? "";
  });
}

export async function listCases(): Promise<{cases:StaffCase[];monitoringWarning:string|null}> {
  const staff = await requireStaff();
  let monitoringWarning:string|null=null;
  // Read-only status: opening a queue must not start reconciliation writes.
  // Cron owns dispatch. Keep an observable warning if due work is not caught up.
  try {
    const due=await workspaceAdmin().rpc('workspace_due_monitoring_cases',{p_actor:staff.id,p_limit:1}).abortSignal(AbortSignal.timeout(2000));
    if(due.error) throw new Error('unavailable');
    if(due.data?.length) monitoringWarning='Scheduled follow-up processing is pending. Some follow-up tasks may not yet be listed. Processing runs automatically every five minutes.';
  }catch{monitoringWarning='Follow-up processing status could not be checked. Showing current data; some follow-up tasks may be missing.';}
  const db = workspaceAdmin();
  let query = db.from("workspace_cases").select("id,state,revision,assigned_doctor_id,assigned_nurse_id,expires_at,evidence_revision,reviewed_evidence_revision,review_tasks:workspace_review_tasks(*),followups:workspace_followup_work(*)").eq("review_tasks.status","open").eq("followups.status","open").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false });
  if (staff.role === "doctor") query = query.eq("assigned_doctor_id", staff.id);
  if (staff.role === "nurse") query = query.eq("assigned_nurse_id", staff.id);
  const { data, error } = await query;
  if (error) throw new Error("Could not load cases");
  const scoped = staff.role === "nurse" ? (await Promise.all(data.map(async row => {
    const access=await db.rpc("staff_care_access",{p_id:row.id,p_actor:staff.id,p_native:false});
    return access.data===true&&!access.error ? row : null;
  }))).filter((row):row is typeof data[number]=>row!==null) : data;
  const cases:StaffCase[]=scoped.map((row) => ({
    id: row.id,
    followups:row.followups.map(w=>({requirementId:w.requirement_id,dueAt:w.due_at})),
    evidenceRevision:row.evidence_revision,
    reviewedEvidenceRevision:row.reviewed_evidence_revision,
    reviewTask:row.review_tasks[0] ? reviewTaskFromRow(row.review_tasks[0]) : null,
    state: staffVisibleState((row.state && typeof row.state === "object" && !Array.isArray(row.state) ? row.state : {}) as Record<string, unknown>,staff.role),
    revision: row.revision,
    assignedDoctorId: row.assigned_doctor_id,
    assignedNurseId: row.assigned_nurse_id,
    expiresAt: row.expires_at,
  }));
  return {cases,monitoringWarning};
}

export async function listNurses(includeEmail = true): Promise<StaffDoctor[]> {
 await requireStaff("admin");
 const db=workspaceAdmin();
 const {data,error}=await db.from("workspace_staff").select("user_id,display_name,clinic_id,active").eq("role","nurse").order("display_name");
 if(error)throw Error("Could not load nurses");
 return doctorDirectoryRows(data,includeEmail,async id=>{
  const {data:user,error:userError}=await db.auth.admin.getUserById(id);
  return userError?null:user.user.email??"";
 });
}
