import 'server-only';
import type {ZoeDecision} from './policy';

/** The one RPC the Zoe path journals through (service role; zoe.* names only). Injected so checks need no database. */
export type ZoeTracePort=(args:{p_member:string|null;p_name:string;p_outcome:string;p_reason:string;p_rule:string;p_rule_version:string;p_attributes:Record<string,string|number|boolean>})=>Promise<{data:unknown;error:unknown}>;

/**
 * Journals one Zoe decision. A decision that could not be journaled is treated as not made:
 * callers must not act on an "allow" when this returns false.
 */
export async function recordZoeDecision(port:ZoeTracePort,memberId:string|null,d:ZoeDecision){
 try{
  const {data,error}=await port({p_member:memberId,p_name:d.name,p_outcome:d.outcome,p_reason:d.reason,p_rule:d.rule,p_rule_version:d.ruleVersion,p_attributes:d.attributes});
  return !error&&typeof data==='object'&&data!==null&&(data as {ok?:unknown}).ok===true;
 }catch{return false;}
}
