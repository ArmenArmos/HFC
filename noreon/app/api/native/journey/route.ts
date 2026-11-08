import { withRouteLogging } from "@/lib/observability/with-logging";
import { createNativeJourneyHandler } from "@/lib/patient/native-journey";
import {
  createNativeJourneyContext,
  nativeJourneyEnabled,
} from "@/lib/patient/native-journey-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const handler = createNativeJourneyHandler({
  enabled: () => nativeJourneyEnabled(process.env),
  context: (token, signal) =>
    createNativeJourneyContext(token, signal, process.env),
});
export const GET = withRouteLogging(handler);
export const POST = withRouteLogging(handler);
