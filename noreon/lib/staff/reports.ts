import {PROMPT_VERSION} from '@/lib/reports/provider';
import {sampleReportPreview} from "@/lib/reports/demo";
import {memberReportMetadata} from "@/lib/service-workflow/report-associations";
import "server-only";

import { z } from "zod";
import {verifyExtractionReceipt} from "@/lib/reports/provenance";
import type { Database, Json } from "@/lib/db/types";
import { validateFile } from "@/lib/reports/files";
import { explanationSchema, extractionSchema } from "@/lib/reports/schema";
import { workspaceAdmin } from "./auth";

const BUCKET = "workspace-case-reports";

type CaseReportRow = Database["public"]["Tables"]["workspace_case_reports"]["Row"];
type CaseReport = {
  caseId: string;
  id: string;
  record: Record<string, unknown>;
  revision: number;
  approval: Record<string, unknown> | null;
  published: Record<string, unknown> | null;
  objectPath: string;
};

function db() {
  return workspaceAdmin();
}

function jsonObject(value: Json): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toReport(row: CaseReportRow): CaseReport {
  const record = jsonObject(row.record);
  const path = typeof record.object_path === "string" ? record.object_path : "";
  return {
    caseId: row.case_id,
    id: row.id,
    record,
    revision: row.revision,
    approval: row.approval ? jsonObject(row.approval) : null,
    published: row.published ? jsonObject(row.published) : null,
    objectPath: path,
  };
}

