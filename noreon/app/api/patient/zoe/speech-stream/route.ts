import {createSpeechStreamHandler,memberSpeechStreamPorts} from '@/lib/zoe-chat-actions/speech-stream';
import {withRouteLogging} from '@/lib/observability/with-logging';
export const runtime='nodejs';
/** Zoe's reply as sentence chunks streamed while they are synthesized. No storage; logging records route and status only. */
export const POST=withRouteLogging(createSpeechStreamHandler(memberSpeechStreamPorts));
