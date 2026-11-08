import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

// T-auth B-3: the actual reset issue, code and completion paths with mocked Telegram, RPC, Auth and cookies.
type Resolution={url:string;shortCircuit?:boolean};type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;
const {registerHooks}=nodeModule as unknown as {registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
type Call={name:string;args:Record<string,unknown>};
const state={calls:[] as Call[],passwords:[] as string[],sent:[] as string[],cookies:new Map<string,string>(),rpc:{} as Record<string,unknown>};
Object.assign(globalThis,{__recovery:state});
process.env.NOREON_TELEGRAM_ENABLED='true';process.env.NOREON_STAFF_TELEGRAM_RECOVERY='true';process.env.NOREON_TELEGRAM_BOT_TOKEN='synthetic';
const stubs:Record<string,string>={
 'next/headers':'const s=globalThis.__recovery;export async function cookies(){return{get:n=>s.cookies.has(n)?{value:s.cookies.get(n)}:undefined,set:(n,v)=>s.cookies.set(n,v),delete:n=>s.cookies.delete(n)};}',
 './hook':'export const telegramAuthKeys=()=>({digestKey:Buffer.alloc(32,7)});',
 './runtime':'const s=globalThis.__recovery;export function telegramAuthService(){return{rpc:async(name,args)=>{s.calls.push({name,args});return{data:s.rpc[name],error:null};},auth:{admin:{updateUserById:async(id,attrs)=>{s.passwords.push(id+":"+attrs.password);return{error:null};}}}};}',
 '@/lib/telegram-runtime/config':'export const outboundConfig=()=>({});export const telegramEnabled=e=>e.NOREON_TELEGRAM_ENABLED==="true";',
 '@/lib/telegram-channel/outbound':'const s=globalThis.__recovery;export function createTelegramAdapter(){return{deliverText:async m=>{s.sent.push(m.address+"|"+m.text);return{kind:"accepted"};}};}',
 '@/lib/telegram-channel/link':'export const telegramHttpsPort={};',
};
const hook=registerHooks({resolve(s,c,next){const source=stubs[s];return source!==undefined?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);}});
const recoveryId='d1700000-0000-4000-8000-000000000101',user='d1700000-0000-4000-8000-000000000002',challenge='d1700000-0000-4000-8000-000000000201',token='T'.repeat(32);
const reset=()=>{state.calls=[];state.passwords=[];state.sent=[];};
try{
 const {issueStaffRecovery,sendRecoveryCode,completeRecovery}=await import('@/lib/telegram-auth/staff-recovery');
 // Issue: the link goes to the account's chat only, on the portal's host; the admin gets no link.
 const admin={rpc:async(name:string,args:Record<string,unknown>)=>{state.calls.push({name,args});return{data:{ok:true,recoveryId},error:null};}};
 state.rpc.staff_recovery_link={ok:true,token,address:'7420',portal:'clinic'};
 const issued=await issueStaffRecovery(admin as never,user,'clinic','https://clinic.example.invalid');
 assert.deepEqual(issued,{ok:true});
 assert.deepEqual(state.calls.map(c=>c.name),['staff_telegram_recovery_issue','staff_recovery_link'],'Admin call returns no link; the service mints it');
 assert.equal(state.sent.length,1);
 assert.ok(state.sent[0]!.startsWith('7420|')&&state.sent[0]!.includes(`https://clinic.example.invalid/clinic/real/recover#recovery=${recoveryId}&token=${token}`),'Link sent to the chat on the clinic host');
 // Completion needs this browser's code cookie.
 reset();assert.deepEqual(await completeRecovery({recoveryId,code:'123456',password:'synthetic-password-12'}),{ok:false,reason:'resend'});assert.equal(state.calls.length,0);
 // Code: only the token hash leaves the server; the cookie holds the nonce.
 state.rpc.staff_recovery_code_begin={ok:true,challengeId:challenge,address:'7420'};
 assert.deepEqual(await sendRecoveryCode(recoveryId,token),{ok:true});
 assert.notEqual(state.calls[0]!.args.p_token_hash,token);assert.match(String(state.calls[0]!.args.p_token_hash),/^[a-f0-9]{64}$/);
 const code=/(\d{6})/.exec(state.sent[0]!)![1]!;
 // Wrong code: no password.
 reset();state.rpc.staff_recovery_code_verify={ok:false,code:'wrong_code'};
 assert.deepEqual(await completeRecovery({recoveryId,code:'000000',password:'synthetic-password-12'}),{ok:false,reason:'invalid_code'});
 assert.equal(state.passwords.length,0);
 // Right code: password on the verified account, then finish (sessions end) with the same nonce.
 reset();state.rpc.staff_recovery_code_verify={ok:true,authUserId:user,portal:'staff'};state.rpc.staff_recovery_finish={ok:true,portal:'staff'};
 assert.deepEqual(await completeRecovery({recoveryId,code,password:'synthetic-password-12'}),{ok:true,portal:'staff'});
 assert.deepEqual(state.passwords,[`${user}:synthetic-password-12`]);
 assert.deepEqual(state.calls.map(c=>c.name),['staff_recovery_code_verify','staff_recovery_finish']);
 assert.equal(state.calls[0]!.args.p_nonce_hmac,state.calls[1]!.args.p_nonce_hmac);
 assert.ok(!state.cookies.has('noreon_staff_recovery'),'Cookie cleared');
 // Password changed but ending sessions not confirmed: retried once, then reported as such (review I-2).
 state.cookies.set('noreon_staff_recovery',JSON.stringify({nonce:'B'.repeat(43),challengeId:challenge,recoveryId}));
 reset();state.rpc.staff_recovery_finish={ok:false,code:'verification_expired'};
 assert.deepEqual(await completeRecovery({recoveryId,code,password:'synthetic-password-12'}),{ok:false,reason:'unconfirmed'});
 assert.equal(state.calls.filter(c=>c.name==='staff_recovery_finish').length,2,'Finish retried once');
 console.log('Telegram password reset PASS: link only to the account chat, token hash only, password only after the code and on the verified account, finish bound to the verifying browser (mocked RPC/Auth/Telegram; SQL checks separate).');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__recovery');}