export async function listCaseReports(caseId: string): Promise<CaseReport[]> {
  const { data, error } = await db()
    .from("workspace_case_reports")
    .select("case_id,id,record,revision,approval,published,created_at,updated_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("unavailable");
  return data.map(toReport);
}

export async function findCaseReport(caseId: string, id: string) {
  const { data, error } = await db()
    .from("workspace_case_reports")
    .select("case_id,id,record,revision,approval,published,created_at,updated_at")
    .eq("case_id", caseId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("unavailable");
  return data ? toReport(data) : null;
}

export function recordWithPrivatePath(report: CaseReport) {
  return { ...report.record, object_path: report.objectPath };
}

/** Queue only a rejected attempt. The RPC locks the case and refuses live paths. */
async function discardUpload(caseId: string, reportId: string, objectPath: string) {
  try {
    const { data, error } = await db().rpc("workspace_write_report", {
      p_id: caseId, p_report_id: reportId, p_op: "discard-upload",
      p_record: { object_path: objectPath },
    });
    if (error || data !== 1) return;
    const removed = await db().storage.from(BUCKET).remove([objectPath]);
    if (!removed.error) await db().from("workspace_report_cleanup").delete().eq("object_path", objectPath);
  } catch {
    // A committed cleanup request survives storage/network failure for the cleanup job.
    // If queuing was uncertain, retaining an orphan is safer than deleting a live file.
  }
}

export async function addMemberReport(
  caseId: string,
  recordValue: unknown,
  file: File,
) {
  const input = z
    .object({
      id: z.string().uuid(),
      file_name: z.string().min(1).max(240),
      mime: z.enum(["application/pdf", "image/jpeg", "image/png"]),
      extraction: extractionSchema,
      model: z.string().max(120),
      prompt_version: z.string().max(120),
    })
    .passthrough()
    .safeParse(recordValue);
  if (!input.success) throw new Error("invalid");
  const value = input.data;
  if (file.type !== value.mime || file.size === 0 || file.size > 2 * 1024 * 1024)
    throw new Error("invalid_file");
  const bytes = Buffer.from(await file.arrayBuffer());
  const { pages, checksum } = await validateFile(bytes, value.mime);
  const receipt = verifyExtractionReceipt(process.env.NOREON_DEMO_AI_BRIDGE_SECRET ?? '', {
    caseId, checksum, pages, mime: value.mime, extraction: value.extraction,
    model: value.model, prompt_version: value.prompt_version as typeof PROMPT_VERSION,
  }, value.extraction_receipt);
  const existing = await findCaseReport(caseId, value.id);
  if (existing) {
    if (existing.record.checksum !== checksum) throw new Error("duplicate");
    return existing.record;
  }
  // Never reuse an earlier attempt's path: delayed deletion/cleanup cannot touch a retry.
  const objectPath = `${caseId}/${value.id}/${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const record = {
    id: value.id,
    user_id: caseId,
    object_path: objectPath,
    file_name: value.file_name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240),
    mime: value.mime,
    size_bytes: bytes.length,
    created_at: createdAt,
    state: "needs_review",
    revision: 0,
    lease_until: null,
    checksum,
    extraction_provenance: {status: 'verified', version: receipt.version, issued_at: new Date(receipt.issuedAt).toISOString()},
    page_count: pages,
    extraction: value.extraction,
    reviewed: null,
    explanation: null,
    error_code: null,
    consent_version: "shared-demo-report-v1",
    consent_at: createdAt,
    model: value.model,
    prompt_version: value.prompt_version,
    confirmed_at: null,
    deleted_at: null,
    storage_purged_at: null,
  };

  const storage = db().storage.from(BUCKET);
  const uploaded = await storage.upload(objectPath, bytes, {
    contentType: value.mime,
    upsert: false,
  });
  if (uploaded.error) throw new Error("upload_failed");
  let failure: { code?: string; message?: string } | null;
  try {
    const result = await db().rpc("workspace_write_report", {p_id:caseId,p_report_id:value.id,p_op:"insert",p_record:record as unknown as Json});
    failure = result.error;
  } catch {
    failure = { message: "unavailable" };
  }
  // A transport failure is not proof of rollback. Also read the canonical row after
  // successful same-ID races, which return the existing report without overwriting it.
  let saved: CaseReport | null;
  try { saved = await findCaseReport(caseId, value.id); }
  catch { throw new Error("unavailable"); }
  const explicitlyRejected = failure?.code === "23505" || failure?.code === "P0001";
  if (saved?.record.checksum === checksum) {
    // A different canonical path is not proof that a timed-out insert has ended:
    // that row may be deleted before the delayed insert adopts this candidate.
    if (saved.objectPath !== objectPath && (failure === null || explicitlyRejected)) {
      await discardUpload(caseId, value.id, objectPath);
    }
    return saved.record;
  }
  // Only explicit PostgreSQL rejections prove that this attempt did not commit.
  // Unknown outcomes retain their objects; a retry can reconcile by report ID.
  if (failure && explicitlyRejected) {
    await discardUpload(caseId, value.id, objectPath);
    if (failure.code === "23505") throw new Error("duplicate");
    if (failure.message === "report_limit") throw new Error("report_limit");
  }
  throw new Error("unavailable");
}

export async function addFictionalReport(caseId: string, year: 2024 | 2025) {
  const { sampleReports } = await import("@/lib/reports/demo");
  const template = sampleReports().find((report) => report.file_name.includes(String(year)));
  if (!template) throw new Error("invalid");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const record = {
    ...template,
    id,
    user_id: caseId,
    object_path: "",
    file_name: template.file_name,
    created_at: now,
    consent_at: now,
    state: "needs_review",
    revision: 0,
    reviewed: null,
    explanation: null,
    confirmed_at: null,
  };
  const { error } = await db().rpc("workspace_write_report", {p_id:caseId,p_report_id:id,p_op:"insert",p_record:record as unknown as Json});
  if (error) throw new Error(error.code === "23505" ? "duplicate" : "unavailable");
  return record;
}

export async function deleteMemberReport(caseId: string, id: string) {
  const current = await findCaseReport(caseId, id);
  if (!current) throw new Error("not_found");
  const { error } = await db().rpc("workspace_write_report", {p_id:caseId,p_report_id:id,p_op:"delete",p_expected_revision:current.revision});
  if (error) throw new Error(error.message === "conflict" ? "conflict" : "unavailable");
  if (current.objectPath) {
    const { error: storageError } = await db().storage.from(BUCKET).remove([current.objectPath]);
    // The deletion trigger retains this path for the cleanup job on failure.
    if (!storageError) await db().from("workspace_report_cleanup").delete().eq("object_path", current.objectPath);
  }
}

export async function updateStaffReport(
  caseId: string,
  id: string,
  expectedRevision: number,
  input: unknown,
  actorId: string,
) {
  const current = await findCaseReport(caseId, id);
  if (!current) throw new Error("not_found");
  if (current.revision !== expectedRevision) throw new Error("conflict");
  const incoming = z
    .object({
      revision: z.number().int().nonnegative(),
      state: z.enum(["needs_review", "confirmed"]),
      reviewed: extractionSchema.nullable(),
      explanation: explanationSchema.nullable(),
    })
    .safeParse(input);
  if (!incoming.success) throw new Error("invalid");
  const oldRecord = current.record;
  const record = {
    ...oldRecord,
    revision: incoming.data.revision,
    state: incoming.data.state,
    reviewed: incoming.data.reviewed,
    explanation: incoming.data.explanation,
    confirmed_at:
      incoming.data.state === "confirmed"
        ? (typeof oldRecord.confirmed_at === "string" ? oldRecord.confirmed_at : new Date().toISOString())
        : null,
  };
  const { data, error } = await db().rpc("workspace_write_report", {p_id:caseId,p_report_id:id,p_op:"update",p_expected_revision:expectedRevision,p_record:record as unknown as Json,p_actor:actorId});
  if (error) throw new Error(error.message === "conflict" ? "conflict" : "unavailable");
  if (data === null) throw new Error("conflict");
  // SQL owns content/revision transitions; the client reads the coherent snapshot.
  return { revision: data };
}

export async function approveStaffReport(
  caseId: string,
  id: string,
  expectedRevision: number,
  doctor: string,
  actorId: string,
) {
  const current = await findCaseReport(caseId, id);
  if (!current) throw new Error("not_found");
  if (current.revision !== expectedRevision) throw new Error("conflict");
  const record = current.record;
  const reviewed = extractionSchema.safeParse(record.reviewed);
  const explanation = explanationSchema.safeParse(record.explanation);
  if (record.state !== "confirmed" || !reviewed.success || !explanation.success)
    throw new Error("invalid");
  const approval = {
    revision: record.revision,
    at: new Date().toISOString(),
    doctor,
    report: structuredClone(record),
  };
  const { data, error } = await db().rpc("workspace_write_report", {p_id:caseId,p_report_id:id,p_op:"approve",p_expected_revision:expectedRevision,p_approval:approval as unknown as Json,p_actor:actorId});
  if (error) throw new Error(error.message === "conflict" ? "conflict" : "unavailable");
  if (data === null) throw new Error("conflict");
  return { approval, revision: data };
}

export function redactMemberReport(report: CaseReport, currentPublicationKey: string | null) {
  const publicRecord = {
    ...report.record,
    associations:[],
    associationHistory:[],
    object_path: "",
    sample_preview: sampleReportPreview(report.record),
    extraction: null,
    reviewed: null,
    explanation: null,
    state: "needs_review",
  };
  const publication = report.published;
  const rawApproval = publication ? jsonObject(publication.approval as Json) : {};
  const rawSnapshot = rawApproval.report;
  const approval = rawSnapshot && typeof rawSnapshot === "object"
    ? {
        ...rawApproval,
        report: { ...memberReportMetadata(jsonObject(rawSnapshot as Json)), object_path: "" },
      }
    : null;
  const published = publication && typeof publication.key === "string" && publication.key === currentPublicationKey && approval
    ? { key: publication.key, approval }
    : null;
  if (published && approval?.report) {
    return { record: publicRecord, revision: report.revision, published, approval: null, original: !!report.objectPath };
  }
  return {
    record: publicRecord,
    revision: report.revision,
    published: null,
    approval: null,
    original: !!report.objectPath,
  };
}
