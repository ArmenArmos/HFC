import {staffVoiceHandlers} from '@/lib/staff-zoe/voice-http';
import {withRouteLogging} from '@/lib/observability/with-logging';
export const runtime='nodejs';
export const POST=withRouteLogging(staffVoiceHandlers.speech);
