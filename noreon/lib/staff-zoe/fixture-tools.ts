import type {DoctorLdlOn} from '@/lib/ldl/schema';
import type {DoctorLdlResponse} from '@/lib/ldl/response-schema';
import type {BpWeekRead} from '@/lib/bp-week/model';
import type {StaffMedicinesRead} from '@/lib/member-medicines/model';
import type {StaffLabResults} from '@/lib/lab-ai/staff-results';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import type {DoctorInbox} from '@/lib/doctor-inbox/contracts';
import type {PlanVersion} from '@/lib/doctor-completion/version-schema';
import type {CoordinationTask} from '@/lib/staff/real-coordination/schema';
import type {DoctorConcern,StaffReason} from '@/lib/member-medicines/asks';
import type {NurseVisitRecord} from '@/lib/nurse-visit/schema';
import type {L,StaffZoeRole,ToolId,ToolResult} from './contracts';
import {adherenceResult,bpResult,emptyResult,labsResult,ldlResult,messagesResult,openItemsResult,overviewResult,planResult,visitsResult} from './facts';

/** The same fact builders as server.ts over stored read shapes, for checks and the eval: no database, no network. */
export type ContextReads={memberId:string;snapshot:ClinicalSnapshot|null;bpWeek:BpWeekRead|null;labs:StaffLabResults|null;ldl:DoctorLdlOn|null;responses:DoctorLdlResponse[]|null;versions:PlanVersion[]|null;
 medicines:StaffMedicinesRead|null;reasons:StaffReason[];concerns:DoctorConcern[]|null;inbox:DoctorInbox|null;tasks:CoordinationTask[]|null;visits:Extract<NurseVisitRecord,{enabled:boolean}>|null;messages:{seq:number;text:string;at:string}[];zoeReplies?:{id:string;answer:string|null;finishedAt:string}[]};

export async function fixtureRead(x:ContextReads,tool:ToolId,role:StaffZoeRole,locale:L,now:Date):Promise<ToolResult>{
 const c={memberId:x.memberId,role,locale,now};
 const none=(s:'off'|'unavailable'|'not_permitted')=>emptyResult(tool,s,x.memberId,role);
 switch(tool){
  case 'overview':return x.snapshot?overviewResult(x.snapshot,c):none('unavailable');
  case 'bp':return x.bpWeek||x.snapshot?bpResult(x.bpWeek,x.snapshot,c):none('unavailable');
  case 'labs':return role!=='doctor'?none('not_permitted'):x.labs?labsResult(x.labs,c):none('unavailable');
  case 'ldl':return role!=='doctor'?none('not_permitted'):x.ldl?ldlResult(x.ldl,x.responses,c):none('unavailable');
  case 'plan':return x.snapshot?planResult(x.snapshot,role==='doctor'?x.versions:x.versions?.map(v=>({...v,changeSummary:null}))??null,c):none('unavailable');
  case 'adherence':return !x.medicines?none('unavailable'):!x.medicines.enabled?none('off'):adherenceResult(x.medicines,x.reasons,role==='doctor'?x.concerns:null,c);
  case 'open_items':return openItemsResult({inbox:role==='doctor'?x.inbox:null,tasks:x.tasks},c);
  case 'visits':return x.visits?visitsResult(x.visits,c):none('unavailable');
  case 'member_messages':return messagesResult(x.messages,c,[],x.zoeReplies);
  case 'zoe_why':return emptyResult('zoe_why',role==='doctor'?'none':'not_permitted',x.memberId,role);
  case 'lipid_plan':return none('off');
 }
}
