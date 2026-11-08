import 'server-only';
import {runMemberIdentitySearch} from '@/lib/staff/member-search-command';
import type {MemberSearchRow} from '@/lib/staff/member-search-schema';
import {readBpMemberDevices,type BpRpc} from '@/lib/bp-device/runtime';
import {bpDevicesEnabled} from '@/lib/bp-device/config';
import {addDays,yerevanDate} from '@/lib/bp-week/model';

/** Members of this nurse with no blood pressure reading this week (Monday to now, Yerevan time), from the first page of the
 * nurse's own assigned list. A reading of any source counts. A failed or disabled read is "unknown", never "has not logged". */
export type NurseMissingBp={kind:'missing-bp';rows:MemberSearchRow[];from:string;to:string;unknown:number;checked:number;truncated:boolean};
export type NurseCohortResult=NurseMissingBp|{kind:'unavailable'};

export async function runNurseMissingBp(client:{rpc:unknown},env:Record<string,string|undefined>=process.env,now=new Date()):Promise<NurseCohortResult>{
 if(!bpDevicesEnabled(env))return {kind:'unavailable'};
 const found=await runMemberIdentitySearch({query:'',cursor:null},client);
 if(!found.ok)return {kind:'unavailable'};
 const today=yerevanDate(now),weekday=new Date(`${today}T00:00:00Z`).getUTCDay(),from=addDays(today,-((weekday+6)%7));
 const rows:MemberSearchRow[]=[];let unknown=0;
 const bp=client as unknown as BpRpc;
 for(const row of found.page.rows){
  try{
   const data=await readBpMemberDevices(bp,row.id);
   if(!data.readings){unknown++;continue;}
   if(!data.readings.some(reading=>yerevanDate(new Date(reading.measuredAt))>=from&&Date.parse(reading.measuredAt)<=now.getTime()))rows.push(row);
  }catch{unknown++;}
 }
 return {kind:'missing-bp',rows,from,to:today,unknown,checked:found.page.rows.length,truncated:found.page.hasMore};
}
