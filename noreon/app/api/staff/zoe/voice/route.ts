import {staffVoiceHandlers} from '@/lib/staff-zoe/voice-http';
import {withRouteLogging} from '@/lib/observability/with-logging';
export const runtime='nodejs';
/** Logging captures route/status/ids only. Audio and draft text are never persisted. */
export const POST=withRouteLogging(staffVoiceHandlers.voice);
