import Link from 'next/link';
import type {Route} from 'next';
import {doctorWorkspaceEnabled} from '@/lib/staff-zoe/workspace-config';
import {st} from '@/lib/staff/staff-locale-copy';
import {notFound} from 'next/navigation';
import {z} from 'zod';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffLocale} from '@/lib/staff/staff-locale';
import {conversationReadSchema,recentSchema,type ConversationRead} from '@/lib/staff-zoe/contracts';
import {StaffZoePane} from '@/components/staff/zoe/staff-zoe-pane';

export const dynamic='force-dynamic';
type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};

/** Doctor Zoe (dark: staff_zoe_settings.staff_zoe_enabled). Doctors and nurses; the database decides on every read. */
export default async function StaffZoePage({searchParams}:{searchParams:Promise<{c?:string|string[]}>}){
 const {client,identity}=await requireRealStaffForRender();
 if(identity.role==='admin')notFound();
 const rpc=client as unknown as Rpc;
 const on=await rpc.rpc('staff_zoe_status').then(r=>r.data===true,()=>false);
 if(!on)notFound();
 const locale=await staffLocale(identity.role);
 const asked=z.uuid().safeParse((await searchParams).c);
 let conversation:ConversationRead|null=null,refused=false;
 if(asked.success){
  const r=await rpc.rpc('staff_zoe_read',{p_conversation:asked.data});
  const p=conversationReadSchema.safeParse(r.data);
  if(r.error||!p.success||!p.data.enabled)refused=true;else conversation=p.data;
 }
 const recent=recentSchema.safeParse((await rpc.rpc('staff_zoe_recent')).data);
 return <>{identity.role==='doctor'&&doctorWorkspaceEnabled()&&<Link href={(conversation?`/staff/real/doctor-workspace?c=${conversation.id}`:'/staff/real/doctor-workspace') as Route} className="mb-4 inline-flex min-h-11 items-center rounded-full border bg-background px-4 text-body2 underline underline-offset-4">{st(locale,'Open your workspace with Zoe','Բացել ձեր աշխատատարածքը Զոյայի հետ','Открыть рабочее пространство с Зоей')}</Link>}<StaffZoePane key={conversation?.id??'none'} role={identity.role==='nurse'?'nurse':'doctor'} locale={locale} conversation={conversation} refused={refused} recent={recent.success&&recent.data.enabled?recent.data.rows:[]}/></>;
}
