import {createSpeechStreamHandler,staffSpeechStreamPorts} from '@/lib/zoe-chat-actions/speech-stream';
import {withRouteLogging} from '@/lib/observability/with-logging';
export const runtime='nodejs';
/** The staff assistant's rendered reply as streamed speech chunks. No storage; logging records route and status only. */
export const POST=withRouteLogging(createSpeechStreamHandler(staffSpeechStreamPorts));
