import 'server-only';
import {z} from 'zod';
import type {ClinicRpc} from './runtime';
import {clinicAdminCommandSchema} from './admin-schema';
import {readClinicAdminPage,lookupClinicAccount,runClinicAdminCommand,refreshClinicAdminCommand} from './admin-runtime';

/** The opaque scope is a stale-page fence. The fresh guard and SQL are authority. */
export function createClinicAdminGateway(guard:()=>Promise<{actorScope:string;rpc:ClinicRpc}>){
 async function context(clinicId:string,expectedScope:string){
  const current=await guard();
  return z.uuid().safeParse(clinicId).success&&typeof expectedScope==='string'&&expectedScope===current.actorScope?current:null;
 }
 return {
  async read(clinicId:string,cursor:string|null,expectedScope:string){const c=await context(clinicId,expectedScope);return c?readClinicAdminPage(c.rpc,clinicId,cursor):{status:'unavailable' as const};},
  async lookup(clinicId:string,email:string,expectedScope:string){const c=await context(clinicId,expectedScope);return c&&typeof email==='string'?lookupClinicAccount(c.rpc,email):{status:'unavailable' as const};},
  async command(clinicId:string,input:unknown,expectedScope:string){
   const c=await context(clinicId,expectedScope);if(!c)return{status:'access' as const};
   const p=clinicAdminCommandSchema.safeParse(input);if(!p.success||p.data.clinicId!==clinicId)return{status:'access' as const};
   return runClinicAdminCommand(c.rpc,p.data);
  },
  async recover(clinicId:string,input:unknown,expectedScope:string){
   const c=await context(clinicId,expectedScope);if(!c)return{status:'unavailable' as const};
   const p=clinicAdminCommandSchema.safeParse(input);if(!p.success||p.data.clinicId!==clinicId)return{status:'unavailable' as const};
   return refreshClinicAdminCommand(c.rpc,p.data);
  }
 };
}
