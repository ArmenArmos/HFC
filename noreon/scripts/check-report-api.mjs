// Local integration only. No production accounts or real phone numbers.
import fs from 'node:fs';import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';import {createServerClient} from '@supabase/ssr';
const env=JSON.parse(fs.readFileSync('.superpowers/local-db.json','utf8'));
if(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.API_URL))throw new Error('Local only');
const base='http://localhost:4175',admin=createClient(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false}}),users=[],headers=[];let originalPath;
try{
 for(let i=0;i<2;i++){
  const u=await admin.auth.admin.createUser({email:`report-api-${Date.now()}-${i}@example.invalid`,email_confirm:true,phone:`1202555019${i}`,phone_confirm:true});assert.ifError(u.error);users.push(u.data.user);
  const link=await admin.auth.admin.generateLink({type:'magiclink',email:u.data.user.email});assert.ifError(link.error);
  let jar=[];const auth=createServerClient(env.API_URL,env.ANON_KEY,{cookies:{getAll:()=>jar,setAll:values=>{jar=values;}}});
  assert.ifError((await auth.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'magiclink'})).error);
  headers.push({Cookie:jar.map(x=>`${x.name}=${x.value}`).join('; '),Origin:base,'Content-Type':'application/json'});
 }
 const post=async (body,who=0)=>{const response=await fetch(`${base}/api/patient/reports`,{method:'POST',headers:headers[who],body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 assert.equal((await fetch(`${base}/api/patient/reports`)).status,401);
 const file=fs.readFileSync('scripts/fixtures/reports/fictional-en.pdf');
 const upload=await post({op:'upload',name:'Fictional local test.pdf',mime:'application/pdf',size:file.length,consent:'report-import-openai-v1'});assert.equal(upload.status,200,JSON.stringify(upload.data));originalPath=upload.data.path;
 const storage=createClient(env.API_URL,env.ANON_KEY);assert.ifError((await storage.storage.from('patient-reports').uploadToSignedUrl(upload.data.path,upload.data.token,file,{contentType:'application/pdf'})).error);
 const id=upload.data.id;
 assert.equal((await post({op:'extract',id,revision:0},1)).data.error,'not_found');
 const cross=await fetch(`${base}/api/patient/reports/${id}/original`,{headers:headers[1]});assert.equal(cross.status,404);
 const original=await fetch(`${base}/api/patient/reports/${id}/original?preview=1`,{headers:headers[0]});assert.equal(original.status,200);assert.equal(Buffer.from(await original.arrayBuffer()).equals(file),true);
 const extraction={reportDate:'2025-09-12',personName:'Fictional Example',laboratory:'Test',summary:'',warnings:[],rows:[{name:'LDL cholesterol',literal:'3.2',unit:'mmol/L',reference:'<3',page:1,snippet:'LDL 3.2 mmol/L',uncertain:false}]};
 assert.ifError((await admin.from('patient_reports').update({extraction,state:'needs_review',revision:1}).eq('id',id)).error);
 assert.equal((await post({op:'confirm',id,revision:1,review:extraction,mine:true},1)).data.error,'not_found');
 const corrected={...extraction,rows:[{...extraction.rows[0],literal:'3.1'}]};
 assert.equal((await post({op:'confirm',id,revision:1,review:corrected,mine:true})).status,200);
 assert.equal((await post({op:'confirm',id,revision:1,review:extraction,mine:true})).data.error,'conflict');
 const listing=await fetch(`${base}/api/patient/reports`,{headers:headers[0]});const saved=(await listing.json()).reports.find(r=>r.id===id);assert.equal(saved.reviewed.rows[0].literal,'3.1');assert.equal(saved.extraction.rows[0].literal,'3.2');
 assert.equal((await post({op:'delete',id})).status,200);
 assert.equal((await fetch(`${base}/api/patient/reports/${id}/original`,{headers:headers[0]})).status,404);
 console.log('Report HTTP integration passed: signed upload, source download, ownership, correction persistence, stale confirmation and deletion.');
}finally{if(originalPath)await admin.storage.from('patient-reports').remove([originalPath]);for(const u of users)await admin.auth.admin.deleteUser(u.id);}
