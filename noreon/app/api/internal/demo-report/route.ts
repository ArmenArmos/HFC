import { withRouteLogging } from "@/lib/observability/with-logging";
import {explanationInput} from '@/lib/reports/explanation-input';
import {sourceBoundExplanation,sourceBoundCaseSummary,SOURCE_BOUND_OUTPUT_VERSION} from '@/lib/reports/source-bound-output';
import {
  caseSummaryPayloadSchema,
  validateCaseEvidence,
  validateCaseSummary,
} from "@/lib/service-workflow/case-summary";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  boundedBody,
  DEMO_MAX_BYTES,
  verifyDemoBody,
} from "@/lib/reports/demo-bridge";
import { validateFile } from "@/lib/reports/files";
import {
  extractionSchema,
  validateExplanation,
  repairExtractionDate,
} from "@/lib/reports/schema";
import {
  callReportModel,
  REPORT_MODEL,
  PROMPT_VERSION,
  EXTRACTION_INSTRUCTION,
} from "@/lib/reports/provider";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };
const payloadSchema = z.discriminatedUnion("op", [
  caseSummaryPayloadSchema,
  z
    .object({
      op: z.literal("extract"),
      consent: z.literal(true),
      mime: z.enum(["application/pdf", "image/png", "image/jpeg"]),
      data: z.string().min(1).max(2800000),
    })
    .strict(),
  z
    .object({
      op: z.literal("explain"),
      consent: z.literal(true),
      locale: z.enum(["en", "hy"]),
      reviewed: extractionSchema,
    })
    .strict(),
]);
export const POST = withRouteLogging(async function POST(request: Request) {
  if (
    process.env.NOREON_DEPLOYMENT_TARGET !== "app" ||
    process.env.NEXT_PUBLIC_PATIENT_DEMO === "true" ||
    process.env.NOREON_DEMO_AI_ENABLED !== "true" ||
    !process.env.OPENAI_API_KEY
  )
    return Response.json({ error: "disabled" }, { status: 503, headers });
  try {
    const body = await boundedBody(request);
    if (
      !verifyDemoBody(
        process.env.NOREON_DEMO_AI_BRIDGE_SECRET ?? "",
        request.headers.get("x-demo-time") ?? "",
        body,
        request.headers.get("x-demo-signature") ?? "",
      )
    )
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const input = z
      .object({
        requestId: z.string().uuid(),
        sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
        // Missing only for callers from before quota isolation. Never infer staff from payload.
        category: z.enum(["member", "staff"]).default("member"),
        payload: payloadSchema,
      })
      .strict()
      .parse(JSON.parse(body));
    const payload = input.payload;
    // Clinical prose is not delegated to the model. Source-bound summaries do
    // not consume model quota or leave this service for an AI provider.
    if(payload.op==='case-summary') {
      if(input.category!=='staff')return Response.json({error:'unauthorized'},{status:403,headers});
      const evidence=validateCaseEvidence(payload.evidence);
      return Response.json({draft:validateCaseSummary(sourceBoundCaseSummary(evidence),evidence),model:'source-bound-templates',prompt_version:SOURCE_BOUND_OUTPUT_VERSION},{headers});
    }
    if(payload.op==='explain') {
      const reviewed=explanationInput(payload.reviewed);
      return Response.json({explanation:validateExplanation(sourceBoundExplanation(reviewed,payload.locale),reviewed),model:'source-bound-templates',prompt_version:SOURCE_BOUND_OUTPUT_VERSION},{headers});
    }
    let validatedFile: { pages: number; checksum: string } | undefined;
    if (payload.op === "extract") {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload.data))
        throw new Error("invalid_file");
      const bytes = Buffer.from(payload.data, "base64");
      if (!bytes.length || bytes.length > DEMO_MAX_BYTES)
        throw new Error("invalid_file");
      try {
        validatedFile = await validateFile(bytes, payload.mime);
      } catch {
        throw new Error("invalid_file");
      }
    }
    const admin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const claim = await admin.rpc("claim_demo_report_ai", {
      p_request_id: input.requestId,
      p_session_hash: input.sessionHash,
      p_category: input.category,
    });
    if (claim.error) throw new Error("unavailable");
    if (!claim.data)
      return Response.json({ error: "daily_limit" }, { status: 429, headers });
    const base = { key: process.env.OPENAI_API_KEY!, model: REPORT_MODEL };
    if (payload.op === "extract") {
      const file = validatedFile!;
      const dataUrl = `data:${payload.mime};base64,${payload.data}`;
      const content =
        payload.mime === "application/pdf"
          ? [{ type: "input_file", filename: "report.pdf", file_data: dataUrl }]
          : [{ type: "input_image", image_url: dataUrl, detail: "high" }];
      const extraction = repairExtractionDate(
        await callReportModel({
          ...base,
          instruction: EXTRACTION_INSTRUCTION,
          content,
          schema: extractionSchema,
        }),
      );
      if (extraction.rows.some((row) => row.page > file.pages))
        throw new Error("provider_invalid");
      return Response.json(
        { extraction, pages: file.pages, model: REPORT_MODEL, prompt_version:PROMPT_VERSION },
        { headers },
      );
    }
    throw new Error('invalid_request');
  } catch (error) {
    const code =
      error instanceof Error &&
      ["invalid_file", "invalid_date"].includes(error.message)
        ? error.message
        : "unavailable";
    return Response.json({ error: code }, { status: 400, headers });
  }
});
