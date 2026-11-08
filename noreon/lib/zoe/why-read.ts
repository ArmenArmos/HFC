import 'server-only';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {zoeWhySchema,type ZoeWhy} from './why';

const whyReadSchema=z.object({ok:z.literal(true),label:z.string(),run:z.object({id:z.uuid(),memberId:z.uuid(),messageSeq:z.number().int().nullable(),kind:z.string(),outcome:z.string().nullable(),reason:z.string().nullable(),finishedAt:z.string().nullable()}),why:z.unknown().nullable()});
export type ZoeWhyView={label:string;run:z.infer<typeof whyReadSchema>['run'];why:ZoeWhy|null;
 /** missing: the run has no record (older than this feature, or the save failed). unreadable: it has one this build cannot read. */status:'recorded'|'missing'|'unreadable'};

/**
 * One run's saved why, for the signed-in staff member on `client` (zoe_run_why allows the assigned doctor and an admin, and records
 * the read). The stable read for the next step: staff Zoe's "why did you say this?" tool calls this with the staff JWT, answers from
 * `why` and says so when it is missing. Null when the caller may not read it.
 */
export async function readZoeWhy(client:SupabaseClient<Database>,runId:string):Promise<ZoeWhyView|null>{
 const {data,error}=await client.rpc('zoe_run_why',{p_run:runId});
 if(error){if(error.code==='42501')return null;throw Error('Zoe why unavailable');}
 const r=whyReadSchema.parse(data);
 if(r.why===null)return {label:r.label,run:r.run,why:null,status:'missing'};
 const why=zoeWhySchema.safeParse(r.why);
 return {label:r.label,run:r.run,why:why.success?why.data:null,status:why.success?'recorded':'unreadable'};
}
