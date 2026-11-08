import 'server-only';
import {runMemberIdentitySearch} from '@/lib/staff/member-search-command';
import type {MemberSearchRow} from '@/lib/staff/member-search-schema';
import {readStaffMedicines,type MedicinesRpc} from '@/lib/member-medicines/server';
import {adherence,yerevanDate} from '@/lib/member-medicines/model';

const addDays=(date:string,n:number)=>new Date(Date.parse(`${date}T00:00:00Z`)+n*86_400_000).toISOString().slice(0,10);

/** Medicine doses the nurse's own members reported in the last seven days (today and the six days before, Yerevan time), as counts with
 * dates: taken, skipped (reported as skipped) and no report (nothing logged), kept apart. No score, no ranking, no threshold: the
 * counts come from the medicines model the member and doctor screens already use. A failed or disabled read is "unknown". */
export type NurseAdherenceRow={member:MemberSearchRow;medicines:{name:string;dose:string|null;source:'plan'|'self';expected:number;taken:number;skipped:number;noReport:number}[]};
export type NurseAdherence={kind:'adherence';rows:NurseAdherenceRow[];from:string;to:string;days:number;checked:number;unknown:number;truncated:boolean};
export type NurseAdherenceResult=NurseAdherence|{kind:'unavailable'};
const DAYS=7;

export async function runNurseAdherence(client:{rpc:unknown},now=new Date()):Promise<NurseAdherenceResult>{
 const found=await runMemberIdentitySearch({query:'',cursor:null},client);
 if(!found.ok)return {kind:'unavailable'};
 const rpc=client as unknown as MedicinesRpc;
 const to=yerevanDate(now),from=addDays(to,-(DAYS-1));
 const rows:NurseAdherenceRow[]=[];let unknown=0;
 for(const member of found.page.rows){
  try{
   const read=await readStaffMedicines(rpc,member.id,DAYS);
   if(!read.enabled){unknown++;continue;}
   const medicines=[
    ...read.plan.map(m=>({m,source:'plan' as const})),
    ...read.self.filter(m=>!m.stoppedAt).map(m=>({m,source:'self' as const})),
   ].map(({m,source})=>({name:m.name,dose:m.dose??null,source,...adherence(m,DAYS,now)}))
    .filter(row=>row.expected>0)
    .map(({name,dose,source,expected,taken,skipped,noReport})=>({name,dose,source,expected,taken,skipped,noReport}));
   if(medicines.length)rows.push({member,medicines});
  }catch{unknown++;}
 }
 return {kind:'adherence',rows,from,to,days:DAYS,checked:found.page.rows.length,unknown,truncated:found.page.hasMore};
}
