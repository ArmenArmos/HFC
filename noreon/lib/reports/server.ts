import {sourceBoundExplanation} from '@/lib/reports/source-bound-output';
import "server-only";
import type { Database, Json } from "@/lib/db/types";
import {
  validateReview,
  repairExtractionDate,
  extractionSchema,
  validateExplanation,
  MAX_BYTES,
  MIME_TYPES,
  CONSENT,
} from "@/lib/reports/schema";
import { validateFile } from "@/lib/reports/files";
import {
  callReportModel,
  EXTRACTION_INSTRUCTION,
  PROMPT_VERSION,
  REPORT_MODEL,
} from "@/lib/reports/provider";
import { z } from "zod";
import { readAllPages } from "@/lib/patient-care/pagination";
export const BUCKET = "patient-reports";
import { reportsEnabled } from "@/lib/reports/enabled";
export { reportsEnabled };
export {reportContext,registeredReportState,type ReportContext} from "./context";
import type {ReportContext} from "./context";

export async function ownedReport(
  ctx: ReportContext,
  id: string,
  includeDeleted = false,
) {
  if (!z.uuid().safeParse(id).success) throw new Error("not_found");
  const result = await ctx.admin
    .from("patient_reports")
    .select("*")
    .eq("id", id)
    .eq("user_id", ctx.identity.userId)
    .maybeSingle();
  if (result.error) throw new Error("unavailable");
  if (
    !result.data ||
    (!includeDeleted && result.data.deleted_at)
  )
    throw new Error("not_found");
  return result.data;
}
export async function listReports(ctx: ReportContext) {
  return readAllPages((from, to) =>
    ctx.client
      .from("patient_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
}
const command = z.object({
  op: z.enum(["upload", "extract", "confirm", "explain", "delete"]),
  id: z.uuid().optional(),
  revision: z.number().int().nonnegative().optional(),
  name: z.string().min(1).max(180).optional(),
  mime: z.enum(MIME_TYPES).optional(),
  size: z.number().int().min(1).max(MAX_BYTES).optional(),
  consent: z.literal(CONSENT).optional(),
  review: z.unknown().optional(),
  mine: z.literal(true).optional(),
  locale: z.enum(["en", "hy"]).optional(),
});
export async function executeReport(ctx: ReportContext, input: unknown) {
  const parsed = command.safeParse(input);
  if (!parsed.success) throw new Error("invalid");
  const c = parsed.data;
  // Deleting your own report never needs the import or the model (privacy audit B3-4).
  if (c.op !== "delete" && !reportsEnabled()) throw new Error("disabled");
  if (c.op === "upload") {
    if (!c.name || !c.mime || !c.size || !c.consent) throw new Error("invalid");
    const created = await ctx.admin.rpc("reserve_report_upload", {
      p_owner: ctx.identity.userId,
      p_name: c.name.replace(/[\x00-\x1f]/g, ""),
      p_mime: c.mime,
      p_size: c.size,
      p_consent: c.consent,
    });
    if (created.error)
      throw new Error(
        created.error.message === "daily_limit" ? "daily_limit" : "unavailable",
      );
    const id = created.data,
      path = `${ctx.identity.userId}/${id}/original`;
    const upload = await ctx.admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (upload.error) throw new Error("upload_failed");
    return { id, path, token: upload.data.token };
  }
  if (!c.id) throw new Error("invalid");
  const report = await ownedReport(ctx, c.id, c.op === "delete");
  if (c.op === "delete") {
    const tombstone = await ctx.admin
      .from("patient_reports")
      .update({
        state: "deleted",
        deleted_at: new Date().toISOString(),
        extraction: null,
        reviewed: null,
        explanation: null,
        lease_until: null,
        revision: report.revision + 1,
      })
      .eq("id", report.id)
      .eq("revision", report.revision)
      .select("id")
      .maybeSingle();
    if (tombstone.error || !tombstone.data) throw new Error("conflict");
    const removal = await ctx.admin.storage
      .from(BUCKET)
      .remove([report.object_path]);
    if (removal.error) throw new Error("cleanup_pending");
    // Keep a minimal tombstone and attempt counters to prevent deletion bypassing quotas.
    await ctx.admin
      .from("patient_reports")
      .update({ file_name: "Removed report", checksum: null, error_code: null })
      .eq("id", report.id);
    return { deleted: true, cleanupPending: true };
  }
  if (c.op === "confirm") {
    if (
      !c.mine ||
      c.revision !== report.revision ||
      !["needs_review", "confirmed"].includes(report.state) ||
      (report.lease_until && Date.parse(report.lease_until) > Date.now())
    )
      throw new Error("conflict");
    const review = validateReview(c.review);
    const original = extractionSchema.parse(report.extraction);
    if (
      review.rows.length !== original.rows.length ||
      review.rows.some(
        (r, i) =>
          r.page !== original.rows[i].page ||
          r.snippet !== original.rows[i].snippet,
      )
    )
      throw new Error("invalid");
    const saved = await ctx.admin
      .from("patient_reports")
      .update({
        reviewed: review as unknown as Json,
        state: "confirmed",
        confirmed_at: new Date().toISOString(),
        explanation: null,
        revision: report.revision + 1,
      })
      .eq("id", report.id)
      .eq("revision", report.revision)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (saved.error || !saved.data) throw new Error("conflict");
    return { confirmed: true };
  }
  if (c.revision !== report.revision) throw new Error("conflict");
  let bytes: Buffer | undefined;
  let fileInfo: { pages: number; checksum: string } | undefined;
  if (c.op === "extract") {
    const file = await ctx.admin.storage
      .from(BUCKET)
      .download(report.object_path);
    if (file.error || !file.data) throw new Error("upload_failed");
    if (file.data.size !== report.size_bytes) throw new Error("invalid_file");
    bytes = Buffer.from(await file.data.arrayBuffer());
    try {
      fileInfo = await validateFile(bytes, report.mime);
    } catch {
      throw new Error("invalid_file");
    }
    const duplicate = await ctx.admin
      .from("patient_reports")
      .select("id")
      .eq("user_id", ctx.identity.userId)
      .eq("checksum", fileInfo.checksum)
      .neq("id", report.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (duplicate.error) throw new Error("unavailable");
    if (duplicate.data) throw new Error("duplicate");
  }
  const claim = await ctx.admin.rpc("claim_report_job", {
    p_id: report.id,
    p_owner: ctx.identity.userId,
    p_operation: c.op === "extract" ? "extract" : "explain",
    p_revision: report.revision,
  });
  if (claim.error)
    throw new Error(
      claim.error.message === "daily_limit" ? "daily_limit" : "conflict",
    );
  const revision = claim.data;
  try {
    const model = process.env.OPENAI_REPORT_MODEL || REPORT_MODEL;
    let change: Database["public"]["Tables"]["patient_reports"]["Update"];
    if (c.op === "extract") {
      const encoded = bytes!.toString("base64");
      const content =
        report.mime === "application/pdf"
          ? {
              type: "input_file",
              filename: "report.pdf",
              file_data: `data:application/pdf;base64,${encoded}`,
            }
          : {
              type: "input_image",
              image_url: `data:${report.mime};base64,${encoded}`,
              detail: "high",
            };
      const extraction = await callReportModel({
        key: process.env.OPENAI_API_KEY!,
        model,
        instruction: EXTRACTION_INSTRUCTION,
        content: [content],
        schema: extractionSchema,
      });
      if (extraction.rows.some((r) => r.page > fileInfo!.pages))
        throw new Error("provider_invalid");
      // Ambiguous dates remain visibly unresolved rather than blocking review.
      const repaired = repairExtractionDate(extraction);
      change = {
        extraction: repaired as unknown as Json,
        state: "needs_review",
        checksum: fileInfo!.checksum,
        page_count: fileInfo!.pages,
      };
    } else {
      const reviewed = validateReview(report.reviewed);
      const explanation = sourceBoundExplanation(reviewed,c.locale??'en');
      validateExplanation(explanation, reviewed);
      change = { explanation: explanation as unknown as Json };
    }
    const saved = await ctx.admin
      .from("patient_reports")
      .update({
        ...change,
        ...(c.op==='extract'?{model,prompt_version:PROMPT_VERSION}:{}),
        lease_until: null,
        error_code: null,
      })
      .eq("id", report.id)
      .eq("revision", revision)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (saved.error || !saved.data) throw new Error("conflict");
    return { processed: true };
  } catch {
    await ctx.admin
      .from("patient_reports")
      .update({
        state: c.op === "extract" ? "failed" : "confirmed",
        lease_until: null,
        error_code: "processing_failed",
      })
      .eq("id", report.id)
      .eq("revision", revision)
      .is("deleted_at", null);
    throw new Error("processing_failed");
  }
}
