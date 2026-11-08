import type {ReviewCoverage} from './review-task';
/** Fictional operational state only. Uploaded report contents never belong here. */
export type ServiceTest = {
  id: string;
  title: string;
  method: "lab" | "clinic" | "home-log";
  preparation: string;
  source: string;
};
export type ProviderPreparation = { provider: string; instructions: string; recordedAt: string; recordedBy: string };
export type ServiceBooking = {
  providerPreparation?: ProviderPreparation;
  preparationHistory?: ProviderPreparation[];
  replacedBy?: string;
  reviewedAt?: string;
  testSnapshots?: ServiceTest[];
  requirementIds?: string[];
  review?: {reason: string; changedTestIds: string[]} | null;
  id: string;
  testIds: string[];
  at: string;
  mode: "home" | "clinic" | "office";
  address: string;
  status: "scheduled" | "cancelled";
};
export type ServiceDoctor = { id: string; name: string; active: boolean };
export type TreatmentDraft = {
  explanation: string;
  instructions: string;
  followUp: string;
  medicationName: string;
  medicationDose: string;
  medicationInstructions: string;
  medicationTimes: string[];
  activityLimits?: string;
};
export type ServicePublication = {
  localReportBaseline?: {session:string;revision:number};
  evidenceRevision?: number;
  reviewCoverage?: ReviewCoverage;
  workflowRevision?: number;
  at: string;
  doctor: string;
  version: number;
  resultTestIds: string[];
  resultReceipts?: ServiceReceipt[];
  draft: TreatmentDraft;
  medicationOrderId?: string;
};
export type ServiceMedicationOrder = {
  id: string;
  originatingPlanId: string;
  effectiveAt: string;
  retiredAt: string | null;
  name: string;
  dose: string;
  instructions: string;
  times: string[];
};
export type ServiceRequirement = {
  requirementId: string;
  test: ServiceTest;
  introducedAtRevision: number;
  retiredAtRevision: number | null;
};
export type ServiceReceipt = {
  testId: string;
  method: ServiceTest["method"];
  requirementId: string;
  receivedAt: string | null;
};
export type ServiceWorkflow = {
  bookingRequests?: import('@/lib/demo-booking/model').DemoBookingRequest[];
  version: 1;
  revision: number;
  questionnaireRevision?: number;
  clinicalContext?: string;
  recommendationsPending?: boolean;
  requirements?: ServiceRequirement[];
  receiptHistory?: ServiceReceipt[];
  recommendationChanges?: {added: string[]; removed: string[]; changed: string[]};
  appointmentHistory?: NonNullable<ServiceWorkflow["appointment"]>[];
  evidenceRevision?: number;
  draftEvidenceRevision?: number | null;
  draftReportEvidenceRevision?: number;
  draftReportEvidenceSession?: string;
  startedAt: string;
  tests: ServiceTest[];
  bookings: ServiceBooking[];
  receivedTestIds: string[];
  allResultsAt: string | null;
  lastResultsAt?: string | null;
  doctors: ServiceDoctor[];
  assignedDoctorId: string;
  consultation: "undecided" | "required" | "not-required";
  appointment: {
    at: string;
    mode: "video" | "clinic";
    completedAt?: string;
    completedBy?: string;
    completedForContext?: string;
    completedForQuestionnaireRevision?: number;
    status: "scheduled" | "needs-reschedule" | "completed";
  } | null;
  draft: TreatmentDraft;
  draftSaved?: boolean;
  publication: ServicePublication | null;
  publicationHistory?: ServicePublication[];
  medicationOrders?: ServiceMedicationOrder[];
  events: { at: string; text: string }[];
};
export type ServiceCommand =
  | {
      type: "book";
      testIds: string[];
      at: string;
      mode: "home" | "clinic";
      address: string;
      replacingId?: string;
    }
  | { type: "record-provider-preparation"; bookingId: string; provider: string; instructions: string }
  | { type: "cancel"; bookingId: string }
  | { type: "confirm-booking"; bookingId: string; testIds: string[] }
  | { type: "receive"; testIds: string[] }
  | { type: "consultation"; decision: "required" | "not-required" }
  | { type: "appointment"; at: string; mode: "video" | "clinic" }
  | { type: "complete-consultation" }
  | { type: "save-draft"; monitoringDecisions?:{requirementId:string;decision:"retain"|"supersede"}[]; draft: TreatmentDraft; evidenceRevision?: number; reportEvidenceRevision?: number; reportEvidenceSession?: string }
  | { type: "publish"; evidenceRevision?: number; reportEvidenceRevision?: number; reportEvidenceSession?: string }
  | { type: "add-doctor"; name: string }
  | { type: "assign"; doctorId: string }
  | { type: "doctor-status"; doctorId: string; active: boolean }
  | { type: "reset" };
