import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {validatePracticeState,type PracticeState} from './engine';
export type PracticeSession={id:string;version:number;state:PracticeState};
export type PracticeFailure={ok:false;code:string;session?:PracticeSession};
export type PracticeResult={ok:true;session:PracticeSession;token?:string|null}|PracticeFailure;
export type PracticeRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
/** Service role only for the one server function; every result is validated at this boundary. */
export function practiceServiceRpc(env:Record<string,string|undefined>=process.env):PracticeRpc|null{
 if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
 const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 return async(name,args)=>{const r=await client.rpc(name,args);if(r.error)throw Error('Practice storage unavailable');return r.data;};
}
export async function mutatePractice(rpc:PracticeRpc,author:string,operation:string,input:Record<string,unknown>):Promise<PracticeResult>{
 const raw=await rpc('zoe_practice_mutate',{p_author:author,p_operation:operation,p_input:input});
 const failure=z.object({ok:z.literal(false),code:z.string(),session:z.object({id:z.uuid(),version:z.number().int().nonnegative(),state:z.unknown()}).optional()}).safeParse(raw);
 if(failure.success)return {ok:false,code:failure.data.code,...(failure.data.session?{session:{...failure.data.session,state:validatePracticeState(failure.data.session.state)}}:{})};
 const r=z.object({ok:z.literal(true),token:z.uuid().nullable().optional(),session:z.object({id:z.uuid(),version:z.number().int().nonnegative(),state:z.unknown()})}).parse(raw);
 return {...r,session:{...r.session,state:validatePracticeState(r.session.state)}};
}
export function practiceDailyLimits(env:Record<string,string|undefined>=process.env){
 const defaults={doctor:60,global:300};if(env.NOREON_ZOE_PRACTICE_DAILY_TURNS===undefined)return defaults;
 try{return z.strictObject({doctor:z.number().int().min(0).max(60),global:z.number().int().min(0).max(300)}).parse(JSON.parse(env.NOREON_ZOE_PRACTICE_DAILY_TURNS));}catch{return {doctor:0,global:0};}
}
