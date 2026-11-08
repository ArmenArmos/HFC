/** QA 188: a refused staff sign-in keeps the email, clears only the password and focuses it, on both
 * the staff login (/staff/login) and the back-office sign-in; the email never goes into a URL. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as locale from '@/lib/locale';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
type Result=Record<string,unknown>;
function load(file:string,deps:Record<string,unknown>){const exports:Record<string,unknown>={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name in deps)return deps[name];throw Error('Unexpected dependency '+name);}});return exports;}
const forms:FormData[]=[];
let next:Result={failed:1};
const staff=load('components/staff/login-form.tsx',{'@/lib/staff/actions':{loginForm:async(_p:unknown,form:FormData)=>{forms.push(form);return next;}}});
const back=load('components/backoffice/sign-in.tsx',{'@/lib/backoffice/actions':{backofficeSignIn:async(_p:unknown,form:FormData)=>{forms.push(form);return next;}},'@hcaptcha/react-hcaptcha':{default:()=>null},'@/lib/locale':locale});
const mocks:{password:{value:string;focused:number}}={password:{value:'',focused:0}};
const createNodeMock=(el:React.ReactElement<{type?:string}>)=>el.props.type==='password'?{get value(){return mocks.password.value;},set value(v:string){mocks.password.value=v;},focus(){mocks.password.focused++;}}:{};
async function run(element:React.ReactElement,failure:Result,label:string){
 let tree!:ReactTestRenderer;await act(async()=>{tree=create(element,{createNodeMock});});
 const email=()=>tree.root.find(n=>n.type==='input'&&n.props.name==='email');
 await act(async()=>email().props.onChange({target:{value:'doctor@example.invalid'}}));
 mocks.password={value:'wrong-password',focused:0};
 next=failure;
 const form=new FormData();form.set('email','doctor@example.invalid');form.set('password','wrong-password');
 await act(async()=>{React.startTransition(()=>(tree.root.findByType('form').props.action as (f:FormData)=>void)(form));});
 assert.equal(email().props.value,'doctor@example.invalid',`${label}: the email stays`);
 assert.equal(mocks.password.value,'',`${label}: only the password is cleared`);
 assert.equal(mocks.password.focused,1,`${label}: focus moves to the password`);
 assert.ok(JSON.stringify(tree.toJSON()).includes('role'),`${label}: an error is shown`);
 // A second wrong password refocuses again.
 next={...failure,...('failed' in failure?{failed:2}:{})};mocks.password={value:'again',focused:0};
 await act(async()=>{React.startTransition(()=>(tree.root.findByType('form').props.action as (f:FormData)=>void)(form));});
 assert.equal(mocks.password.focused,1,`${label}: a second failure refocuses the password`);
 tree.unmount();
}
await run(React.createElement(staff.StaffLoginForm as React.FC<Record<string,unknown>>,{button:'Sign in',fieldClass:'',buttonClass:''}),{failed:1},'Staff login');
assert.ok(JSON.stringify(staff.STAFF_LOGIN_ERROR).includes('We couldn’t sign you in. Check your details or contact your administrator.'),'Existing error text kept');
await run(React.createElement(back.BackofficeSignIn as React.FC<Record<string,unknown>>,{locale:'en',siteKey:''}),{ok:false,message:'Sign-in was unsuccessful. Check your details or contact your administrator.'},'Back-office sign-in');
// The failure path never puts the email in a URL.
const action=readFileSync('lib/staff/actions.ts','utf8');
assert.doesNotMatch(action,/redirect\([^)]*email/i,'No email in a redirect URL');
assert.match(readFileSync('app/staff/login/page.tsx','utf8'),/<StaffLoginForm /,'The staff login page uses the form that keeps the email');
console.log('Staff login keeps the email after a refused attempt, clears only the password and focuses it (staff login and back office); no email in URLs.');
