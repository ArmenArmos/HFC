import {notFound,redirect} from 'next/navigation';
import type {Route} from 'next';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffNoticeDestination} from '@/lib/staff-zoe/notice-link';

/** Neutral Telegram notices land in the doctor's chat. Other roles and flag-off bookmarks keep the original page. */
export default async function StaffNoticePage({params}:{params:Promise<{path:string[]}>}){
 const {identity}=await requireRealStaffForRender();
 const {path}=await params;
 const destination=staffNoticeDestination(`/staff/real/${path.join('/')}`,identity.role);
 if(!destination)notFound();
 redirect(destination as Route);
}
