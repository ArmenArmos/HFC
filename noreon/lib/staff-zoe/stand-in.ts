import {approxTokens,type ProviderRequest,type ProviderResult,type ZoeProvider} from '@/lib/zoe/provider';

/**
 * The local stand-in for the model: reads the fact ids out of the data block and chooses the first of each tool. Nothing leaves
 * the server. Used where NOREON_ZOE_PROVIDER is "fake" (local stacks, CI, the Playwright journey); the pane says so.
 */
const ADVICE_ASKED=/(?<![\p{L}])(?:should i|what should|prescribe|increase|which medicine|what dose|diagnos\p{L}*)(?![\p{L}])/iu;
export function createStandInProvider():ZoeProvider{
 return Object.freeze({providerName:'noreon.stand_in',requestModel:'stand-in',region:'local',local:true,pricing:{inputUsdPerMTok:0,outputUsdPerMTok:0,label:'stand-in'},
  async complete(req:ProviderRequest):Promise<ProviderResult>{
   const q=/<question>([\s\S]*?)<\/question>/u.exec(req.memberBlock)?.[1]??'';
   const facts=[...req.memberBlock.matchAll(/<tool name="([a-z_]+)" state="ok">([\s\S]*?)<\/tool>/gu)].flatMap(m=>[...m[2]!.matchAll(/<fact id="([^"]+)"/gu)].slice(0,3).map(f=>f[1]!));
   const quotes=[...req.memberBlock.matchAll(/<(?:member_text|nurse_text) id="([^"]+)"/gu)].slice(-2).map(m=>m[1]!);
   const raw=JSON.stringify({need:[],facts:facts.slice(0,10),quotes,not_known:/<tool name="[a-z_]+" state="(?!ok)/u.test(req.memberBlock),declined:ADVICE_ASKED.test(q)});
   return {kind:'ok',raw,finishReason:'stop',usage:{inputTokens:approxTokens(req.memberBlock),outputTokens:approxTokens(raw)},responseModel:'stand-in',responseId:'stand-in'};
  },
 });
}
