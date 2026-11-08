/** Catalogue parity and member approval holds. Offline; SQL execution lives beside this file. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {TEST_CATALOGUE} from '@/lib/clinical/seed/tests';
import {testTitle} from '@/lib/patient/catalogue-label';
import {memberJourneyStep,type JourneyInput} from '@/lib/patient/next-step';
import {stepRequestId} from '@/lib/zoe-chat-actions/next-step-id';
import {chatNextStep} from '@/lib/zoe-chat-actions/next-step';
import {journeyStage,STAGE_CLASSES} from '@/lib/patient/journey-stage';

const migration=readdirSync('supabase/migrations').find(f=>f.endsWith('_sample_collected_notice.sql'));
assert.ok(migration,'Collection notice migration exists');
const sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
const names=JSON.parse(sql.match(/from\(select '([\s\S]*?)'::jsonb->p_id as names\)s/)![1].replaceAll("''","'")) as Record<string,Record<'en'|'hy'|'ru',string>>;
assert.deepEqual(names,Object.fromEntries(TEST_CATALOGUE.map(t=>[t.id,t.name])),'SQL labels mirror the card catalogue');
for(const test of TEST_CATALOGUE){
 for(const title of [...Object.values(test.name),'Provider-specific test']){
  for(const locale of ['en','hy','ru'] as const){
   const label=Object.values(names[test.id]).includes(title)?names[test.id][locale]:title;
   assert.equal(label,testTitle({id:test.id,title},locale));
  }
 }
}
const base:JourneyInput={questionnaireComplete:true,review:null,appointments:[],clinics:{},canBook:true,hasOpenRequest:false,lab:null,planPublished:false,now:new Date('2026-11-05T10:00:00Z')};
const released={clinic:'Synthetic clinic',uploadedAt:'2026-11-05T09:00:00Z'};
for(const review of [null,{status:'review_pending' as const}]){
 for(const structured of [false,true]){
  const input={...base,review,...(structured?{lab:'results-received' as const}:{released:[released]})};
  const options={episode:'synthetic',resultsReleased:true,resultsPublishedAt:released.uploadedAt};
  const home=memberJourneyStep(input)!;
  const chat=chatNextStep(input,options);
  assert.equal(home.id,'journey-results');
  assert.notEqual(journeyStage(input,options),'results_released');
  for(const locale of ['en','hy','ru'] as const){
   assert.doesNotMatch(`${home.title[locale]} ${chat.detail[locale]}`,/Your results are ready|has released your results|Ձեր արդյունքները պատրաստ են|Ваши результаты готовы/);
  }
  assert.match(home.detail.en,/after approval/);
  assert.match(chat.detail.en,/approved your plan/);
  assert.notEqual(stepRequestId('synthetic',chat),stepRequestId('synthetic',{...chat,stage:chat.stage.replace(/:plan-approval$/,'')}),'A saved results-waiting card must be replaced so old results-ready promises cannot replay');
 }
}
assert.equal(chatNextStep({...base,planPublished:true},{episode:'synthetic',planId:'p'}).target,'plan');
assert.match(STAGE_CLASSES.results_released.en,/doctor-approved plan/,'Legacy stage copy cannot announce results either');
console.log('Collection notice catalogue parity and member approval holds passed (offline; no SQL execution).');
