import { withRouteLogging } from "@/lib/observability/with-logging";
import {validateFile} from "@/lib/reports/files";
import { z } from "zod";
import { caseHistory } from "@/lib/notifications/server";
import { getWorkspaceCase, assignedCaseDoctor } from "@/lib/staff/cases";
import { getStaff, workspaceAdmin } from "@/lib/staff/auth";
import { sameWorkspaceOrigin } from "@/lib/staff/request";
import {
  approveStaffReport,
  findCaseReport,
  toReport,
  updateStaffReport,
} from "@/lib/staff/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function failure(error: unknown) {
  if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  const reason = error instanceof Error ? error.message : "unavailable";
  const allowed = ["unauthorized", "forbidden", "not_found", "invalid", "conflict"];
  const code = allowed.includes(reason) ? reason : "unavailable";
  const status = code === "unauthorized" ? 401 : code === "forbidden" ? 403 : code === "not_found" ? 404 : code === "conflict" ? 409 : code === "invalid" ? 400 : 503;
  return Response.json({ error: code }, { status, headers });
}

async function readJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid");
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 128_000) {
      await reader.cancel();
      throw new Error("invalid");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text); } catch { throw new Error("invalid"); }
}

function sameOrigin(request: Request) {
  return sameWorkspaceOrigin(request);
}

export const GET = withRouteLogging(async function GET(request: Request) {
  try {
    const staff = await getStaff();
    if (!staff) throw new Error("unauthorized");
    const url = new URL(request.url);
    const caseId = url.searchParams.get("caseId");
    if (!caseId) throw new Error("not_found");
    const item = await getWorkspaceCase(caseId, staff);
    const originalId = url.searchParams.get("original");
    if (originalId) {
      if (!z.uuid().safeParse(originalId).success) throw new Error("not_found");
      const report = await findCaseReport(item.id, originalId);
      if (!report?.objectPath) throw new Error("not_found");
      const { data, error } = await workspaceAdmin().storage.from("workspace-case-reports").download(report.objectPath);
      if (error || !data) throw new Error("not_found");
      const mime = typeof report.record.mime === "string" ? report.record.mime : "application/octet-stream";
      const name = typeof report.record.file_name === "string" ? report.record.file_name : "report";
      const preview=url.searchParams.get("preview");
      if(preview!==null && preview!=="1") throw new Error("invalid");
      const bytes=Buffer.from(await data.arrayBuffer());
      if(preview==="1") await validateFile(bytes,mime);
      return new Response(bytes, { headers: {
        ...headers,
        "Cache-Control": "private, no-store",
        "Content-Type": mime,
        "Content-Disposition": `${preview==="1"?"inline":"attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": preview==="1" ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; sandbox",
      } });
    }
    const reports = item.reports.map(toReport);
    const doctor = await assignedCaseDoctor(item);
    if (item.state.workflow) { item.state.workflow.doctors = doctor ? [doctor] : []; item.state.workflow.assignedDoctorId = doctor?.id ?? ""; }
    return Response.json({ snapshot: {monitoring:item.monitoring,state:item.state,changes:item.changes,reviewTasks:item.reviewTasks,reviewChanges:item.reviewChanges,history:await caseHistory(item.id,staff).catch(()=>null)}, reports: reports.map((report) => ({
      record: { ...report.record, object_path: "" },
      revision: report.revision,
      approval: report.approval,
      published: report.published,
      original: !!report.objectPath,
    })) }, { headers });
  } catch (error) {
    return failure(error);
  }
});

export const POST = withRouteLogging(async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("unauthorized");
    const staff = await getStaff();
    if (!staff) throw new Error("unauthorized");
    if (staff.role !== "doctor") throw new Error("forbidden");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("invalid");
    const body = z.object({
      caseId: z.string().uuid(),
      op: z.enum(["update", "approve", "associate"]),
      id: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
      record: z.unknown().optional(),
      requirementId:z.string().min(1).max(200).optional(),
      rowIndices:z.array(z.number().int().min(0).max(99)).max(100).optional(),
      expectedEvidenceRevision:z.number().int().nonnegative().optional(),
    }).strict().safeParse(await readJson(request));
    if (!body.success) throw new Error("invalid");
    const item = await getWorkspaceCase(body.data.caseId, staff);
    if(body.data.op === "associate") {
      const p=body.data;
      if(p.requirementId===undefined || p.rowIndices===undefined || p.expectedEvidenceRevision===undefined) throw new Error("invalid");
      const result=await workspaceAdmin().rpc("workspace_associate_report",{p_id:item.id,p_report_id:p.id,p_actor:staff.id,p_expected_evidence:p.expectedEvidenceRevision,p_expected_report_revision:p.expectedRevision,p_requirement_id:p.requirementId,p_rows:p.rowIndices});
      if(result.error) throw new Error(result.error.message.includes("conflict")?"conflict":"invalid");
      return Response.json({revision:result.data},{headers});
    }
    if (body.data.op === "update") {
      const result = await updateStaffReport(item.id, body.data.id, body.data.expectedRevision, body.data.record, staff.id);
      return Response.json(result, { headers });
    }
    const result = await approveStaffReport(item.id, body.data.id, body.data.expectedRevision, staff.name, staff.id);
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
});
