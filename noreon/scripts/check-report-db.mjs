import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
const env=JSON.parse(fs.readFileSync('.superpowers/local-db.json','utf8'));
const admin=createClient(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const users=[],clients=[];
try{
 for(let i=0;i<2;i++){
  const u=await admin.auth.admin.createUser({email:`reports-${Date.now()}-${i}@example.invalid`,email_confirm:true});assert.ifError(u.error); users.push(u.data.user);
  const link=await admin.auth.admin.generateLink({type:'magiclink',email:u.data.user.email});assert.ifError(link.error);
  const c=createClient(env.API_URL,env.ANON_KEY,{auth:{persistSession:false}});assert.ifError((await c.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token})).error);clients.push(c);
 }
 const inserted=await admin.from('patient_reports').insert({user_id:users[0].id,object_path:`${users[0].id}/test/original`,file_name:'fictional.pdf',mime:'application/pdf',size_bytes:1,consent_version:'test'}).select().single();assert.ifError(inserted.error);const r=inserted.data;
 assert.equal((await clients[0].from('patient_reports').select('*')).data.length,1);
 assert.equal((await clients[1].from('patient_reports').select('*')).data.length,0);
 assert.ok((await clients[0].from('patient_reports').update({state:'confirmed'}).eq('id',r.id)).error);
 assert.ok((await clients[1].rpc('claim_report_job',{p_id:r.id,p_owner:users[0].id,p_operation:'extract',p_revision:0})).error);
 assert.ok((await admin.rpc('claim_report_job',{p_id:r.id,p_owner:users[1].id,p_operation:'extract',p_revision:0})).error);
 const claims=await Promise.all([0,1].map(()=>admin.rpc('claim_report_job',{p_id:r.id,p_owner:users[0].id,p_operation:'extract',p_revision:0})));
 assert.equal(claims.filter(c=>!c.error).length,1,'one lease only');
 for(let n=1;n<5;n++){
  assert.ifError((await admin.from('patient_reports').update({state:'failed',lease_until:null}).eq('id',r.id)).error);
  assert.ifError((await admin.rpc('claim_report_job',{p_id:r.id,p_owner:users[0].id,p_operation:'extract',p_revision:n})).error);
 }
 await admin.from('patient_reports').update({state:'failed',lease_until:null}).eq('id',r.id);
 assert.equal((await admin.rpc('claim_report_job',{p_id:r.id,p_owner:users[0].id,p_operation:'extract',p_revision:5})).error.message,'daily_limit');
 const stale=await admin.from('patient_reports').update({state:'needs_review'}).eq('id',r.id).eq('revision',0).select();assert.equal(stale.data.length,0);
 assert.ifError((await admin.storage.from('patient-reports').upload(r.object_path,Buffer.from('x'),{contentType:'application/pdf'})).error);
 assert.ifError((await clients[0].storage.from('patient-reports').download(r.object_path)).error);
 assert.ok((await clients[1].storage.from('patient-reports').download(r.object_path)).error);
 assert.ok((await clients[0].storage.from('patient-reports').upload(`${users[0].id}/unowned`,Buffer.from('x'),{contentType:'application/pdf'})).error);
 await admin.from('patient_reports').update({state:'deleted',deleted_at:new Date().toISOString()}).eq('id',r.id);
 assert.equal((await clients[0].from('patient_reports').select('*')).data.length,0);
 assert.ok((await clients[0].storage.from('patient-reports').download(r.object_path)).error);
 await admin.storage.from('patient-reports').remove([r.object_path]);
 const reservations=await Promise.all(Array.from({length:15},()=>admin.rpc('reserve_report_upload',{p_owner:users[1].id,p_name:'test.pdf',p_mime:'application/pdf',p_size:1,p_consent:'test'})));
 assert.equal(reservations.filter(r=>!r.error).length,10,'concurrent uploads must respect the limit');
 console.log('report database isolation, leases and quota checks passed');
}finally{for(const u of users)await admin.auth.admin.deleteUser(u.id);}
