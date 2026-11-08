import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPhoneVerifyProxy} from '../src/lib/verify-proxy.ts';
test('phone verify proxy strips auth headers, preserves cancellation, never falls back', async()=>{
 let calls=0;const controller=new AbortController();
 const proxy=createPhoneVerifyProxy('https://fictional.invalid',async(url,init)=>{calls++;assert.equal(String(url),'https://app.noreon.health/api/native/verify-phone');assert.deepEqual(init?.headers,{'Content-Type':'application/json'});assert.equal(init?.signal,controller.signal);assert.equal(init?.redirect,'error');assert.deepEqual(JSON.parse(String(init?.body)),{phone:'+37499000101',token:'123456',type:'sms'});return new Response('{}',{status:503});});
 const response=await proxy('https://fictional.invalid/auth/v1/verify',{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer old-session'},body:JSON.stringify({phone:'+37499000101',token:'123456',type:'sms',gotrue_meta_security:{}})});
 assert.equal(response.status,503);assert.equal(calls,1);
});
test('CAPTCHA send retains the SDK transport',async()=>{
 const proxy=createPhoneVerifyProxy('https://fictional.invalid',async(url,init)=>{assert.equal(String(url),'https://fictional.invalid/auth/v1/otp');assert.equal(init?.body,'captcha-body');return new Response('{}');});
 await proxy('https://fictional.invalid/auth/v1/otp',{method:'POST',body:'captcha-body'});
});
