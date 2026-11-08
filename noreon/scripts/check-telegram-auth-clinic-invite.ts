import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

// T-auth B-2b-2: the actual invitee accept and code paths with mocked Telegram, RPC, Auth and cookies.
type Resolution={url:string;shortCircuit?:boolean};type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;
const {registerHooks}=nodeModule as unknown as {registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
type Call={name:string;args:Record<string,unknown>};
const state={calls:[] as Call[],passwords:[] as string[],sent:[] as string[],cookies:new Map<string,string>(),rpc:{} as Record<string,unknown>,passwordError:false};
Object.assign(globalThis,{__clinicInvite:state});
const stubs:Record<string,string>={
 'next/headers':'const s=globalThis.__clinicInvite;export async function cookies(){return{get:n=>s.cookies.has(n)?{value:s.cookies.get(n)}:undefined,set:(n,v)=>s.cookies.set(n,v),delete:n=>s.cookies.delete(n)};}',
 './clinic-invite-config':'export const clinicTelegramInvitesReady=()=>true;',
 './hook':'export const telegramAuthKeys=()=>({digestKey:Buffer.alloc(32,7)});',
 './runtime':'const s=globalThis.__clinicInvite;export function telegramAuthService(){return{rpc:async(name,args)=>{s.calls.push({name,args});return{data:s.rpc[name],error:null};},auth:{admin:{updateUserById:async(id,attrs)=>{s.passwords.push(id+":"+attrs.password);return{error:s.passwordError?{message:"weak"}:null};}}}};}',
 '@/lib/telegram-runtime/config':'export const outboundConfig=()=>({});',
 '@/lib/telegram-channel/outbound':'const s=globalThis.__clinicInvite;export function createTelegramAdapter(){return{deliverText:async m=>{s.sent.push(m.address+":"+m.text);return{kind:"accepted"};}};}',
 '@/lib/telegram-channel/link':'export const telegramHttpsPort={};',
};
const hook=registerHooks({resolve(s,c,next){const source=stubs[s];return source!==undefined?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);}});
const invitationId='d1600000-0000-4000-8000-000000000101',user='d1600000-0000-4000-8000-000000000040',challenge='d1600000-0000-4000-8000-000000000201';
const reset=()=>{state.calls=[];state.passwords=[];state.sent=[];state.passwordError=false;};
try{
 const {sendClinicInviteCode,acceptClinicInvite}=await import('@/lib/telegram-auth/clinic-invite');
 const accept=(code='123456')=>acceptClinicInvite({invitationId,generation:1,code,password:'synthetic-password-12'});

 // Without the code cookie nothing is called.
 assert.deepEqual(await accept(),{ok:false,reason:'resend'});
 assert.equal(state.calls.length,0,'No RPC without the browser nonce');

 // Not proven yet: no message, no cookie.
 state.rpc.clinic_invite_code_begin={ok:false,code:'not_proven'};
 assert.deepEqual(await sendClinicInviteCode(invitationId,1,'A'.repeat(32)),{ok:false,reason:'not_proven'});
 assert.equal(state.sent.length+state.cookies.size,0,'Nothing sent before the proof');
 const begin=state.calls[0]!.args;
 assert.match(String(begin.p_start_token_hash),/^[a-f0-9]{64}$/);assert.notEqual(begin.p_start_token_hash,'A'.repeat(32),'Only the start token hash leaves the server');

 // Proven: the code goes to the proven chat only, and the browser gets the nonce cookie.
 reset();state.rpc.clinic_invite_code_begin={ok:true,challengeId:challenge,address:'7340'};
 assert.deepEqual(await sendClinicInviteCode(invitationId,1,'A'.repeat(32)),{ok:true});
 assert.equal(state.sent.length,1);assert.match(state.sent[0]!,/^7340:Նորեոն Հելթ [^]*\d{6}/);
 assert.ok(state.cookies.has('noreon_clinic_invite'),'Nonce cookie set');
 const code=/(\d{6})/.exec(state.sent[0]!)![1]!;

 // A wrong code never sets a password.
 reset();state.rpc.clinic_invite_code_verify={ok:false,code:'wrong_code'};
 assert.deepEqual(await accept('000000'),{ok:false,reason:'invalid_code'});
 assert.equal(state.passwords.length,0,'Wrong code: no password');

 // Right code, password refused by Auth: no finalize, asks for a new code.
 reset();state.rpc.clinic_invite_code_verify={ok:true,authUserId:user};state.passwordError=true;
 assert.deepEqual(await accept(code),{ok:false,reason:'resend'});
 assert.ok(!state.calls.some(c=>c.name==='clinic_invitation_finalize'),'No finalize without the password');

 // Right code: password on exactly the verified account, then finalize with the same nonce.
 reset();state.rpc.clinic_invitation_finalize={ok:true,membershipId:'d1600000-0000-4000-8000-000000000301'};
 assert.deepEqual(await accept(code),{ok:true});
 assert.deepEqual(state.passwords,[`${user}:synthetic-password-12`]);
 assert.deepEqual(state.calls.map(c=>c.name),['clinic_invite_code_verify','clinic_invitation_finalize']);
 assert.equal(state.calls[0]!.args.p_nonce_hmac,state.calls[1]!.args.p_nonce_hmac,'Finalize uses the verifying browser nonce');
 assert.ok(!state.cookies.has('noreon_clinic_invite'),'Cookie cleared after acceptance');

 // Telegram account already used elsewhere: a clear refusal.
 state.cookies.set('noreon_clinic_invite',JSON.stringify({nonce:'B'.repeat(43),challengeId:challenge,invitationId,generation:1}));
 reset();state.rpc.clinic_invitation_finalize={ok:false,code:'telegram_in_use'};
 assert.deepEqual(await accept(code),{ok:false,reason:'telegram_in_use'});
 // A cookie for another invitation is never used.
 state.cookies.set('noreon_clinic_invite',JSON.stringify({nonce:'B'.repeat(43),challengeId:challenge,invitationId:challenge,generation:1}));
 reset();assert.deepEqual(await accept(code),{ok:false,reason:'resend'});assert.equal(state.calls.length,0);
 console.log('Clinic invitation by Telegram PASS: start-token hash only, code only after proof to the proven chat, password only after the code and on the verified account, finalize bound to the verifying browser (mocked RPC/Auth/Telegram; SQL and browser checks separate).');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__clinicInvite');}
