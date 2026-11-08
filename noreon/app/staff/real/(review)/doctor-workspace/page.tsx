import {redirect} from 'next/navigation';
import type {Route} from 'next';
import {doctorChatV2Enabled} from '@/lib/staff-zoe/workspace-config';
import {doctorChatPage} from '@/components/doctor-chat-v2/doctor-chat-page';
import {oldDoctorWorkspace} from './old-workspace';

export const dynamic='force-dynamic';
// Lab reading scheduled by upload/attach actions uses the cron worker's function budget.
export const maxDuration=300;
export default async function DoctorWorkspacePage({searchParams}:{searchParams:Promise<{c?:string|string[]}>}){
 if(doctorChatV2Enabled()){
  const {c}=await searchParams;
  // A selected conversation only exists in the old workspace, whose links and bookmarks still use this address.
  if(typeof c==='string')redirect(`/staff/real/doctor-workspace/classic?c=${encodeURIComponent(c)}` as Route);
  const chat=await doctorChatPage();if(chat)return chat;
 }
 return oldDoctorWorkspace({searchParams});
}
