import 'server-only';
import {staffMemberIdentityIdsSchema,staffMemberIdentitiesSchema,type StaffMemberIdentity} from './member-search-schema';

/** Keep the new RPC type at this boundary until database types are regenerated. */
export async function runStaffMemberIdentities(raw:unknown,client:{rpc:unknown}):Promise<StaffMemberIdentity[]|null>{
 const input=staffMemberIdentityIdsSchema.safeParse(raw);
 if(!input.success)return null;
 const ids=[...new Set(input.data)];
 if(!ids.length)return [];
 try{
  const rpc=client as {rpc(name:'staff_member_identities',args:{p_members:string[]}):PromiseLike<{data:unknown;error:unknown}>};
  const response=await rpc.rpc('staff_member_identities',{p_members:ids});
  if(response.error)return null;
  const rows=staffMemberIdentitiesSchema.safeParse(response.data);
  if(!rows.success||new Set(rows.data.map(row=>row.id)).size!==rows.data.length||rows.data.some(row=>!ids.includes(row.id)))return null;
  return rows.data;
 }catch{return null;}
}
