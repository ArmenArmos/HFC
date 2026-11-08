import {withRouteLogging} from '@/lib/observability/with-logging';
import {
  executeReport,
  listReports,
  reportContext,
} from "@/lib/reports/server";
export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  const allowed = [
    "disabled",
    "unauthorized",
    "invalid",
    "invalid_file",
    "not_found",
    "conflict",
    "daily_limit",
    "duplicate",
    "upload_failed",
    "cleanup_pending",
    "processing_failed",
  ];
  const reason =
    error instanceof Error && allowed.includes(error.message)
      ? error.message
      : "unavailable";
  return Response.json(
    { error: reason },
    {
      status:
        reason === "unauthorized" ? 401 : reason === "disabled" || reason === "unavailable" ? 503 : 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export const GET=withRouteLogging(async function GET() {
  try {
    return Response.json(
      { reports: await listReports(await reportContext()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
});
export const POST=withRouteLogging(async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new Error("unauthorized");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new Error("invalid");
    const ctx = await reportContext();
    // Read a bounded stream; a forged or missing Content-Length cannot bypass it.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("invalid");
    let text = "",
      size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 128000) {
        await reader.cancel();
        throw new Error("invalid");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("invalid");
    }
    return Response.json(await executeReport(ctx, body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
});
