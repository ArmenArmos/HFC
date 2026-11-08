/** Local browser verification only. Creates labeled synthetic identities; never sends messages.
 * Supply NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 * through the process environment. The private output file contains test credentials.
 * Run: node scripts/create-real-review-local-fixtures.mjs /absolute/private/output.json
 * These fixtures do not complete an assessment, enroll a case, assign a doctor or publish care.
 */
import {createClient} from '@supabase/supabase-js';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const target=process.argv[2];
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(!target||!path.isAbsolute(target))throw Error('An absolute private output path is required');
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Fixture setup only supports a local Supabase URL');
if(!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw Error('Local Supabase keys are required in the environment');
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const run=randomUUID().slice(0,8),created=[];
async function add(kind,phone){
 const password=randomBytes(24).toString('base64url');
 const email=phone?undefined:`review-${kind}-${run}@example.test`;
 const result=await admin.auth.admin.createUser({...(phone?{phone,phone_confirm:true}:{email,email_confirm:true}),password});
 if(result.error||!result.data.user)throw Error(`Local ${kind} identity setup failed`);
 created.push(result.data.user.id);return {id:result.data.user.id,email,phone,password};
}
try{
 const tail=String(parseInt(run,16)%1000000).padStart(6,'0');
 const member=await add('member',`+37499${tail}`);
 const otherMember=await add('other-member',`+37498${tail}`);
 const operator=await add('admin');const doctor=await add('doctor');
 const clinic=await admin.from('workspace_clinics').insert({name:`Local review verification ${run}`,address:'Synthetic local fixture',active:true}).select('id').single();
 if(clinic.error)throw Error('Local clinic setup failed');
 const staff=await admin.from('workspace_staff').insert([{user_id:operator.id,role:'admin',display_name:`Local review admin ${run}`,active:true},{user_id:doctor.id,role:'doctor',display_name:`Local review doctor ${run}`,clinic_id:clinic.data.id,active:true}]);
 if(staff.error)throw Error('Local staff membership setup failed');
 await writeFile(target,JSON.stringify({scope:'Local synthetic browser verification; OTP transport is not tested',url,anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,run,clinicId:clinic.data.id,member,otherMember,operator,doctor},null,2),{mode:0o600,flag:'wx'});
 console.log(`Local synthetic identities created. Private credentials saved to ${target}`);
}catch(error){
 for(const id of created)await admin.auth.admin.deleteUser(id);
 throw error;
}
