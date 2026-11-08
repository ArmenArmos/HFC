import {test,expect,type Page} from '@playwright/test';
import {startChatFixture} from '../chat-v2/server.mjs';
import {NEXT_STEP} from '../../lib/zoe-chat-actions/next-step-copy';
import type {AssessmentDraft} from '../../lib/patient/types';

// Real chat/anamnesis/cards and production next-step rule. Registration, persistence,
// staff/provider events and action IO are synthetic; this is not a hosted or SQL check.
let fixture:Awaited<ReturnType<typeof startChatFixture>>;
test.beforeAll(async()=>{fixture=await startChatFixture();});
test.afterAll(async()=>{await fixture?.close();});
test.beforeEach(async({page})=>{await page.route('**/*',route=>new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.fulfill(fixture.respond(route.request().url(),route.request().method(),route.request().postData()??'')));});
const read=()=>JSON.parse(fixture.respond(fixture.url+'/fixture/journey-state').body);
const card=(page:Page,kind:string)=>page.locator(`[data-zoe-card="${kind}"]`);
const stage=async(page:Page,value:string)=>{fixture.respond(fixture.url+'/fixture/journey-stage','POST',JSON.stringify({stage:value}));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));};
const keep=async(page:Page)=>{await page.evaluate(()=>{const u=new URL(location.href);u.searchParams.set('keep','');history.replaceState(null,'',u);});await page.reload();};
function registration(){
 const values={'q1.age':40,'q1.sex':'female','q2.weight_perception':'ok','q2.height':165,'q2.weight':60,'q2.waist':'unknown','q2.activity':'sedentary','q2.diet':['none'],'q3.status':'never','q4.frequency':'never','q5.diagnosed':'no','q5.last_reading.systolic':120,'q5.last_reading.diastolic':80,'q6.conditions':['none'],'q7.relatives':['none'],'q8.sleep_quality':8,'q8.sleep_hours':7,'q8.stress':'no','q9.present':'no'};
 const assessment:AssessmentDraft={id:'00000000-0000-4000-8000-000000001001',revision:0,assessmentDate:'2026-11-01',completedAt:null,urgentRule:null,answers:Object.fromEntries(Object.entries(values).map(([fieldId,value])=>[fieldId,{fieldId,value,source:'manual',answeredAt:'2026-11-01T12:00:00Z'}]))};
 fixture.respond(fixture.url+'/fixture/assessment','POST',JSON.stringify(assessment));
}
for(const width of [402,1280])test(`saved journey stages stay in the chat at ${width}px`,async({page})=>{
 registration();await page.setViewportSize({width,height:800});
 await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer&anamnesis&journey');
 await page.locator('[data-question-id="q10.symptoms"]').getByRole('button',{name:'No',exact:true}).click();
 await expect(card(page,'next_step')).toBeVisible();
 await expect(card(page,'next_step').locator('[data-next-step-target]')).toHaveAttribute('data-next-step-target','tests_needed');
 await keep(page);await expect(card(page,'next_step')).toBeVisible();
 await card(page,'next_step').getByRole('button').click();
 await expect(card(page,'visit')).toBeVisible();
 expect(read().adminTasks).toEqual([expect.objectContaining({queue:'admin',reason:'missing_baseline_labs',summary:{}})]);
 await expect(card(page,'tests_needed')).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(card(page,'next_step')).toHaveCount(0);
 for(const [phase,target]of [['booking_confirmed','visit'],['lab_done','results'],['results_waiting','results'],['results_released','results'],['plan_published','plan']]){
  await stage(page,phase);await expect(card(page,'next_step').locator('[data-next-step-target]')).toHaveAttribute('data-next-step-target',target);
  expect(read().cards.cards.filter((c:{kind:string;state:string})=>c.kind==='next_step'&&c.state==='open')).toHaveLength(1);
  const id=await card(page,'next_step').getAttribute('data-chat-card-id');
  await keep(page);await expect(card(page,'next_step')).toHaveAttribute('data-chat-card-id',id!);
  await card(page,'next_step').getByRole('button').click();await expect(card(page,target)).toBeVisible();
  if(phase==='results_waiting'){await expect(card(page,'results')).not.toContainText('2.2');await expect(card(page,'results')).toContainText(NEXT_STEP.waitingResults.en);}
  if(phase==='results_released')await expect(card(page,'results')).toContainText('2.2');
 }
 // Main's saved teach-back finishes the continuation too. The IO remains synthetic.
 await card(page,'plan').locator('[data-confirm-plan]').click();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(card(page,'next_step')).toContainText(NEXT_STEP.confirmed.en);
 await expect(card(page,'next_step').locator('[data-next-step-target]')).toHaveCount(0);
 await keep(page);
 await expect(card(page,'next_step')).toContainText(NEXT_STEP.confirmed.en);
 expect(read().phase).toBe('teach_back');
});

test('failed read and failed open show words and recover without duplicate cards',async({page})=>{
 registration();await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer&anamnesis&journey');
 await page.locator('[data-question-id="q10.symptoms"]').getByRole('button',{name:'No',exact:true}).click();
 await expect(card(page,'next_step')).toBeVisible();
 await stage(page,'read_failed');await expect(page.locator('[data-next-step-status=unavailable]')).toContainText(NEXT_STEP.unavailable.en);
 await stage(page,'fail_follow');await card(page,'next_step').getByRole('button').click();
 await expect(card(page,'next_step').getByRole('alert')).toContainText(NEXT_STEP.failure.en);
 await card(page,'next_step').getByRole('button',{name:NEXT_STEP.retry.en,exact:true}).click();await expect(card(page,'visit')).toBeVisible();
 await keep(page);expect(read().cards.cards.filter((c:{kind:string})=>c.kind==='visit')).toHaveLength(1);
});
test('switch off keeps the existing questionnaire completion',async({page})=>{
 registration();await page.goto(fixture.url+'/patient/chat?empty&anamnesis&journey');
 await page.locator('[data-question-id="q10.symptoms"]').getByRole('button',{name:'No',exact:true}).click();
 await expect(page.getByText('Your questionnaire is complete.',{exact:true})).toBeVisible();
 await expect(card(page,'next_step')).toHaveCount(0);await expect(card(page,'tests_needed')).toHaveCount(0);
});

for(const width of [402,1280])test(`Armenian recovery opens the care-team card at ${width}px`,async({page})=>{
 registration();await page.setViewportSize({width,height:800});
 await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer&anamnesis&journey&locale=hy');
 await page.locator('[data-question-id="q10.symptoms"]').getByRole('button',{name:'Ոչ',exact:true}).click();
 await expect(card(page,'next_step')).toBeVisible();
 await stage(page,'fail_follow');await card(page,'next_step').getByRole('button').click();
 await expect(card(page,'next_step').getByRole('button',{name:'Փորձել նորից',exact:true})).toBeVisible();
 await expect(card(page,'next_step').getByRole('alert')).not.toContainText(NEXT_STEP.unavailable.hy);
 await expect(page.getByText(NEXT_STEP.saved.hy,{exact:true})).toHaveCount(0);
 await card(page,'next_step').getByRole('button',{name:NEXT_STEP.careTeam.hy,exact:true}).click();
 await expect(card(page,'message')).toBeVisible();
 await card(page,'next_step').getByRole('button',{name:'Փորձել նորից',exact:true}).click();
 await expect(card(page,'visit')).toBeVisible();
 const id=await card(page,'visit').getAttribute('data-chat-card-id');
 await keep(page);await expect(card(page,'visit')).toHaveAttribute('data-chat-card-id',id!);
 expect(read().adminTasks).toHaveLength(1);
});
