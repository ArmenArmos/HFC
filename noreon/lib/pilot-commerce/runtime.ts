import 'server-only';
import{adminCatalogSchema,adminPaymentsSchema,gmOverviewSchema,memberCatalogSchema,memberPaymentsSchema,pilotCommandSchema,pilotResultSchema,type PilotResult}from'./schema';
export type PilotRpc={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>};

async function read<T>(client:PilotRpc,name:string,schema:{safeParse(v:unknown):{success:true;data:T}|{success:false}},args?:Record<string,unknown>,label='This page'):Promise<T>{
 const response=await client.rpc(name,args);
 if(response.error)throw Object.assign(Error(`${label} is unavailable.`),{code:response.error.code});
 const parsed=schema.safeParse(response.data);if(!parsed.success)throw Error(`${label} is unavailable.`);
 return parsed.data;
}
/** Reads use the signed-in client only; the database decides scope. */
export const readAdminCatalog=(client:PilotRpc)=>read(client,'pilot_catalog_admin',adminCatalogSchema,undefined,'The test catalogue');
export const readMemberCatalog=(client:PilotRpc)=>read(client,'pilot_catalog_member',memberCatalogSchema,undefined,'Prices');
export const readAdminPayments=(client:PilotRpc)=>read(client,'pilot_admin_payments',adminPaymentsSchema,undefined,'Payments');
export const readMemberPayments=(client:PilotRpc)=>read(client,'pilot_member_payments',memberPaymentsSchema,undefined,'Payment status');
export const readGmOverview=(client:PilotRpc,from:string,to:string)=>read(client,'pilot_gm_overview',gmOverviewSchema,{p_from:from,p_to:to},'The cohort overview');

/** A resend of the same submission replays the stored result, so an unknown
 * outcome can be checked by sending the same command again. */
export async function sendPilotCommand(client:PilotRpc,raw:unknown):Promise<PilotResult>{
 const parsed=pilotCommandSchema.safeParse(raw);if(!parsed.success)return{status:'invalid'};
 try{
  const response=await client.rpc('pilot_command',{p_command:parsed.data});
  if(response.error)return{status:response.error.code==='55P03'?'unavailable':'outcome-unknown'};
  const result=pilotResultSchema.safeParse(response.data);
  return result.success?result.data:{status:'outcome-unknown'};
 }catch{return{status:'outcome-unknown'};}
}
