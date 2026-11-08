import type {ReviewTask} from '@/lib/service-workflow/review-task';
export type StaffRole = "admin" | "doctor" | "nurse";

export interface StaffIdentity {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  clinicId: string | null;
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
