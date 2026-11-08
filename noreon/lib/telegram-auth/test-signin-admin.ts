import 'server-only';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
export const testSigninListSchema=z.object({enabled:z.boolean(),numbers:z.array(z.object({
 id:z.uuid(),label:z.string(),last4:z.string(),expiresAt:z.string(),active:z.boolean(),
}))});
export type TestSigninList=z.infer<typeof testSigninListSchema>;
// Keep the new RPC boundary explicit until types can be regenerated from an isolated DB.
// lib/db/types.ts remains generated output and is intentionally not hand-edited.
type AdminRpc='test_signin_admin_list'|'test_signin_admin_add'|'test_signin_admin_remove'|'test_signin_admin_switch'|'test_signin_admin_set_code';
export async function testSigninAdminRpc(client:SupabaseClient<Database>,name:AdminRpc,args?:Record<string,unknown>):Promise<unknown>{
 const result=await client.rpc(name as never,args as never);
 if(result.error)throw Error('Test sign-in settings are unavailable. Try again.');
 return result.data;
}
