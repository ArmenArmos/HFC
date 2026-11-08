import { withRouteLogging } from "@/lib/observability/with-logging";
import {sampleReportPreview} from "@/lib/reports/demo";
import { AdmissionLimit, claimAdmission, requestAdmissionIdentity } from "@/lib/security/admission";
import { z } from "zod";
import { requireMemberCase } from "@/lib/staff/cases";
import {
  addFictionalReport,
  addMemberReport,
  deleteMemberReport,
  listCaseReports,
  toReport,
  redactMemberReport,
} from "@/lib/staff/reports";
import { workspaceAdmin } from "@/lib/staff/auth";
import { sameWorkspaceOrigin } from "@/lib/staff/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function memberReceipt(report: Record<string, unknown>) {
  return { ...report, object_path: "", sample_preview: sampleReportPreview(report), extraction: null, reviewed: null, explanation: null, state: "needs_review" };
}

function failure(error: unknown) {
  if (error instanceof AdmissionLimit) return Response.json({ error: "rate_limited" }, { status: 429, headers: {...headers, "Retry-After": String(error.retryAfter)} });
  const reason = error instanceof Error ? error.message : "unavailable";
  const allowed = ["unauthorized", "not_found", "invalid", "invalid_file", "invalid_provenance", "duplicate", "report_limit", "conflict", "upload_failed", "cleanup_pending"];
  const code = allowed.includes(reason) ? reason : "unavailable";
  const status = code === "unauthorized" ? 401 : code === "not_found" ? 404 : code === "conflict" ? 409 : code === "unavailable" ? 503 : 400;
  return Response.json({ error: code }, { status, headers });
}

function sameOrigin(request: Request) {
  return sameWorkspaceOrigin(request);
}

async function boundedRequest(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("invalid");
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}

export const GET = withRouteLogging(async function GET(request: Request) {
  try {
    const item = await requireMemberCase();
    const url = new URL(request.url);
    const originalId = url.searchParams.get("original");
    if (originalId) {
      if (!z.uuid().safeParse(originalId).success) throw new Error("not_found");
      const reports = await listCaseReports(item.id);
      const report = reports.find((row) => row.id === originalId);
      if (!report?.objectPath) throw new Error("not_found");
      const { data, error } = await workspaceAdmin().storage.from("workspace-case-reports").download(report.objectPath);
      if (error || !data) throw new Error("not_found");
      const bytes = await data.arrayBuffer();
      const mime = typeof report.record.mime === "string" ? report.record.mime : "application/octet-stream";
      const name = typeof report.record.file_name === "string" ? report.record.file_name : "report";
      return new Response(bytes, { headers: {
        ...headers,
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      } });
    }
    const reports = item.reports.map(toReport);
    const publication = item.state.workflow?.publication;
    const publicationKey = publication?.workflowRevision === undefined
      ? null
      : `${item.state.workflow!.startedAt}:${publication.workflowRevision}`;
    return Response.json({ reports: reports.map((report) => redactMemberReport(report, publicationKey)) }, { headers });
  } catch (error) {
    return failure(error);
  }
});

export const POST = withRouteLogging(async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("unauthorized");
    const item = await requireMemberCase();
    await claimAdmission("upload", await requestAdmissionIdentity(undefined, request.headers));
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const bounded = await boundedRequest(request, 2_300_000);
      const form = await bounded.formData();
      if (form.get("op") !== "upload" || form.get("sharedConsent") !== "true") throw new Error("invalid");
      const file = form.get("file");
      let record: unknown;
      try { record = JSON.parse(String(form.get("record") ?? "")); } catch { throw new Error("invalid"); }
      if (!(file instanceof File)) throw new Error("invalid_file");
      const report = await addMemberReport(item.id, record, file);
      return Response.json({ report: memberReceipt(report) }, { headers });
    }
    if (!contentType.startsWith("application/json")) throw new Error("invalid");
    const body = await (await boundedRequest(request, 128_000)).json();
    const input = z.object({ op: z.literal("sample"), year: z.union([z.literal(2024), z.literal(2025)]), sharedConsent: z.literal(true) }).safeParse(body);
    if (!input.success) throw new Error("invalid");
    const rows = await listCaseReports(item.id);
    if (rows.length >= 10) throw new Error("invalid");
    const report = await addFictionalReport(item.id, input.data.year);
    return Response.json({ report: memberReceipt(report) }, { headers });
  } catch (error) {
    return failure(error);
  }
});

export const DELETE = withRouteLogging(async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("unauthorized");
    const item = await requireMemberCase();
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("invalid");
    const body = z.object({ id: z.string().uuid() }).safeParse(await (await boundedRequest(request, 8_000)).json());
    if (!body.success) throw new Error("invalid");
    await deleteMemberReport(item.id, body.data.id);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return failure(error);
  }
});
