import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {existsSync} from 'node:fs';
assert.ok(existsSync('lib/messaging/meta.ts'),'Meta transport must exist');
const {parseMetaConfig,buildMetaOtpMessage,buildMetaPlanMessage,submitMetaOtpMessage,submitMetaPlanMessage,verifyMetaWebhook,verifyMetaChallenge}=await import('@/lib/messaging/meta');
const raw={accessToken:'fictional-access-token',appSecret:'fictional-app-secret',verifyToken:'fictional-verify-token',wabaId:'123456789',phoneNumberId:'987654321',graphVersion:'v23.0',otpEn:{name:'noreon_login',language:'en_US'},planEn:{name:'noreon_plan_available',language:'en_US'}};
const config=parseMetaConfig(raw),input={destination:'+37499000777',locale:'en' as const};
for(const patch of [{graphVersion:undefined},{graphVersion:'https://evil.test'},{phoneNumberId:'1/../2'},{otpEn:{name:'anything',language:'hy'}},{planEn:undefined},{accessToken:''},{appSecret:''},{verifyToken:''},{url:'https://evil.test'}])assert.throws(()=>parseMetaConfig({...raw,...patch}));
const otp=buildMetaOtpMessage(config,{...input,code:'012345'});
assert.deepEqual(otp,{messaging_product:'whatsapp',recipient_type:'individual',to:'37499000777',type:'template',template:{name:'noreon_login',language:{code:'en_US'},components:[{type:'body',parameters:[{type:'text',text:'012345'}]},{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:'012345'}]}]}});
for(const patch of [{code:'12345'},{code:'1234567'},{code:'abcdef'},{destination:'+15555555555'},{destination:'+374123'},{channel:'sms'},{body:'diagnosis'},{url:'https://evil.test'},{locale:'hy'}])assert.throws(()=>buildMetaOtpMessage(config,{...input,code:'012345',...patch}));
const plan=buildMetaPlanMessage(config,input);
assert.deepEqual(plan.template,{name:'noreon_plan_available',language:{code:'en_US'}});
assert.ok(!JSON.stringify(plan).includes('clinical'));
assert.throws(()=>buildMetaPlanMessage(config,{...input,body:'Clinical data'}));
const hy=parseMetaConfig({...raw,otpHy:{name:'noreon_login_hy',language:'hy'},planHy:{name:'noreon_plan_hy',language:'hy'}});
assert.equal(buildMetaPlanMessage(hy,{...input,locale:'hy'}).template.name,'noreon_plan_hy');
let calls=0;const reference='wamid.HBgLMzc0OTkwMDA3NzcVAgASGBQxMjM=';
const transport:typeof fetch=async(url,init)=>{calls++;assert.equal(url,'https://graph.facebook.com/v23.0/987654321/messages');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+raw.accessToken);assert.deepEqual(JSON.parse(init?.body as string),otp);return new Response(JSON.stringify({messages:[{id:reference}]}),{status:200});};
assert.deepEqual(await submitMetaOtpMessage(config,{...input,code:'012345'},transport),{status:'accepted',reference});assert.equal(calls,1);
for(const [status,expected] of [[400,'failed'],[401,'failed'],[403,'failed'],[404,'failed'],[405,'failed'],[422,'failed'],[429,'failed'],[408,'unknown'],[409,'unknown'],[499,'unknown'],[500,'unknown']] as const){assert.deepEqual(await submitMetaPlanMessage(config,input,async()=>new Response('SECRET raw error',{status})),{status:expected});}
for(const body of ['not json',JSON.stringify({messages:[{id:'bad'}]}),JSON.stringify({messages:[{id:reference},{id:reference}]}),JSON.stringify({messages:[{id:'wamid.'+'x'.repeat(1025)}]})])assert.deepEqual(await submitMetaPlanMessage(config,input,async()=>new Response(body)),{status:'unknown'});
assert.deepEqual(await submitMetaPlanMessage(config,input,async()=>{throw Error('SECRET '+input.destination);}),{status:'unknown'});
assert.deepEqual(await submitMetaPlanMessage(config,input,async()=>new Response('x'.repeat(16_385))),{status:'unknown'});
await assert.rejects(()=>submitMetaPlanMessage(config,input,async()=>new Response('{}'),10_001),/Invalid Meta transport timeout/);
const started=Date.now();assert.deepEqual(await submitMetaPlanMessage(config,input,async()=>new Promise(()=>{}),20),{status:'unknown'});assert.ok(Date.now()-started<1000);
assert.equal(verifyMetaChallenge(config,new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':raw.verifyToken,'hub.challenge':'123456'})),'123456');
for(const params of [{'hub.mode':'other','hub.verify_token':raw.verifyToken,'hub.challenge':'123456'},{'hub.mode':'subscribe','hub.verify_token':'wrong','hub.challenge':'123456'},{'hub.mode':'subscribe','hub.verify_token':raw.verifyToken,'hub.challenge':'bad\nchallenge'}])assert.equal(verifyMetaChallenge(config,new URLSearchParams(params)),null);
assert.equal(verifyMetaChallenge(config,new URLSearchParams('hub.mode=subscribe&hub.verify_token='+raw.verifyToken+'&hub.challenge=1&hub.challenge=2')),null);
const payload={object:'whatsapp_business_account',entry:[{id:raw.wabaId,changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:raw.phoneNumberId,display_phone_number:'ignored'},statuses:[{id:reference,status:'sent',timestamp:'1791800000',recipient_id:'37499000777'},{id:reference,status:'delivered',timestamp:'1791800010',conversation:{id:'private'}}]}}]}]};
function signed(value:unknown){const body=JSON.stringify(value);return {body,signature:'sha256='+createHmac('sha256',raw.appSecret).update(body).digest('hex')};}
const valid=signed(payload);assert.deepEqual(verifyMetaWebhook(config,valid.signature,valid.body),[{reference,status:'sent',timestamp:1791800000},{reference,status:'delivered',timestamp:1791800010}]);
assert.equal(verifyMetaWebhook(config,'sha256='+'0'.repeat(64),valid.body),null);
assert.equal(verifyMetaWebhook(config,valid.signature,valid.body+' '),null);
assert.equal(verifyMetaWebhook(config,valid.signature,'x'.repeat(65537)),null);
for(const mutate of [(p:typeof payload)=>{p.entry[0].id='999';},(p:typeof payload)=>{p.entry[0].changes[0].value.metadata.phone_number_id='999';},(p:typeof payload)=>{p.entry[0].changes[0].value.statuses[0].status='unrecognized';},(p:typeof payload)=>{p.entry[0].changes[0].value.statuses[0].timestamp='-1';}]){const changed=structuredClone(payload);mutate(changed);const s=signed(changed);assert.equal(verifyMetaWebhook(config,s.signature,s.body),null);}
const duplicate=signed({...payload,entry:[payload.entry[0],payload.entry[0]]});assert.equal(verifyMetaWebhook(config,duplicate.signature,duplicate.body)?.length,4);
const incoming=structuredClone(payload);incoming.entry[0].changes[0].value.statuses=[];const s=signed(incoming);assert.deepEqual(verifyMetaWebhook(config,s.signature,s.body),[]);
console.log('Meta mocked HTTP checks passed: approved payloads, Armenian recipients, bounded single submission, signed owned minimal status batches. No provider delivery was attempted.');
