import type {ReviewTask} from '@/lib/service-workflow/review-task';
export type StaffRole = "admin" | "doctor" | "nurse" | "coordinator";
/** A doctor's specialty (workspace_staff.specialty); null for every other role. */
export type StaffSpecialty = "family_physician" | "cardiologist";

/** The legacy shared-demo workspace (lib/staff/auth.ts) has no care coordinator. */
export type DemoStaffRole = Exclude<StaffRole, "coordinator">;
export interface StaffIdentity {
  id: string;
  email: string;
  name: string;
  role: DemoStaffRole;
  clinicId: string | null;
  specialty?: StaffSpecialty | null;
}

export interface StaffClinic {
  id: string;
  name: string;
  address: string;
  active: boolean;
}

export interface StaffDoctor {
  id: string;
  email: string;
  name: string;
  clinicId: string;
  active: boolean;
}

export interface StaffCase {
  followups?:{requirementId:string;dueAt:string}[];
  evidenceRevision: number;
  reviewedEvidenceRevision: number | null;
  reviewTask: ReviewTask | null;
  id: string;
  state: Record<string, unknown>;
  revision: number;
  assignedDoctorId: string | null;
  assignedNurseId?: string | null;
  expiresAt: string;
}
