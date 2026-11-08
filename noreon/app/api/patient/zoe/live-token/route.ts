import {createLiveTokenHandler,memberLivePorts} from '@/lib/zoe-chat-actions/live-token-http';
import {withRouteLogging} from '@/lib/observability/with-logging';
export const runtime='nodejs';
/** A single-use Gemini Live token for the member or caregiver session. Logging records route, status and ids only; never the token. */
export const POST=withRouteLogging(createLiveTokenHandler(memberLivePorts));
