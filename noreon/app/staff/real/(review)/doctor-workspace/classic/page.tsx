import {notFound} from 'next/navigation';
import {doctorChatV2Enabled} from '@/lib/staff-zoe/workspace-config';
import {oldDoctorWorkspace} from '../old-workspace';

export const dynamic='force-dynamic';
// Lab reading scheduled by upload/attach actions uses the cron worker's function budget.
export const maxDuration=300;
export default async function ClassicDoctorWorkspacePage({searchParams}:{searchParams:Promise<{c?:string|string[]}>}){
 if(!doctorChatV2Enabled())notFound();
 return oldDoctorWorkspace({searchParams});
}
