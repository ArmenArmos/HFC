import 'server-only';
import {z} from 'zod';
import {readRealOperationsSummary} from '@/lib/staff/real-operations-summary-model';
import {memberSearchPageSchema,type MemberSearchPage} from '@/lib/staff/member-search-schema';
import {callbackRowSchema} from '@/lib/staff/member-callbacks';
import {registrationsSchema} from '@/lib/registrations/contracts';
import {taskPageSchema,type CoordinationTaskPage} from '@/lib/staff/real-coordination/schema';
import {deliveryProblemsSchema} from '@/lib/conversation-persistence/contracts';
import {readAppointmentSummary,type BookingRpc} from '@/lib/real-booking/appointment-runtime';
import {adminLdlRetestsSchema} from '@/lib/ldl/response-schema';
import {uniqueWork,type AdminIntent,type OperationsView} from './contracts';

// Bound each source, and report that boundary rather than implying a complete queue.
const MAX_PAGES=10;
export async function readAdminOperations(rpc:BookingRpc,intent:AdminIntent,{telegram,portal=false,now=new Date().toISOString()}:{telegram:boolean;portal?:boolean;now?:string}):Promise<OperationsView>{
 const view:OperationsView={intent,asOf:now,summary:null,items:[],unavailable:[],partial:[],disabled:[],notices:[]};
 const sources:AdminIntent[]=intent==='overdue'?['unassigned','registrations','callbacks','bookings','delivery','overdue']:[intent];
 const wants=(source:AdminIntent)=>sources.includes(source);
 const read=async<T>(name:string,schema:z.ZodType<T>,args?:Record<string,unknown>):Promise<T>=>{
  const result=await rpc.rpc(name,args);
  if(result.error)throw Error('Operations source unavailable');
  const parsed=schema.safeParse(result.data);
  if(!parsed.success)throw Error('Operations source invalid');
  return parsed.data;
 };
 const source=async(name:AdminIntent,run:()=>Promise<void>)=>{
  try{await run();}catch{view.unavailable.push(name);}
 };
 if(intent==='operations'){
  const result=await readRealOperationsSummary(()=>rpc.rpc('real_admin_operations_summary'));
  if(result.status==='available')view.summary=result.summary;else view.unavailable.push('operations');
  return view;
 }
 // The member search is the existing admin Requests reader, oldest first. Read once
 // when assembling the combined queue; no clinical case snapshots are requested.
 const memberSource=sources.find(name=>['unassigned','bookings','doctor-waiting','nurse-waiting','test-requests'].includes(name));
 if(memberSource)await source(memberSource,async()=>{
  let cursor:MemberSearchPage['nextCursor']=null;
  for(let pageNumber=0;pageNumber<MAX_PAGES;pageNumber++){
   const page:MemberSearchPage=await read('patient_clinical_case_search',memberSearchPageSchema,{p_query:'',p_after_created_at:cursor?.createdAt,p_after_user_id:cursor?.id});
   for(const row of page.rows){
    if((wants('unassigned')&&(!row.doctorId||!row.nurseId))||(wants('doctor-waiting')&&!row.doctorId)||(wants('nurse-waiting')&&!row.nurseId))view.items.push({id:`assignment:${row.id}`,kind:'assignment',memberName:row.name,owner:'admin',ownerName:null,since:row.createdAt,dueAt:null,href:`/staff/real/members/${row.id}`});
    const count=row.bookingCounts.requested+row.bookingCounts.providerProposed+row.bookingCounts.changePending;
    if(wants('test-requests')&&count>0)view.items.push({id:`test-request:${row.id}`,kind:'test-request',memberName:row.name,owner:'admin',ownerName:null,since:null,dueAt:null,requestCount:count,href:`/staff/real/members/${row.id}`});
   }
   if(wants('bookings')){
    // Small batches avoid an unbounded concurrent per-member fan-out. This existing
    // summary path reads saved bookings, never seals a programme or sends a notice.
    for(let offset=0;offset<page.rows.length;offset+=5)await Promise.all(page.rows.slice(offset,offset+5).map(row=>source('bookings',async()=>{
     const data=await readAppointmentSummary({memberId:row.id,read:rpc,portal},{requirePortal:true});
     for(const booking of data.appointments){
      if(booking.status!=='notification-pending')continue;
      // A pending cancellation is not a booking waiting for a clinic. The
      // authoritative purpose is supplied by the existing details reader.
      if(!booking.noticePurpose){view.unavailable.push('bookings');continue;}
      if(booking.noticePurpose==='cancellation')continue;
      const clinicPending=booking.portal?.channel==='portal'&&booking.portal.noticeState==='pending';
      const proposal=clinicPending?booking.portal?.proposal:null;
      const since=proposal?.createdAt??booking.history?.find(entry=>entry.revision===booking.revision)?.createdAt??null;
      view.items.push({id:`booking:${booking.id}`,kind:'booking',memberName:row.name,
       owner:proposal?'member':clinicPending?'clinic':'admin',ownerName:clinicPending&&!proposal?data.clinics?.[booking.proposed.clinicId]??null:null,
       bookingState:proposal?'member-proposal':clinicPending?'clinic-response':booking.canStartScheduling?'start-scheduling':'check-scheduling',
       since,dueAt:null,href:`/staff/real/members/${row.id}`});
     }
    })));
   }
   if(!page.hasMore)return;
   cursor=page.nextCursor;
  }
  if(wants('unassigned'))view.partial.push('unassigned');
  if(wants('bookings'))view.partial.push('bookings');
  if(!wants('unassigned')&&!wants('bookings'))view.partial.push(memberSource);
 });
 if(wants('bookings')&&view.unavailable.includes('unassigned'))view.unavailable.push('bookings');
 if(wants('registrations'))await source('registrations',async()=>{
  const data=await read('admin_member_registrations',registrationsSchema,{p_limit:500});
  if(data.matching>data.rows.length)view.partial.push('registrations');
  // Once enrolled, assignment/booking/tasks represent the actual pending work.
  for(const row of data.rows)if(!row.enrolled)view.items.push({id:`registration:${row.id}`,kind:'registration',memberName:row.name,owner:'member',ownerName:null,since:row.stepAt??row.signedUpAt,dueAt:null,href:'/staff/real/registrations'});
 });
 if(wants('callbacks'))await source('callbacks',async()=>{
  const rows=await read('staff_callback_queue',z.array(callbackRowSchema));
  // The RPC caps the newest 200 requests before separating open and closed ones.
  // At that boundary older open requests may be absent, even if every row is closed.
  if(rows.length>=200)view.partial.push('callbacks');
  for(const row of rows)if(row.state==='open')view.items.push({id:`callback:${row.id}`,kind:'callback',memberName:row.memberName,owner:'admin',ownerName:null,since:row.createdAt,dueAt:null,href:'/staff/real/callbacks'});
 });
 // Members whose LDL re-test window has passed (the re-test after a change to lipid treatment). The count is the number of members: one re-test row each.
 if(intent==='ldl-overdue')await source('ldl-overdue',async()=>{
  const data=await read('admin_ldl_retests',adminLdlRetestsSchema);
  if(!data.enabled){view.disabled.push('ldl-overdue');return;}
  for(const item of data.items)if(item.kind==='overdue'||item.overdue)view.items.push({id:`ldl-retest:${item.id}`,kind:'ldl-retest',memberName:item.memberName,owner:item.doctorName?'doctor':'admin',ownerName:item.doctorName,since:item.overdueAt??item.dueTo+'T00:00:00Z',dueAt:item.dueTo+'T00:00:00Z',href:`/staff/real/members/${item.memberId}`});
 });
 if(wants('delivery')){
  if(!telegram)view.disabled.push('delivery');
  else await source('delivery',async()=>{
   const data=await read('telegram_delivery_problems',deliveryProblemsSchema);
   for(const row of data.system)view.items.push({id:`delivery:system:${row.id}`,kind:'delivery',memberName:row.memberName,owner:'admin',ownerName:null,since:row.createdAt,dueAt:null,href:'/staff/real/delivery-problems'});
   for(const row of data.replies)view.items.push({id:`delivery:reply:${row.id}`,kind:'delivery',memberName:row.memberName,owner:'doctor',ownerName:row.doctorName,since:row.approvedAt,dueAt:null,href:'/staff/real/delivery-problems'});
   // The existing reader covers problems from the last 30 days. Preserve that scope.
   if(data.unapprovedHeld)view.notices.push('held-wording');
   if(data.inbox.dead)view.notices.push('incoming-failed');
   if(data.inbox.pending)view.notices.push('incoming-pending');
  });
 }
 if(intent==='overdue'||intent==='tasks')await source(intent,async()=>{
  let cursor:{createdAt:string;id:string}|null=null;
  for(let pageNumber=0;pageNumber<MAX_PAGES;pageNumber++){
   const page:CoordinationTaskPage=await read('patient_coordination_queue',taskPageSchema,{p_filter:'active',p_limit:50,p_after_created_at:cursor?.createdAt,p_after_id:cursor?.id});
   for(const task of page.tasks){
    if(task.status==='completed'||task.status==='cancelled')continue;
    const owner=task.eligibleOwners.find(o=>o.id===task.ownerId);
    view.items.push({id:`task:${task.id}`,kind:'task',memberName:task.memberName,owner:task.needsReassignment||!owner?'admin':owner.role,ownerName:task.needsReassignment||!owner?null:task.ownerName,since:task.createdAt,dueAt:task.dueAt,href:'/staff/real/tasks'});
   }
   if(!page.nextCursor)return;
   cursor=page.nextCursor;
  }
  view.partial.push(intent);
 });
 view.items=uniqueWork(view.items);
 view.unavailable=[...new Set(view.unavailable)];
 return view;
}
