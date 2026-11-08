import { withRouteLogging } from "@/lib/observability/with-logging";
import {buildCaseLedger} from "@/lib/service-workflow/evidence-ledger";
import {validateStaffAiInput} from "@/lib/staff/ai-input";
import {validateExplanation} from '@/lib/reports/schema';
import {validateCaseSummary} from '@/lib/service-workflow/case-summary';
import {SOURCE_BOUND_OUTPUT_VERSION} from '@/lib/reports/source-bound-output';
import type {EvidenceReport} from "@/lib/service-workflow/report-evidence";
import { createHmac, randomUUID } from "node:crypto";
import { getStaff } from "@/lib/staff/auth";
import { getWorkspaceCase } from "@/lib/staff/cases";
import { boundedBody, demoAiEnabled, signDemoBody } from "@/lib/reports/demo-bridge";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };
export const POST = withRouteLogging(async function POST(request: Request) {
  if (!demoAiEnabled()) return Response.json({ error: "disabled" }, { status: 503, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "unauthorized" }, { status: 403, headers });
  const staff = await getStaff();
  if (!staff || staff.role !== "doctor") return Response.json({ error: "unauthorized" }, { status: 401, headers });
  try {
    const item = await getWorkspaceCase(new URL(request.url).searchParams.get("caseId") ?? "", staff);
    const input=JSON.parse(await boundedBody(request));
    if(!item.state.workflow) throw new Error("invalid_request");
    const context=(item:Awaited<ReturnType<typeof getWorkspaceCase>>)=>{
      if(!item.state.workflow)throw new Error('stale_evidence');
      const reports=item.reports.map(r=>({...r.record as Record<string,unknown>,id:r.id,revision:r.revision}) as EvidenceReport);
      const ledger=buildCaseLedger({workflow:item.state.workflow,assessment:item.state.state.assessment,measurements:item.state.measurements,durableMeasurements:item.monitoring?.readings??[],reports});
      return {evidenceRevision:item.state.workflow.evidenceRevision??0,evidence:ledger.evidence,reports};
    };
    const payload=validateStaffAiInput(input,context(item));
    const secret = process.env.NOREON_DEMO_AI_BRIDGE_SECRET!;
    const body = JSON.stringify({ payload, category: "staff", requestId: randomUUID(), sessionHash: createHmac("sha256", secret).update(item.id).digest("hex") });
    const timestamp = String(Date.now());
    const upstream = await fetch("https://app.noreon.health/api/internal/demo-report", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Demo-Time": timestamp, "X-Demo-Signature": signDemoBody(secret, timestamp, body) },
      body, cache: "no-store", signal: AbortSignal.timeout(105_000), redirect: "error",
    });
    const result=await upstream.json();
    if(upstream.ok) {
      // Access and evidence can change while the remote request is in flight.
      const latest=await getWorkspaceCase(item.id,staff);
      const refreshed=validateStaffAiInput(input,context(latest));
      if(JSON.stringify(refreshed)!==JSON.stringify(payload))throw new Error('stale_evidence');
      if(result.model!=='source-bound-templates'||result.prompt_version!==SOURCE_BOUND_OUTPUT_VERSION)throw new Error('invalid_output');
      if(refreshed.op==='explain')validateExplanation(result.explanation,refreshed.reviewed);
      else validateCaseSummary(result.draft,refreshed.evidence);
      const source=input.op==='explain'
        ? {reportId:input.reportId,reportRevision:input.reportRevision,contentRevision:input.contentRevision}
        : {evidenceRevision:input.evidenceRevision};
      return Response.json({...result,source}, {status:upstream.status,headers});
    }
    return Response.json(result, { status: upstream.status, headers });
  } catch(error) {
    const stale=error instanceof Error&&error.message==='stale_evidence';
    return Response.json({error:stale?'stale_evidence':'invalid_or_unavailable'},{status:stale?409:400,headers});
  }
});
