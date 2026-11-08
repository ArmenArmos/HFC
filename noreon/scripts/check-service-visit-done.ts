/** QA 176: after the nurse completed the home visit, /patient/service shows the tests as done, with no
 * price and no clinic or home choice for them, and a short "visit is done" note. */
import * as textLanguage from '@/lib/text-language';
import * as testCatalogue from '@/lib/clinical/seed/tests';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as displayTime from '@/lib/real-booking/display-time';
import * as visitGate from '@/lib/real-booking/visit-gate';
import * as realLocaleModule from '@/lib/locale';
import type {PilotBookingData,PilotFormAction} from '@/lib/real-booking/appointment-schema';
const require=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
// Prices render a marker so the check sees whether the page still offers to charge for a test.
const pricing={TestPrices:({items}:{items:{id:string}[]})=>items.length?React.createElement('section',{'data-prices':items.map(i=>i.id).join(',')}):null,MemberPaymentStatus:()=>null,paymentFor:()=>undefined};
function load(file:string):Record<string,unknown>{if(cache.has(file))return cache.get(file)!;const exports:Record<string,unknown>={};cache.set(file,exports);const code=ts.transpileModule(readFileSync('components/real-booking/'+file+'.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,FormData,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return require(name);if(name==='@/lib/real-booking/display-time')return displayTime;if(name==='@/lib/real-booking/visit-gate')return visitGate;if(name==='@/components/pilot-commerce/member-pricing')return pricing;if(name.startsWith('./'))return load(name.slice(2));if(name==='@/lib/clinical/seed/tests')return testCatalogue;if(name==='@/lib/locale')return realLocaleModule;if(name==='@/lib/text-language')return textLanguage;throw Error('Unexpected dependency '+name);}});return exports;}
const {PilotMemberBooking}=load('pilot-member') as typeof import('../components/real-booking/pilot-member');
const {testStates,BookingTests}=load('booking-tests') as typeof import('../components/real-booking/booking-tests');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const program=[{id:'lipid-ldl',title:'Lipid profile with LDL-C',method:'lab' as const,preparation:''}];
const data:PilotBookingData={available:true,canChange:true,canCancel:true,unavailableReason:null,program,offers:[],appointments:[],clinics:{}};
const never:PilotFormAction=async()=>{throw Error('Unexpected action');};
const homeForm=React.createElement('form',{'data-home-request':true});
const render=(doneTestIds:string[],locale:'en'|'hy'|'ru'='en',homeRequestOpen=false)=>renderToStaticMarkup(React.createElement(PilotMemberBooking,{data,locale,commandId:id(90),changeCommandIds:{},cancelCommandIds:{},selectAction:never,changeAction:never,refreshHref:'/patient/service',homeVisit:homeForm,pricing:{catalog:[],payments:[]},doneTestIds,homeRequestOpen}));

// The completed request's tests are the done ones; an open or cancelled one marks nothing done.
assert.deepEqual(visitGate.completedRequestTestIds([{status:'completed',requirements:[{id:'lipid-ldl'}]},{status:'cancelled',requirements:[{id:'other'}]},{status:'requested',requirements:[{id:'third'}]}]),['lipid-ldl']);
// Astra #404 F1: programme A's completed home visit is history once the questionnaire context changed;
// programme B needs the same test and books it again. A stays completed in the request list itself.
assert.deepEqual(visitGate.completedRequestTestIds([{status:'completed',contextStale:true,requirements:[{id:'lipid-ldl'}]}]),[],'An earlier programme’s completed visit does not mark the test done');
assert.deepEqual(visitGate.completedRequestTestIds([{status:'completed',contextStale:true,requirements:[{id:'lipid-ldl'}]},{status:'completed',contextStale:false,requirements:[{id:'hba1c'}]}]),['hba1c']);
assert.equal(testStates(program,[],['lipid-ldl']).get('lipid-ldl'),'done');
assert.equal(testStates(program,[]).get('lipid-ldl'),'to-book');

// Before the visit: price and the clinic or home choice, as before.
const before=render([]);
assert.match(before,/0 of 1 booked/);
assert.match(before,/data-prices="lipid-ldl"/);
assert.match(before,/data-visit-choice/);

// After the nurse completed it: done count, no price, no choice, a short note. EN, HY, RU.
for(const [locale,count,note] of [['en','1 of 1 done','Your visit is done.'],['hy','1՝ 1-ից կատարված','Ձեր այցն ավարտված է։'],['ru','Выполнено: 1 из 1','Ваш визит завершён.']] as const){
 const after=render(['lipid-ldl'],locale);
 assert.ok(after.includes(count),`${locale}: the counter says done`);
 assert.ok(after.includes(note),`${locale}: the page says the visit is done`);
 assert.doesNotMatch(after,/data-prices/,`${locale}: no price for a test whose visit took place`);
 assert.doesNotMatch(after,/data-visit-choice|data-home-request/,`${locale}: no new clinic or home choice`);
 assert.doesNotMatch(after,/—/,'No em dashes');
}
// Mixed: one done, one still to arrange keeps the choice and prices only the remaining test.
const two={...data,program:[...program,{id:'glucose',title:'Fasting glucose',method:'lab' as const,preparation:''}]};
const mixed=renderToStaticMarkup(React.createElement(PilotMemberBooking,{data:two,locale:'en',commandId:id(91),changeCommandIds:{},cancelCommandIds:{},selectAction:never,changeAction:never,refreshHref:'/patient/service',homeVisit:homeForm,pricing:{catalog:[],payments:[]},doneTestIds:['lipid-ldl']}));
assert.match(mixed,/1 of 2 booked/);
assert.match(mixed,/data-prices="glucose"/);
assert.match(mixed,/data-visit-choice/);
assert.match(renderToStaticMarkup(React.createElement(BookingTests,{program,appointments:[],locale:'en',doneTestIds:['lipid-ldl']})),/data-test-state="done"/);
// The page derives the done tests from the member's home-visit requests.
assert.match(readFileSync('app/patient/service/page.tsx','utf8'),/doneTestIds=\{completedRequestTestIds\(data\.requests\)\}/);
console.log('Service visit done: a completed home visit counts as done, hides its price and the booking choice, and says the visit is done (EN/HY/RU).');
