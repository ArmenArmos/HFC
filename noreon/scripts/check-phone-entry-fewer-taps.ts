// Fewer taps in member sign-in (Khikar, 19 Oct), CAPTCHA off: the code is requested as soon as the number is
// complete, the sixth digit signs in, and coming back from the bot asks for the code again. Every complete number
// takes the same request, so the page never tells a bound number from an unbound one before the server answers.
// Exercises the actual component; only actions, navigation, timers and the document are replaced. Nothing is sent.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {normalizePhone,armenianNationalDigits,armenianPhoneFromNational,foreignInternationalNumber} from '@/lib/patient/validation';
import {tx} from '@/lib/patient/copy';
const continuePathModule=await import('@/lib/patient/continue-path');
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

// Timers run only when the check says so (the debounce is observable).
const timers=new Map<number,()=>void>();let timerId=0;
const runTimers=async()=>act(async()=>{const due=[...timers.values()];timers.clear();for(const fn of due)fn();});
const sends:Array<{phone:string;token?:string}>=[];
const verifies:Array<{phone:string;code:string}>=[];
let sendResult:unknown={ok:true};
const keeps:(string|undefined)[]=[];
let verifyResult:unknown={ok:false};
// Sign-in ends in a full load, which binds the tab to the account (QA a6-01).
let destination='';
let clock=1_000_000;
const FakeDate={now:()=>clock};
const listeners:Record<string,Array<()=>void>>={};
const document={cookie:'',visibilityState:'visible',addEventListener:(t:string,fn:()=>void)=>{(listeners[t]??=[]).push(fn);},removeEventListener:(t:string,fn:()=>void)=>{listeners[t]=(listeners[t]??[]).filter(f=>f!==fn);}};
const exports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync('components/patient/phone-entry.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports,window:{location:{replace:(path:string)=>{destination=path;}}},document,Date:FakeDate,process:{env:{}},setTimeout:(fn:()=>void)=>{timers.set(++timerId,fn);return timerId;},clearTimeout(id:number){timers.delete(id);},require:(name:string)=>{
 if(name==='react')return React;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='@hcaptcha/react-hcaptcha')return {default:()=>{throw Error('No CAPTCHA widget when it is off');}};
 if(name==='next/navigation')return {useRouter:()=>({})};
 if(name.endsWith('/continue-path'))return continuePathModule;
 if(name.endsWith('/patient/actions'))return {requestPhoneCode:async(phone:string,token?:string,shownLink?:string)=>{sends.push({phone,token});keeps.push(shownLink);return sendResult;},verifyPhoneCode:async(phone:string,c:string)=>{verifies.push({phone,code:c});return verifyResult;},switchTelegramAccount:async()=>({ok:false})};
 if(name.endsWith('/validation'))return {normalizePhone,armenianNationalDigits,armenianPhoneFromNational,foreignInternationalNumber};
 if(name.endsWith('/copy'))return {tx};
 if(name.endsWith('/transport'))return {safeRequest:async(fn:()=>unknown)=>fn()};
 if(name.endsWith('/patient-shell'))return {PatientShell:({children}:{children:React.ReactNode})=>React.createElement('main',{},children)};
 if(name.endsWith('/onboarding-steps'))return {OnboardingSteps:()=>null};
 if(name.endsWith('/button'))return {Button:({children,variant,...props}:{children:React.ReactNode;variant?:string})=>{void variant;return React.createElement('button',props,children);}};
 if(name.endsWith('/input'))return {Input:(props:object)=>React.createElement('input',props)};
 if(name.endsWith('/label'))return {Label:(props:object)=>React.createElement('label',props)};
 throw Error(name);
}});
const PhoneEntry=exports.PhoneEntry as React.ComponentType<{initialLocale:string;siteKey:string;delivery?:string}>;
async function mount(locale='en'){
 let view!:ReactTestRenderer;
 await act(async()=>{view=create(React.createElement(PhoneEntry,{initialLocale:locale,siteKey:'',delivery:'telegram'}),{createNodeMock:()=>({focus(){}})});});
 const root=()=>view.root;
 return {view,root,
  type:async(value:string)=>act(async()=>root().findByType('input').props.onChange({target:{value}})),
  submit:async()=>act(async()=>root().findByType('form').props.onSubmit({preventDefault(){}})),
  text:()=>JSON.stringify(view.toJSON())};
}

