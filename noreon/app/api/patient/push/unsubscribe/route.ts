import { memberPushRequest } from '@/lib/member-push/routes';
import { withRouteLogging } from '@/lib/observability/with-logging';
export const runtime = 'nodejs';
export const POST = withRouteLogging((request: Request) => memberPushRequest(request, 'unsubscribe'));
