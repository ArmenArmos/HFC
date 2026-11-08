import { withRouteLogging } from "@/lib/observability/with-logging";
import { readClinicUploadBody } from "@/lib/clinic-portal/upload-server";
import { MEMBER_UPLOAD_MAX_BYTES } from "@/lib/member-history/measures";
import { storeOwnDocument } from "@/lib/member-history/server";
import { sameWorkspaceOrigin } from "@/lib/staff/request";
import { scheduleLabRead } from "@/lib/lab-ai/upload-trigger";
import { zoeAppV3Enabled } from "@/lib/patient/zoe-app-v3";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The reading started after the upload (below) may take a few model calls.
export const maxDuration = 300;
const noStore = { "Cache-Control": "private, no-store" };
/** One raw file body per request; the file's content decides its type, not its name or header. */
export const PUT = withRouteLogging(async function PUT(request: Request) {
 const requestStartedAt=Date.now();
  if (!sameWorkspaceOrigin(request)) return Response.json({ status: "access" }, { status: 403, headers: noStore });
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MEMBER_UPLOAD_MAX_BYTES)) return Response.json({ status: "too-large" }, { status: 413, headers: noStore });
  let bytes: Buffer;
  try { bytes = await readClinicUploadBody(request.body, MEMBER_UPLOAD_MAX_BYTES); }
  catch { return Response.json({ status: "too-large" }, { status: 413, headers: noStore }); }
  let fileName = "document";
  try { fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "document"); } catch {}
  const resultDate = request.headers.get("x-result-date") || null;
  const savedNotRead = zoeAppV3Enabled();
  const result = await storeOwnDocument({ bytes, fileName, resultDate, savedNotRead });
  if (result.status === "stored" && !savedNotRead) scheduleLabRead(result.id,requestStartedAt);
  const status = result.status === "stored" ? 200 : result.status === "access" ? 403 : result.status === "unavailable" ? 503 : result.status === "too-large" ? 413 : result.status === "rate-limited" ? 429 : 400;
  return Response.json(result, { status, headers: noStore });
});
