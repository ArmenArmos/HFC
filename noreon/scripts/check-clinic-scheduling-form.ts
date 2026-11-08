import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ClinicSchedulingForm} from '@/components/real-review/clinic-scheduling-form';
const id='11111111-1111-4111-8111-111111111111';
for(const locale of ['en','hy'] as const){
 for(const kind of ['clinic','copy'] as const){
  const html=renderToStaticMarkup(createElement(ClinicSchedulingForm,{kind,clinicId:kind==='clinic'?id:undefined,initialEmail:null,revision:0,requestId:id,locale}));
  assert.ok(html.includes('type="email"'));assert.ok(html.includes('name="requestId"'));assert.ok(html.includes('name="expectedRevision"'));
  assert.ok(html.includes(locale==='en'?'Not configured':'Կարգավորված չէ'));
  assert.ok(html.includes(locale==='en'?'does not send':'չի ուղարկում'));
  assert.ok(html.includes(`lang="${locale}"`));
  assert.ok(!html.includes('required=""'),'Empty is an intentional unconfigured value');
 }
 const inactive=renderToStaticMarkup(createElement(ClinicSchedulingForm,{kind:'clinic',clinicId:id,initialEmail:'clinic@example.invalid',revision:1,requestId:id,locale,disabled:true}));
 assert.ok(inactive.includes('disabled=""'));assert.ok(inactive.includes('clinic@example.invalid'));
 assert.ok(inactive.includes(locale==='en'?'Activate this clinic to change its scheduling email.':'Ակտիվացրեք կլինիկան՝ ամրագրման էլփոստը փոխելու համար։'));
 assert.ok(inactive.includes(`aria-describedby="scheduling-email-${id}-inactive"`));
 assert.ok(!inactive.includes(locale==='en'?'Reload settings':'Թարմացնել կարգավորումները'));
}
console.log('EN/HY scheduling forms: named optional mailbox, revision/request, truthful unconfigured/no-send copy and inactive state passed.');
const {ClinicDirectoryList}=await import('@/components/real-review/clinic-directory-list');
for(const locale of ['en','hy'] as const){
 const html=renderToStaticMarkup(createElement(ClinicDirectoryList,{locale,clinics:[{id,name:'Synthetic clinic browser QA',address:'Local isolated fixture',active:true,schedulingEmail:null,schedulingRevision:0}]}));
 assert.ok(html.includes(locale==='en'?'Clinic scheduling email for Synthetic clinic browser QA':'Synthetic clinic browser QA'));
}
