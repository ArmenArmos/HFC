import 'server-only';
import {memberSearchInputSchema,memberSearchPageSchema,type MemberSearchInput,type MemberSearchResult} from './member-search-schema';

/** The exported server action must authenticate before this bounded IO seam. */
export async function runMemberSearch(raw:unknown,read:(input:MemberSearchInput)=>Promise<{data:unknown;error:unknown}>):Promise<MemberSearchResult>{
 const input=memberSearchInputSchema.safeParse(raw);
 if(!input.success)return {ok:false,reason:'invalid'};
 try{
  const response=await read(input.data);
  if(response.error)return {ok:false,reason:typeof response.error==='object'&&'code' in response.error&&response.error.code==='22023'?'invalid':'unavailable'};
  const page=memberSearchPageSchema.safeParse(response.data);
  return page.success?{ok:true,page:page.data}:{ok:false,reason:'unavailable'};
 }catch{return {ok:false,reason:'unavailable'};}
}

/** The identity response is validated by the same bounded search contract.
 * Keep the new RPC typing at this IO boundary until local types can be regenerated. */
export async function runMemberIdentitySearch(raw:unknown,client:{rpc:unknown}):Promise<MemberSearchResult>{
 const rpc=client as {rpc(name:'patient_clinical_case_search_identity',args:{p_query:string;p_after_created_at?:string;p_after_user_id?:string}):PromiseLike<{data:unknown;error:unknown}>};
 return runMemberSearch(raw,async input=>await rpc.rpc('patient_clinical_case_search_identity',{
  p_query:input.query,...(input.cursor?{p_after_created_at:input.cursor.createdAt,p_after_user_id:input.cursor.id}:{}),
 }));
}
