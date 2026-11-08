import 'server-only';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';

const zoeSchema=z.object({alerted:z.boolean(),pending:z.boolean()});
export type CareAlertZoeStatus=z.infer<typeof zoeSchema>;
// zoe is absent on a database not yet migrated, which must not cost the questionnaire screen its status.
const statusSchema=z.object({ok:z.literal(true),alertsEnabled:z.boolean(),alerted:z.boolean(),alertedAt:z.string().nullable(),zoe:zoeSchema.nullish()});
export type CareAlertMemberStatus=z.infer<typeof statusSchema>;

/**
 * The signed-in member's own care-alert status for the urgent screens. Null when signed out or when
 * it cannot be read: the screens then make no claim either way. zoe is about the one message
 * zoeRequest names, for the Zoe 103 screen; the rest is about the current questionnaire red flag.
 */
export async function careAlertMemberStatus(zoeRequest?:string):Promise<CareAlertMemberStatus|null>{
 try{
  const {data,error}=await (await createClient()).rpc('care_alert_member_status',zoeRequest?{p_zoe_request:zoeRequest}:{});
  if(error)return null;
  const parsed=statusSchema.safeParse(data);
  return parsed.success?parsed.data:null;
 }catch{return null;}
}
