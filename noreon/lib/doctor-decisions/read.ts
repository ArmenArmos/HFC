import 'server-only';
import {readItemCards,type DecisionRpc} from './items';
import {readReplyCard} from './replies';
import {careAlertsEnabled} from '@/lib/care-alerts/contracts';
import {readApprovalCards} from './approval-read';

/** Authorizing a conversation read locks the case row with NOWAIT, the same lock its writes use. Other tabs and
 * requests can hold it for a moment, so a read tries once more. */
export const retryOnLock=(client:DecisionRpc):DecisionRpc=>({async rpc(name,args){
 const result=await client.rpc(name,args);
 if(result.error?.code!=='55P03')return result;
 await new Promise(resolve=>setTimeout(resolve,50));
 return client.rpc(name,args);
}});

export async function readWorkspaceDecisions(client:DecisionRpc,memberId:string){
 // Reply and approval reads share the case-row NOWAIT lock. Keep reads sequential.
 const reads=retryOnLock(client);
 const items=await readItemCards(reads,memberId);
 const reply=await readReplyCard(reads,memberId).catch(()=>null);
 const approvals=await readApprovalCards(reads,memberId);
 return {items:items?.filter(i=>i.kind!=='alert'||careAlertsEnabled())??null,reply,approvals};
}
export type WorkspaceDecisions=Awaited<ReturnType<typeof readWorkspaceDecisions>>;
