import 'server-only';
import {randomUUID} from 'node:crypto';
import type {Proposal} from './contracts';
import {engineContextFrom,staffWorkspaceSchema,type EngineContext} from './contracts';
import type {ConversationRepository} from './repository';
/** Providers/clinical rules are injected by trusted server composition, never a browser payload. */
export type ConversationDraftEngine={propose(context:EngineContext):Promise<Pick<Proposal,'body'|'summary'|'provenance'>>};
export async function prepareConversationDraft(repo:ConversationRepository,memberId:string,engine?:ConversationDraftEngine){
 if(!engine)return {ok:false as const,code:'clinical_engine_unavailable'};
 const context=staffWorkspaceSchema.parse(await repo.workspace(memberId));
 if('conversation'in context)return {ok:false as const,code:'conversation_unknown'};
 const captured={memberId,requestId:randomUUID(),expectedVersion:context.version,expectedClinicalRevision:context.clinicalRevision,expectedDraftEpoch:context.draftEpoch,expectedSource:context.sourceToken};
 // CR6: the engine reads only message facts, never IDs, grants, intents or source tokens.
 const output=await engine.propose(engineContextFrom(context));
 // Engine output is data, even when the provider is wired by trusted server code.
 // Select only content fields; never spread runtime output over captured authority.
 // The transaction compares the original source/version after this slow call.
 return repo.propose({...captured,body:output.body,summary:output.summary,provenance:output.provenance});
}
/** Explicit local fixture composition, never a clinical/provider substitute. */
export function configuredConversationEngine(env:Record<string,string|undefined>):ConversationDraftEngine|undefined{
 if(env.NODE_ENV==='production'||env.NOREON_CONVERSATION_SYNTHETIC_ENGINE!=='true'||env.NOREON_CONVERSATION_HARNESS_ENABLED!=='true')return undefined;
 return {propose:async()=>({summary:'Synthetic factual intake summary fixture; not clinical interpretation.',body:'Synthetic fixture draft only. This is not clinical guidance.',provenance:{kind:'synthetic',engine:'deterministic-fixture',version:'1',protocolVersion:'not-clinical'}})};
}
