import assert from 'node:assert/strict';
import {selectFieldNativeStub} from './select-field-native-stub';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// @ts-expect-error Node 26 runtime supports registerHooks; declarations target Node 20.
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {newDemoState,demoStoreFor} from '@/lib/patient/demo-model';
import {createPatientService} from '@/lib/patient/service';
import * as validation from '@/lib/patient/validation';
import * as copy from '@/lib/patient/copy';
import * as realLocaleModule from '@/lib/locale';
const data=newDemoState(),store=demoStoreFor(data,async()=>{});
const fixture={store,user:{userId:data.userId,phone:'+37499000000'},navigations:[] as string[],reloads:0,zoeDue:false,zoeGrants:[] as unknown[][]};
Object.assign(globalThis,{__profileConflict:fixture,IS_REACT_ACT_ENVIRONMENT:true});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 const f='const f=globalThis.__profileConflict;';
 const mocks:Record<string,string>={
  'next/cache':'export const revalidatePath=()=>{};',
  '@/lib/patient/auth':f+'export const patientIdentity=async()=>f.user;',
  '@/lib/patient/repository':f+'export const patientStore=()=>f.store;',
  '@/lib/supabase/server':'export const createClient=()=>{throw Error("Unexpected Supabase access")};',
  '@/lib/messaging/twilio-verify-feedback':'export const completeVerifiedPhone=()=>{throw Error("Unexpected provider access")};',
  '@/lib/zoe/member':f+'export const zoeConsentPromptDue=async()=>f.zoeDue;export const readZoePrompt=async()=>({due:f.zoeDue,directAnswers:false});export const setZoeConsent=async(...a)=>{f.zoeGrants.push(a);return {ok:true};};',
  '@/lib/patient/demo':'export const demoEnabled=()=>false;export const restartDemoQuestions=()=>{};export const demoSignIn=()=>{};export const demoSignOut=()=>{};export const readDemo=()=>{};export const DEMO_PHONE="";',
 };
 return mocks[s]?{url:'data:text/javascript,'+encodeURIComponent(mocks[s]),shortCircuit:true}:next(s,c);
}});
const mounted:ReactTestRenderer[]=[];
function component(file:string,require:(name:string)=>unknown){
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require,process:{env:{NEXT_PUBLIC_PATIENT_DEMO:'false'}},window:{location:{reload(){fixture.reloads++;}}}});
 return exports;
}
try{
 const actions=await import('@/app/patient/actions');
 const {ProfileForm}=component('components/patient/profile-form.tsx',name=>{
  if(name==='@/components/ui/select-field')return selectFieldNativeStub;
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return jsx;
  if(name==='next/navigation')return {useRouter:()=>({replace:(url:string)=>fixture.navigations.push(url),refresh(){}})};
  if(name==='@/app/patient/actions')return actions;
  if(name==='@/lib/patient/validation')return validation;
  if(name==='@/lib/patient/copy')return copy;
  if(name==='@/lib/zoe/consent-copy')return {zoeStatement:()=>''};
  if(name==='@/lib/patient/transport')return {safeRequest:async(fn:()=>unknown)=>fn(),lockUnavailableMessage:()=>''};
  if(name==='lucide-react')return {ArrowLeft:'i',ShieldCheck:'i',UserRound:'i'};
  if(name.endsWith('/patient-shell'))return {PatientShell:({children}:{children:React.ReactNode})=>children};
  if(name.endsWith('/onboarding-steps'))return {OnboardingSteps:({step}:{step:number})=>React.createElement('div',{'data-onboarding-step':step})};
  if(name.endsWith('/birth-date-picker'))return {BirthDatePicker:({value,onChange}:{value:string;onChange:(value:string)=>void})=>React.createElement('input',{id:'birth-date',value,onChange:(e:{target:{value:string}})=>onChange(e.target.value)})};
  if(name.endsWith('/button'))return {Button:'button'};
  if(name.endsWith('/input'))return {Input:'input'};
  if(name.endsWith('/label'))return {Label:'label'};
  if(name.endsWith('/common'))return {CareLink:'a',IconTile:'span'};
  if(name==='@/lib/patient/signup-draft')return {SIGNUP_DRAFT_PREFIX:'noreon.signup.profile.',SIGNUP_DRAFT_MAX_AGE_MS:14*24*3600*1000,sweepSignupDrafts:()=>{}};
  if(name==='@/lib/locale')return realLocaleModule;throw Error(`Unexpected form dependency ${name}`);
 });
 const {default:Page}=component('app/patient/profile/page.tsx',name=>{
  if(name==='react/jsx-runtime')return jsx;
  // Mount the classic editor so the conflict checks reach the real form and save action.
  if(name==='next/navigation')return {redirect:()=>{throw Error('Unexpected profile redirect');}};
  if(name==='@/lib/patient/member-chat-config')return {memberChatOnlyEnabled:()=>false};
  if(name==='@/lib/patient/entry-routes')return {profileHop:()=>null};
  if(name==='next/headers')return {cookies:async()=>({get:()=>({value:'en'})})};
  if(name==='@/lib/patient/repository')return {getPatientState:async(options:unknown)=>{assert.equal((options as {coherentProfile?:boolean})?.coherentProfile,true,'Editable profile page requests coherent values and version');return structuredClone(data.state);}};
  if(name==='@/lib/patient/validation')return validation;
  if(name==='@/components/patient/profile-form')return {ProfileForm};
  if(name==='@/lib/patient/demo')return {demoEnabled:()=>false};
  if(name==='@/lib/zoe/member')return {readZoePrompt:async()=>({due:false,directAnswers:false})};
  if(name==='@/lib/patient/auth')return {patientIdentity:async()=>({userId:'00000000-0000-4000-8000-000000000001',phone:'+37499000001'})};
  if(name==='@/lib/locale')return realLocaleModule;throw Error(`Unexpected page dependency ${name}`);
 });
 const mount=async()=>{let renderer!:ReactTestRenderer;const element=await (Page as ()=>Promise<React.ReactElement>)();await act(async()=>{renderer=create(element);});mounted.push(renderer);return renderer;};
 const edit=async(r:ReactTestRenderer,id:string,value:string)=>act(async()=>r.root.find(node=>typeof node.type==='string'&&node.props.id===id).props.onChange({target:{value}}));
 const submit=async(r:ReactTestRenderer)=>act(async()=>{r.root.findByType('form').props.onSubmit({preventDefault(){}});});
 const original={name:'Synthetic concurrency member',birthDate:'1974-05-18',biologicalSex:'male' as const,locale:'en' as const};
 await createPatientService({user:async()=>fixture.user,store:()=>store}).saveProfile(original,true);
 const a=await mount(),b=await mount();
 await edit(a,'birth-date','18/05/1973');await submit(a);
 assert.equal(data.state.profile!.birthDate,'1973-05-18');
 await edit(b,'patient-name','Unsaved name draft');await submit(b);
 assert.equal(data.state.profile!.birthDate,'1973-05-18','Stale mounted form must not undo a saved demographic correction');
 assert.equal(data.state.profile!.name,original.name,'Conflict does not write stale fields');
 assert.equal(b.root.findByProps({id:'patient-name'}).props.value,'Unsaved name draft','Conflict preserves entered edits');
 assert.equal(fixture.navigations.length,1,'Conflict does not navigate or claim a save');
 assert.match(b.root.findByProps({role:'alert'}).children.join(''),/changed/);
 const reload=b.root.findAllByType('button').find(button=>button.children.join('')==='Reload saved details');
 assert.ok(reload,'Conflict offers an explicit reload');
 assert.equal(fixture.reloads,0,'Conflict never silently discards edits');
 await act(async()=>reload.props.onClick());assert.equal(fixture.reloads,1);
 // A server refresh must not silently rebase an old mounted draft onto the new revision.
 await act(async()=>b.update(await (Page as ()=>Promise<React.ReactElement>)()));
 await submit(b);assert.equal(data.state.profile!.name,original.name);
 const fresh=await mount();await edit(fresh,'patient-name','Saved after reload');await submit(fresh);
 assert.equal(data.state.profile!.name,'Saved after reload','Newly mounted details can save with their fresh revision');
 const before=structuredClone(data.state);
 for(const revision of [undefined,null,NaN,1.5,-2,'1']){
  const result=await (actions.saveProfile as (...args:unknown[])=>Promise<unknown>)(original,true,revision);
  assert.deepEqual(result,{ok:false,reason:'invalid'});
 }
 assert.deepEqual(data.state,before,'Missing and malformed browser revisions cannot write');
 data.state={profile:null,assessment:null,consentAccepted:false};
 const initial=await mount();
 await edit(initial,'patient-name',original.name);await edit(initial,'birth-date','18/05/1974');await edit(initial,'patient-sex','male');
 await submit(initial);
 assert.equal((data.state as {profile:unknown}).profile,null,'Continue on the details screen saves nothing');
 await act(async()=>initial.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
 await submit(initial);
 assert.equal(data.state.profile?.name,original.name,'Initial page supplies explicit -1 and creates the profile');
 assert.equal(fixture.navigations.at(-1),'/patient/ready','Successful initial creation continues the member journey');
 assert.deepEqual(await actions.saveProfile(original,true,-1),{ok:false,reason:'conflict'},'Initial creation snapshot cannot overwrite a created profile');
 // Fable F4: the action re-checks on the server that the Zoe statement is due; the form's flag alone grants nothing.
 // Gohar D-011 (lead 19 Oct 23:10): "Continue without Zoe" with the statement shown records a no;
 // no choice sent (statement not shown) records nothing.
 for(const [due,withZoe,expected] of [[false,true,0],[false,false,0],[true,undefined,0],[true,false,1],[true,true,1]] as const){
  data.state={profile:null,assessment:null,consentAccepted:false};fixture.zoeDue=due;fixture.zoeGrants=[];
  assert.equal(((await actions.saveProfile(original,true,-1,withZoe)) as {ok:boolean}).ok,true);
  assert.equal(fixture.zoeGrants.length,expected,`Zoe decision with due=${due}, withZoe=${withZoe}`);
  if(expected)assert.deepEqual(fixture.zoeGrants[0],['zoe_reads_messages',withZoe,'enrolment']);
 }
 console.log('Mounted profile page/form → actual server action/service: stale demographics rejected, drafts preserved, explicit reload, fresh saves, invalid versions, initial creation and the server-side Zoe re-check pass (mocked auth/storage).');
}finally{
 for(const renderer of mounted)await act(async()=>renderer.unmount());
 hook.deregister();Reflect.deleteProperty(globalThis,'__profileConflict');
}
