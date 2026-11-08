import 'server-only';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {openRunIo} from './seal';
import type {ZoeRunDetail} from "./contracts";

const detailSchema=z.union([z.object({ok:z.literal(false),code:z.string()}),z.object({ok:z.literal(true),run:z.object({id:z.uuid(),memberId:z.uuid(),outcome:z.string().nullable(),reason:z.string().nullable(),
 provider:z.string().nullable(),model:z.string().nullable(),tier:z.string().nullable().default(null),tierReason:z.string().nullable().default(null),fallbackUsed:z.boolean().default(false),configVersion:z.string().nullable(),costUsd:z.number().nullable(),inputTokens:z.number().nullable(),outputTokens:z.number().nullable(),latencyMs:z.number().nullable(),sealed:z.string().nullable()})})]);

/** One run's redacted AI input and output for an admin (zoe_run_detail journals the read). */
export async function zoeRunDetail(client:SupabaseClient<Database>,runId:string,memberId:string):Promise<ZoeRunDetail|null>{
 const {data,error}=await client.rpc('zoe_run_detail',{p_run:runId});
 if(error)throw Error('Zoe run unavailable');
 const r=detailSchema.parse(data);
 if(!r.ok||r.run.memberId!==memberId)return null;
 const {id,outcome,reason,provider,model,tier,tierReason,fallbackUsed,configVersion,costUsd,inputTokens,outputTokens,latencyMs,sealed}=r.run;
 return {id,outcome,reason,provider,model,tier,tierReason,fallbackUsed,configVersion,costUsd,inputTokens,outputTokens,latencyMs,io:openRunIo(sealed)};
}
