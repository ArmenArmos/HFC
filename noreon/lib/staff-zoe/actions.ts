'use server';
import {notFound} from 'next/navigation';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {candidatesSchema,type Candidate} from './contracts';

export type FindResult={status:'ok';rows:Candidate[];hasMore:boolean}|{status:'off'|'invalid'|'unavailable'};
const STOP=/^(?:find|show|open|member|patient|please|the|for|about|summarise|summarize|mrs?|ms|ani|գտիր|ցույց|տուր|անդամ|найди|покажи|участник|пациент|пациентка)$/iu;

/** Whole text first, then each word of it: "find Mariam Hakobyan" and "Mariam" both reach the search. Scope stays in the database. */
function queries(raw:string){
 const text=raw.trim();const words=text.split(/\s+/u).filter(w=>[...w].length>=2&&!STOP.test(w));
 return [...new Set([text,...words])].filter(q=>[...q].length>=2&&q.length<=100).slice(0,4);
}

export const findStaffZoeMembers=loggedAction('findStaffZoeMembers',async function findStaffZoeMembers(raw:unknown):Promise<FindResult>{
 const parsed=z.string().max(100).safeParse(raw);
 if(!parsed.success||/[\u0000-\u001f\u007f]/.test(parsed.data))return {status:'invalid'};
 const {client,identity}=await requireRealStaff();
 if(identity.role==='admin')notFound();
 const merged=new Map<string,Candidate>();let hasMore=false;
 for(const q of queries(parsed.data)){
  const r=await client.rpc('staff_zoe_candidates' as never,{p_query:q} as never) as {data:unknown;error:{code?:string}|null};
  if(r.error)return {status:'unavailable'};
  const p=candidatesSchema.safeParse(r.data);
  if(!p.success)return {status:'unavailable'};
  if(!p.data.enabled)return {status:'off'};
  for(const row of p.data.rows)merged.set(row.id,row);
  hasMore||=p.data.hasMore;
  // The whole text matched: its words would only widen the list.
  if(merged.size)break;
 }
 return {status:'ok',rows:[...merged.values()].slice(0,5),hasMore:hasMore||merged.size>5};
});

export type OpenResult={ok:true;conversationId:string}|{ok:false};
/** The explicit selection. Only this binds a member to a conversation. */
export const openStaffZoe=loggedAction('openStaffZoe',async function openStaffZoe(raw:unknown):Promise<OpenResult>{
 const id=z.uuid().safeParse(raw);if(!id.success)return {ok:false};
 const {client,identity}=await requireRealStaff();
 if(identity.role==='admin')notFound();
 const r=await client.rpc('staff_zoe_open' as never,{p_member:id.data} as never) as {data:unknown;error:{code?:string}|null};
 if(r.error)return {ok:false};
 const p=z.object({ok:z.literal(true),conversationId:z.uuid()}).safeParse(r.data);
 return p.success?p.data:{ok:false};
});