// 1. A bound member: no tap to send the code, and none to sign in.
{
 sends.length=0;verifies.length=0;sendResult={ok:true};verifyResult={ok:true};destination='';
 const p=await mount();
 assert.match(p.text(),/Send the code/,'The phone step offers one action, used only as a fallback');
 await p.type('9900000');
 await runTimers();
 assert.equal(sends.length,0,'Seven digits: nothing is sent');
 await p.type('99000001');
 assert.equal(sends.length,0,'The code waits a moment after the eighth digit (last correction)');
 await runTimers();
 assert.deepEqual(sends,[{phone:'+37499000001',token:undefined}],'Then the code is requested once, without a tap or a confirm screen');
 assert.match(p.text(),/Enter the code we sent you in Telegram/,'Straight to the code');
 await runTimers();
 assert.equal(sends.length,1,'Never twice for the same number');
 await p.type('12345');
 assert.equal(verifies.length,0,'Five digits: nothing is checked');
 await p.type('123456');
 assert.deepEqual(verifies,[{phone:'+37499000001',code:'123456'}],'The sixth digit signs in (typed, pasted or filled from the message)');
 assert.equal(destination,'/patient/dashboard','Signed in, on Home');
 await act(async()=>p.view.unmount());
}

// 2. A rejected code is never checked twice; a code with no answer (network) may be tried again with the button.
{
 sends.length=0;verifies.length=0;sendResult={ok:true};verifyResult={ok:false};destination='';
 const p=await mount();
 await p.type('99000001');await runTimers();
 await p.type('000000');
 assert.equal(verifies.length,1);
 assert.match(p.text(),/invalid or expired/);
 await p.submit();
 assert.equal(verifies.length,1,'The same rejected code is not sent again by the button');
 verifyResult=undefined;
 await p.type('111111');
 assert.equal(verifies.length,2);
 await p.submit();
 assert.equal(verifies.length,3,'No answer about the code: the button tries it again');
 verifyResult={ok:true};
 await p.submit();
 assert.equal(verifies.length,4);assert.equal(destination,'/patient/dashboard');
 await act(async()=>p.view.unmount());
}

// 3. Not bound yet: the same request, then the bot step; coming back to the page asks for the code again.
{
 sends.length=0;verifies.length=0;sendResult={ok:false,reason:'prove',url:'https://t.me/noreon_stub_bot?start=x'};
 const p=await mount();
 await p.type('99000002');await runTimers();
 assert.deepEqual(sends,[{phone:'+37499000002',token:undefined}],'Same request as for a bound number: nothing tells them apart before the server answers');
 assert.match(p.text(),/Confirm your number in Telegram/);
 const back=async()=>act(async()=>{for(const fn of [...(listeners.visibilitychange??[])])fn();});
 await back();
 assert.equal(sends.length,1,'A return within 5 s of the bot link is too soon to have shared: nothing');
 // Review F-03: a storm of returns sends once; at most 5 automatic requests per bot step, 5 s apart.
 clock+=6000;
 await act(async()=>{for(let i=0;i<20;i++)for(const fn of [...(listeners.visibilitychange??[])])fn();});
 assert.equal(sends.length,2,'Twenty returns at once: one request');
 for(let i=0;i<8;i++){clock+=6000;await back();}
 assert.equal(sends.length,6,'At most five automatic requests per bot step');
 // Shared now: the next screen without a tap (via the button here, since the automatic ones are spent).
 sendResult={ok:true};
 await p.submit();
 assert.equal(sends.length,7);assert.match(p.text(),/Enter the code we sent you in Telegram/);
 clock+=6000;await back();
 assert.equal(sends.length,7,'Only on the bot step, not after');
 await act(async()=>p.view.unmount());
}

