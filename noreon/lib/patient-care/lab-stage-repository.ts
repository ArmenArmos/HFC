import 'server-only';
import{createClient}from'@/lib/supabase/server';
import{memberLabReadSchema,type MemberLabSample}from'@/lib/staff/lab-stage-schema';

/** The member's own sample stages. Null means unreadable, never "no samples". */
export async function getMemberLabStages():Promise<MemberLabSample[]|null>{
 try{
  const client=await createClient();
  const response=await client.rpc('patient_member_lab_stages');
  if(response.error)return null;
  const parsed=memberLabReadSchema.safeParse(response.data);
  return parsed.success?parsed.data.samples:null;
 }catch{return null;}
}
