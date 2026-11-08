import {withRouteLogging} from '@/lib/observability/with-logging';
import {handleMemberConversation} from '@/lib/conversation-persistence/member-handler';
import {authenticatedMemberConversation} from '@/lib/conversation-persistence/server';
export const runtime='nodejs';
export const POST=withRouteLogging(async function POST(request:Request){return handleMemberConversation(request,{env:process.env,authenticate:authenticatedMemberConversation});});
