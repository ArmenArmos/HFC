import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {getCareData} from '@/lib/patient-care/repository';
import {memberLdl} from '@/lib/ldl/member';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {dosesForDay} from '@/lib/patient-care/model';
import {planDetails,planRemindersAllowed,planStateSchema,type PlanState} from './plan';

/** Narrow RPC interface until the lead replays the migration and regenerates database types. */
type PlanRpc={rpc(name:'zoe_v3_plan_state'):PromiseLike<{data:unknown;error:unknown}>};
export async function readPlanState():Promise<PlanState|null>{
 if(!zoeAppV3Enabled())return null;
 const {data,error}=await (await createClient() as unknown as PlanRpc).rpc('zoe_v3_plan_state');
 if(error)throw Error('Published plan confirmation unavailable');
 if(data===null)return null;
 return planStateSchema.parse(data);
}
export async function readV3Plan(){
 if(!zoeAppV3Enabled())return null;
 const [care,state,ldl]=await Promise.all([getCareData(),readPlanState(),memberLdl()]);
 const details=planDetails(care,state,ldl??null);
 return details&&care.plan?{plan:care.plan,details}:null;
}

/** The V3 dose path never includes self-reported medicines or an unconfirmed publication. */
export async function readConfirmedPlanDoses(now=new Date()){
 if(!zoeAppV3Enabled())return [];
 const [care,state]=await Promise.all([getCareData(),readPlanState()]);
 return planRemindersAllowed(true,state,care.plan?.id??null)?dosesForDay(care,now):[];
}