// 4. A refused send (rate limit) is not repeated by itself; Change number lets a corrected number go at once.
{
 sends.length=0;sendResult={ok:false,reason:'rate_limited'};
 const p=await mount();
 await p.type('99000003');await runTimers();await runTimers();
 assert.equal(sends.length,1,'A refused send is not retried by itself');
 assert.match(p.text(),/Too many tries/);
 sendResult={ok:true};
 await p.type('99000004');await runTimers();
 assert.equal(sends.length,2,'A corrected number goes once');
 // Review F-01: Change number without an edit sends nothing; an edit sends once; the button still sends the same number.
 await act(async()=>p.root().findAllByType('button').find(b=>b.children.join('')==='Change number')!.props.onClick());
 await runTimers();
 assert.equal(sends.length,2,'Change number alone does not send the old number again');
 await p.type('99000005');await runTimers();
 assert.equal(sends.length,3,'An edited number goes once');
 await act(async()=>p.root().findAllByType('button').find(b=>b.children.join('')==='Change number')!.props.onClick());
 await p.submit();
 assert.equal(sends.length,4,'The button may send the same number again');
 await act(async()=>p.view.unmount());
}
// 5. A first bot link explains itself; a repeated proof request and queued contact have visible feedback.
for(const [locale,notReceived,pending] of [
 ['hy','Ձեր համարը Telegram-ից դեռ չենք ստացել։ Նորեոն Հելթ բոտում սեղմեք Start, ապա «Կիսվել իմ համարով», հետո վերադարձեք այստեղ։','Ձեր համարը Telegram-ից ճանապարհին է։ Սպասեք մի քանի վայրկյան և նորից սեղմեք կոճակը։'],
 ['en',"We haven't received your number from Telegram yet. In the Noreon bot, press Start, then tap “Share my phone number”, then come back here.",'Your number is on its way from Telegram. Wait a few seconds, then tap the button again.'],
 ['ru','Мы ещё не получили ваш номер из Telegram. В боте Нореон Хелс нажмите «Запустить» (Start), затем «Поделиться номером телефона» и вернитесь сюда.','Ваш номер уже в пути из Telegram. Подождите несколько секунд и нажмите кнопку ещё раз.'],
]){
 const p=await mount(locale);
 const alerts=()=>p.root().findAllByProps({role:'alert'}).map(n=>n.children.join(''));
 sendResult={ok:false,reason:'pending'};
 await p.type('99000006');await runTimers();
 assert.deepEqual(alerts(),[pending],`${locale}: pending on the phone step`);
 sendResult={ok:false,reason:'prove',url:'https://t.me/noreon_stub_bot?start=x'};
 await p.submit();
 assert.deepEqual(alerts(),[],`${locale}: first prove has no redundant alert`);
 await p.submit();
 assert.deepEqual(alerts(),[notReceived],`${locale}: repeated prove explains the missing contact`);
 sendResult={ok:false,reason:'pending'};
 await p.submit();
 assert.deepEqual(alerts(),[pending],`${locale}: pending on the bot step`);
 sendResult={ok:true};await p.submit();
 assert.deepEqual(alerts(),[],`${locale}: successful send clears the alert`);
 for(let i=0;i<60;i++)await runTimers();
 sendResult={ok:false,reason:'pending'};
 const resendLabel=tx(locale as 'hy'|'en'|'ru','Կրկին ուղարկել կոդը','Resend code','Отправить код снова');
 await act(async()=>p.root().findAllByType('button').find(b=>b.children.join('')===resendLabel)!.props.onClick());
 assert.deepEqual(alerts(),[pending],`${locale}: pending on the code step`);
 await act(async()=>p.view.unmount());
}
// 6. Khikar, 4 Nov: on the bot step the page sends back the link it shows; a kept link (url null) stays on the page.
{
 keeps.length=0;sendResult={ok:false,reason:'prove',url:'https://t.me/noreon_stub_bot?start=first'};
 const p=await mount();
 await p.type('99000007');await runTimers();
 const link=()=>p.root().findAllByType('a').find(a=>a.props.href?.startsWith('https://t.me/'))?.props.href;
 assert.equal(link(),'https://t.me/noreon_stub_bot?start=first');assert.equal(keeps.at(-1),undefined,'The first request has no link to keep');
 sendResult={ok:false,reason:'prove',url:null};await p.submit();
 assert.equal(keeps.at(-1),'first','The bot step sends back the link it shows');assert.equal(link(),'https://t.me/noreon_stub_bot?start=first','A kept link stays');
 sendResult={ok:false,reason:'prove',url:'https://t.me/noreon_stub_bot?start=second'};await p.submit();
 assert.equal(link(),'https://t.me/noreon_stub_bot?start=second','A replaced link is shown');
 await act(async()=>p.view.unmount());
}
// Reserved full numbers use the same member controls and code request. The server response
// still chooses whether contact proof is required; no switch/query/cookie chooses a test mode.
for (const allowed of [true,false]) {
 sends.length=0;
 sendResult=allowed?{ok:true}:{ok:false,reason:'prove',url:'https://t.me/noreon_stub_bot?start=reserved'};
 const p=await mount();
 assert.doesNotMatch(p.text(),/Test mode|Test sign-in|Use test account/i);
 await p.type('+99900000001');await runTimers();
 assert.deepEqual(sends,[{phone:'+99900000001',token:undefined}]);
 if(allowed)assert.match(p.text(),/6-digit code/);
 else assert.ok(p.root().findAllByType('a').some(a=>a.props.href==='https://t.me/noreon_stub_bot?start=reserved'),'Switched off/refused follows the existing proof screen');
 await act(async()=>p.view.unmount());
}
// QA 284: refused contacts need specific recovery guidance, never another account's number.
for (const [locale, mismatch, foreign, stale, change, rightAccount] of [
 ['en', 'The Telegram account you shared from has a different phone number than the one you typed. Change the number here, or share from the Telegram account that uses this number.', 'You shared someone else’s contact or a forwarded contact card. In the Noreon bot, use the “Share my phone number” button to share your own number.', 'That contact share is out of date. Open the Noreon bot again and use the “Share my phone number” button to share your own number.', 'Change number', 'Share from the right Telegram account'],
 ['hy', 'Telegram-ի հաշիվը, որից կիսվել եք համարով, ունի Ձեր մուտքագրածից տարբեր հեռախոսահամար։ Փոխեք համարն այստեղ կամ կիսվեք այն Telegram հաշվից, որն օգտագործում է այս համարը։', 'Դուք կիսվել եք ուրիշի կոնտակտով կամ փոխանցված կոնտակտի քարտով։ Նորեոն Հելթ բոտում սեղմեք «Կիսվել իմ համարով» կոճակը՝ Ձեր սեփական համարով կիսվելու համար։', 'Համարով կիսվելու այս փորձն այլևս չի գործում։ Կրկին բացեք Նորեոն Հելթ բոտը և սեղմեք «Կիսվել իմ համարով» կոճակը՝ Ձեր սեփական համարով կիսվելու համար։', 'Փոխել համարը', 'Կիսվել ճիշտ Telegram հաշվից'],
 ['ru', 'В аккаунте Telegram, из которого вы поделились контактом, указан другой номер телефона, чем тот, который вы ввели. Измените номер здесь или поделитесь контактом из аккаунта Telegram с этим номером.', 'Вы отправили чужой контакт или пересланную карточку контакта. В боте Нореон Хелс нажмите «Поделиться номером телефона», чтобы отправить свой номер.', 'Этот контакт уже устарел. Снова откройте бота Нореон Хелс и нажмите «Поделиться номером телефона», чтобы отправить свой номер.', 'Изменить номер', 'Поделиться из нужного аккаунта Telegram'],
]) {
 for (const [refusal, message] of [['phone_mismatch', mismatch], ['not_own_contact', foreign], ['stale', stale]]) {
  const url='https://t.me/noreon_stub_bot?start=refused';
  sendResult={ok:false,reason:'prove',url};
  const p=await mount(locale);
  await p.type('99000008');await runTimers();
  sendResult={ok:false,reason:'prove',url:null,contactRefusal:refusal,phone:'+37499000999'};
  await p.submit();
  const text=p.text();
  assert.ok(text.includes(message), `${locale}: ${refusal} explains the refusal`);
  assert.doesNotMatch(text,/haven't received|դեռ չենք ստացել|ещё не получили/, 'No misleading waiting message for a refusal');
  assert.ok(text.includes('+37499000008'), 'Only the typed phone is shown');
  assert.deepEqual(text.match(/\+?\d{7,}/g), ['+37499000008'], 'No other full or partial phone number in the response UI');
  const link=p.root().findAllByType('a').find(a=>a.props.href===url)!;
  assert.equal(link.props.target,'_blank');
  assert.equal(link.children.join(''),refusal==='phone_mismatch'?rightAccount:({en:'Open Telegram',hy:'Բացել Telegram-ը',ru:'Открыть Telegram'}[locale as 'en'|'hy'|'ru']), `${locale}: refusal recovery opens the bot`);
  assert.ok(!text.includes('0999'), 'No partial number from the other account');
  await act(async()=>p.root().findAllByType('button').find(b=>b.children.join('')===change)!.props.onClick());
  assert.equal(p.root().findByType('input').props.value,'99000008', 'Change number preserves an editable number');
  assert.equal(p.root().findByType('input').props.disabled,false);
  assert.ok(!p.text().includes(message),'Changing number clears refusal guidance');
  await p.type('99000009');assert.equal(p.root().findByType('input').props.value,'99000009');
  await act(async()=>p.view.unmount());
 }
}
// A refusal returned on the first proof response is visible immediately and follows locale changes.
{
 sendResult={ok:false,reason:'prove',url:'https://t.me/noreon_stub_bot?start=x',contactRefusal:'phone_mismatch'};
 const p=await mount();await p.type('99000008');await runTimers();
 assert.match(p.text(),/different phone number/);
 await act(async()=>p.root().findAllByType('button').find(b=>b.children.join('')==='Русский')!.props.onClick());
 assert.match(p.text(),/указан другой номер телефона/);assert.doesNotMatch(p.text(),/different phone number/);
 sendResult={ok:false,reason:'prove',url:null};await p.submit();
 assert.match(p.text(),/ещё не получили/);assert.doesNotMatch(p.text(),/указан другой номер телефона/);
 await act(async()=>p.view.unmount());
}
console.log('Phone entry, fewer taps: auto-send once per complete number, sixth-digit sign-in, back-from-bot send, one request shape for every number, reserved full-number paste with server-selected fallback, no repeat of a rejected code or a refused send; QA 284 refusal guidance and recovery in HY/EN/RU without another phone number (actions mocked).');
