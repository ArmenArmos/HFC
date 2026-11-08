import { withRouteLogging } from "@/lib/observability/with-logging";
import { ownDocumentResponse } from "@/lib/member-history/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withRouteLogging(async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownDocumentResponse((await params).id);
});
