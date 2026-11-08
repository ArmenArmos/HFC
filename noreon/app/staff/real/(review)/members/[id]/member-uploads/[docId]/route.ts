import { withRouteLogging } from "@/lib/observability/with-logging";
import { requireRealStaff } from "@/lib/patient-care/clinical-case-repository";
import { documentBytesResponse } from "@/lib/member-history/server";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A member's own earlier result, opened by their assigned doctor. RLS on the row decides access. */
export const GET = withRouteLogging(async function GET(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const { client, identity } = await requireRealStaff();
  if (identity.role !== "doctor") return new Response(null, { status: 404 });
  const response = await documentBytesResponse(client, id, docId, "staff");
  const page = z.coerce.number().int().min(1).max(500).safeParse(new URL(request.url).searchParams.get("page"));
  if (!response.ok || response.headers.get("Content-Type") !== "application/pdf" || !page.success) return response;
  // Use the already audited, hash-checked bytes. iOS Safari frames only the first
  // page, so serve the requested page as its own PDF, as for clinic lab results.
  const bytes = new Uint8Array(await response.arrayBuffer());
  let preview = bytes;
  try {
    const source = await PDFDocument.load(bytes);
    if (page.data <= source.getPageCount()) {
      const single = await PDFDocument.create();
      const [copy] = await single.copyPages(source, [page.data - 1]);
      single.addPage(copy);
      preview = new Uint8Array(await single.save());
    }
  } catch { /* Preserve the original-file fallback used by the lab preview. */ }
  return new Response(preview, { status: response.status, headers: response.headers });
});
