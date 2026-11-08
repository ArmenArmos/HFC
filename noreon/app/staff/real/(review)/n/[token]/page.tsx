import Link from 'next/link';
import {redirect} from 'next/navigation';
import type {Route} from 'next';
import {z} from 'zod';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffTokenNoticeDestination} from '@/lib/staff-zoe/notice-link';
import {doctorHomePath} from '@/lib/staff-zoe/workspace-config';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';

const resolvedNotice=z.array(z.object({member_id:z.uuid(),alert_id:z.uuid().nullable()})).length(1);

/** Sign-in is handled by the review layout; only this RPC can disclose the destination. */
export default async function StaffTokenNoticePage({params}:{params:Promise<{token:string}>}){
 const {client,identity}=await requireRealStaffForRender();
 const {token}=await params;
 const result=await Promise.resolve().then(()=>client.rpc('staff_notice_resolve',{p_token:token})).catch(()=>null);
 const notice=resolvedNotice.safeParse(result?.error?null:result?.data);
 if(notice.success)redirect(staffTokenNoticeDestination(notice.data[0].member_id,identity.role,process.env,notice.data[0].alert_id) as Route);
 const locale=await staffLocale(identity.role);
 return <section lang={locale} className="mx-auto max-w-md space-y-4 px-5 py-12">
  <h1 className="text-h1">{st(locale,"This link isn't available for you",'Այս հղումը հասանելի չէ ձեզ','Эта ссылка вам недоступна')}</h1>
  <Link href={doctorHomePath(identity.role)} className="inline-flex min-h-11 items-center text-body2 underline underline-offset-4">{st(locale,'Go home','Գլխավոր էջ','На главную')}</Link>
 </section>;
}
