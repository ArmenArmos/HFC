import 'server-only';
import {z} from 'zod';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {clinicalWriteClient} from '@/lib/patient-care/clinical-publication-server';
import {labAppointmentSnapshot} from './labs-contract';
import {labCardDue,labCardRequestId} from './lab-schedule';
import type {AdminQueueRpc} from './raise-admin-task';
import {syncLivingVisit} from './living-visit-read';
const candidates=z.array(labAppointmentSnapshot.extend({memberId:z.uuid(),quietStart:z.string(),quietEnd:z.string(),postedKinds:z.array(z.enum(['prep','fasting'])).default([])}));
/** App cards only. No channel notice, provider, model or outbound dispatch is used here. */
export async function runLabCardSweep(env:Record<string,string|undefined>=process.env,now=new Date(),client?:AdminQueueRpc){
 const report={posted:0,replayed:0,failed:0,stoppedForTime:false};
 if(!zoeAppV3Enabled(env))return report;
 const rpc=client??clinicalWriteClient()as unknown as AdminQueueRpc;
 try{
  const deadline=Date.now()+20_000;
  let after:string|null=null,afterId:string|null=null;
  while(Date.now()<deadline){
   const {data,error}=await rpc.rpc('zoe_v3_lab_candidates',{p_limit:100,p_after:after,p_after_id:afterId});
   const list=error?null:candidates.safeParse(data);
   if(!list?.success)return {...report,failed:1};
   for(const a of list.data){
    if(env.NOREON_MEMBER_CHAT_V2==='true'){
     try{
      const card=await syncLivingVisit(async(name,args)=>{const r=await rpc.rpc(name,args);if(r.error)throw Error('Visit status unavailable');return r.data;},a.memberId);
      if(card?.valid&&card.kind==='visit'&&card.snapshot.living?.visitId===a.appointmentId)continue;
     }catch{report.failed++;continue;}
    }
    for(const kind of ['prep','fasting']as const){
    if(Date.now()>=deadline){report.stoppedForTime=true;return report;}
    if(a.postedKinds.includes(kind)||!labCardDue(a,kind,now))continue;
    const {data:stored,error:failed}=await rpc.rpc('zoe_v3_lab_card_post',{p_appointment:a.appointmentId,p_revision:a.revision,p_kind:kind,p_request:labCardRequestId(a,kind)});
    const result=stored as {ok?:boolean;replayed?:boolean;code?:string}|null;
    if(!failed&&result?.ok){if(result.replayed)report.replayed++;else report.posted++;}
    else if(result?.code!=='stale'&&result?.code!=='disabled')report.failed++;
    }
   }
   if(list.data.length<100)return report;
   const last=list.data.at(-1)!;after=last.startsAt;afterId=last.appointmentId;
  }
  report.stoppedForTime=true;
 }catch{report.failed++;}
 return report;
}
