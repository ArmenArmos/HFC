import {createLiveTokenHandler,staffLivePorts} from '@/lib/zoe-chat-actions/live-token-http';
import {withRouteLogging} from '@/lib/observability/with-logging';
export const runtime='nodejs';
/** A single-use Gemini Live token for every staff role, including coordinators and administrators. Never logs the token. */
export const POST=withRouteLogging(createLiveTokenHandler(staffLivePorts));
