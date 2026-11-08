import {withRouteLogging} from '@/lib/observability/with-logging';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {EXPORT_LIMIT,auditPageSchema,parseFilters,rpcArgs,toCsv,withDefaultWindow,type AuditRpc} from '@/lib/activity-log/contracts';
export const dynamic='force-dynamic';

/** Admin CSV of the filtered activity. The database records the export before returning rows. */
export const GET=withRouteLogging(async function GET(request:Request){
 const {client:sessionClient}=await requireRealAdmin();
 const client=sessionClient as unknown as AuditRpc;
 const asked=parseFilters(Object.fromEntries(new URL(request.url).searchParams));
 if(asked.memberInvalid)return new Response('Not a member reference.',{status:400});
 const filters=withDefaultWindow(asked);
 const {data,error}=await client.rpc('admin_audit_log_export',{...rpcArgs(filters),p_profile_values:true});
 if(error)return new Response('The audit log could not load. Try again.',{status:503});
 const parsed=auditPageSchema.safeParse(data);
 if(!parsed.success)return new Response('The audit log could not load. Try again.',{status:503});
 const page=parsed.data;
 // More rows match than one file holds: refuse rather than hand over a silently truncated list.
 if(page.next)return new Response(`More than ${EXPORT_LIMIT.toLocaleString('en')} rows match these filters. Go back and choose a shorter date range, a person, a member or a type of action, then download again.`,{status:400,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'private, no-store'}});
 const stampName=new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
 return new Response(toCsv(page.rows),{headers:{
  'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="noreon-activity-${stampName}.csv"`,
  'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 }});
});
