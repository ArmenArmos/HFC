import { withRouteLogging } from "@/lib/observability/with-logging";
import { notificationsGet, notificationsPost } from '@/lib/notifications/http';
export const GET = withRouteLogging(async function GET() { return notificationsGet(true); });
export const POST = withRouteLogging(async function POST(request:Request) { return notificationsPost(request,true); });
