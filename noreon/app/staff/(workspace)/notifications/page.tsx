import { requireStaff } from '@/lib/staff/auth';
import { Inbox } from '@/components/notifications/inbox';
export default async function Page(){await requireStaff();return <><h1 className="mb-5 text-h1 font-semibold">Your notifications</h1><Inbox staff /></>;}
