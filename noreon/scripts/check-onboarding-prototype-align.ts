/** Onboarding, questionnaire intro and Me in the prototype's style (pairs 03, 05, 16), with only the
 * questions page's request data isolated. The intro shows once before the first answer and never
 * replaces a started or finished questionnaire; copy names no staff member and claims no review. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {tx} from '@/lib/patient/copy';
import {MeetZoe} from '@/components/patient/meet-zoe';
import {QuestionnaireIntro} from '@/components/patient/questionnaire-intro';

type State = {profile:{name:string;locale:'en'|'hy'};assessment:{id:string;answers:Record<string,unknown>;completedAt:string|null}};
let state: State;
const exports: Record<string, unknown> = {};
new vm.Script(ts.transpileModule(readFileSync('app/patient/questions/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports,require(name:string){
 if(name==='react/jsx-runtime')return jsx;
 // These assertions exercise the classic questionnaire, with chat-only routing disabled.
 if(name==='next/navigation')return {redirect:()=>{throw Error('Unexpected questionnaire redirect');}};
 if(name.endsWith('/member-chat-config'))return {memberChatOnlyEnabled:()=>false};
 if(name.endsWith('/repository'))return {requireRegistered:async()=>state};
 if(name.endsWith('/patient-shell'))return {PatientShell:({children}:{children:React.ReactNode})=>React.createElement('main',null,children)};
 if(name.endsWith('/onboarding-steps'))return {OnboardingSteps:({step}:{step:number})=>React.createElement('div',{'data-onboarding-step':step})};
 if(name.endsWith('/questionnaire'))return {Questionnaire:()=>React.createElement('p',null,'questionnaire')};
 if(name.endsWith('/questionnaire-intro'))return {QuestionnaireIntro:()=>React.createElement('p',null,'intro')};
 if(name.endsWith('/questionnaire-answers'))return {QuestionnaireAnswers:()=>React.createElement('p',null,'answers summary')};
 if(name.endsWith('/copy'))return {tx};
 throw Error(`Unexpected boundary: ${name}`);
}});
const Questions = exports.default as (p:{searchParams:Promise<Record<string,string>>})=>Promise<React.ReactElement>;
const render = async (answers: Record<string,unknown>, completedAt: string|null, sp: Record<string,string> = {}) => {
 state = {profile:{name:'Fictional',locale:'en'},assessment:{id:'a',answers,completedAt}};
 return renderToStaticMarkup(await Questions({searchParams:Promise.resolve(sp)}));
};
assert.match(await render({}, null), /intro/, 'nothing answered: the intro first');
assert.match(await render({'q1.age':{}}, null), /intro/, 'only the sign-up profile answered: still the intro');
assert.match(await render({}, null, {start:'1'}), /questionnaire/, 'Start opens the questionnaire');
assert.match(await render({'q2.weight':{}}, null), /questionnaire/, 'a started questionnaire goes straight back to its question');
assert.match(await render({}, '2026-10-18T00:00:00Z'), /answers summary/, 'a finished questionnaire never shows the intro; it opens as a read-only summary (QA 175)');
assert.match(await render({}, '2026-10-18T00:00:00Z', {edit:'1'}), /questionnaire/, 'Changing answers opens the form');

for (const locale of ['en','hy'] as const) {
 const intro = renderToStaticMarkup(React.createElement(QuestionnaireIntro,{locale}));
 assert.ok(intro.includes('href="tel:103"'),'red safety box calls 103');
 assert.ok(intro.includes('href="/patient/questions?start=1"'),'Start opens the same questionnaire');
 assert.ok(!/Dr\.|Narine|Ani|reviews each|reads every/i.test(intro),'no named staff, no review promise');
 const zoe = renderToStaticMarkup(React.createElement(MeetZoe,{locale,name:'Mariam Fictional'}));
 assert.ok(zoe.includes(locale==='en'?'Hello, Mariam.':'Բարև, Mariam։'),'greets by first name');
 assert.ok(!/\bAI\b|Narine|Ani\b|09:00/.test(zoe),'no AI claim, named staff or reply hours before sign-off');
 assert.ok(zoe.includes(locale==='en'?'never starts, stops or changes a medicine':'երբեք չի սկսում'),'Zoe safety line');
 for (const html of [intro, zoe]) assert.doesNotMatch(html,/—/,'no em dashes');
}
const zoePage = readFileSync('app/patient/zoe/page.tsx','utf8');
// Chat first (Khikar, 18 Oct 22:57): one fixed line, "AI assistant, not a doctor" (redesign rail 3); the
// emergency call is the header's pill only, and the longer explanation is Help's About Zoe.
assert.match(zoePage,/data-zoe-rail/,'Zoe screen: permanent AI line');
assert.match(zoePage,/"AI assistant, not a doctor"/,'the line says AI assistant, not a doctor');
assert.doesNotMatch(zoePage,/tel:103|data-zoe-safety/,'no banner or 103 control on the Zoe screen');
assert.doesNotMatch(zoePage,/checked by fixed rules|հաստատուն կանոններով/,'never claim typed text is checked for urgent words (S1 list empty until signed)');
console.log('Zoe screen: one AI line, no 103 of its own. Onboarding Meet Zoe, questionnaire intro (once, before the first answer) and copy limits passed in EN and HY.');
