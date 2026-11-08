import {createRealtimeTokenHandler,realtimeTokenPorts} from '@/lib/realtime/token-http';
import {withRouteLogging} from '@/lib/observability/with-logging';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** WP R: the socket token for the caller's session on ?plane=member|staff|clinic. Logging records route, status and ids only; never the token. */
export const POST=withRouteLogging(createRealtimeTokenHandler(realtimeTokenPorts));
