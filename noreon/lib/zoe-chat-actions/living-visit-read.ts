import 'server-only';
import {z} from 'zod';
import {cardSchema,type ZoeCard} from './registry';
import type {Rpc} from './server';

/** The database reads the facts and commits the snapshot and one transition together. */
export async function syncLivingVisit(rpc:Rpc|null,memberId:string,onDisabled?:()=>void):Promise<ZoeCard|null>{
 if(!rpc)throw Object.assign(Error('Visit status unavailable'),{code:'rpc'});
 let raw:unknown;
 try{raw=await rpc('zoe_living_visit_sync',{p_member:memberId});}
 catch{throw Object.assign(Error('Visit status unavailable'),{code:'rpc'});}
 // Disabled eligibility and a successful empty read both mean no living card.
 if(z.strictObject({ok:z.literal(false),code:z.literal('disabled')}).safeParse(raw).success){onDisabled?.();return null;}
 if(raw&&typeof raw==='object'&&'ok' in raw&&raw.ok===false){
  // Only a bounded token may leave the RPC as a diagnostic code, never its payload.
  const code='code' in raw&&typeof raw.code==='string'&&raw.code.match(/^[a-z_]{1,24}$/)?.[0]===raw.code?'rpc_'+raw.code:'not_ok';
  throw Object.assign(Error('Visit status unavailable'),{code});
 }
 const parsed=z.strictObject({ok:z.literal(true),card:cardSchema.nullable()}).safeParse(raw);
 if(!parsed.success||parsed.data.card&&(!parsed.data.card.valid||parsed.data.card.kind!=='visit'||!parsed.data.card.snapshot.living)){
  // A fixed code only (never the payload), so a failing sync can be told apart in the logs.
  const code=!parsed.success?'shape':'card';
  throw Object.assign(Error('Visit status unavailable'),{code});
 }
 return parsed.data.card;
}
