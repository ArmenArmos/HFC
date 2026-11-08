import {test,expect} from '@playwright/test';
import {startDoctorChatFixture} from '../doctor-chat-v2/server.mjs';
let fixture:Awaited<ReturnType<typeof startDoctorChatFixture>>;
test.beforeAll(async()=>{fixture=await startDoctorChatFixture();});
test.afterAll(async()=>{await fixture.close();});
test.beforeEach(async({page})=>{await page.route('**/*',async route=>{const result=await fixture.respond(route.request().url());await route.fulfill(result);});});
for(const locale of ['en','hy','ru'] as const)test(`Plan lab links: two files in the header and checklist in ${locale}`,async({page})=>{
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=plan-ready-lab-links&locale=${locale}&history=long`);
 const card=page.locator('[data-plan-ready]'),header=card.locator('[data-slot="card-header"]');
 const label=locale==='en'?'Open the lab file':locale==='hy'?'Բացել լաբորատոր ֆայլը':'Открыть файл анализов';
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:900});
  for(const region of [header,card.locator('[data-check="values"]'),card.locator('[data-check="results"]')]){
   const links=region.getByRole('link',{name:new RegExp(label)});
   await expect(links).toHaveCount(2);
   await expect(links.first()).toHaveAttribute('href',/\/documents\/d6a00000-0000-4000-8000-000000000004\/check$/);
   await expect(links.last()).toHaveAttribute('href',/\/documents\/d6a00000-0000-4000-8000-000000000006\/check$/);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/tmp/plan-lab-links-${locale}-${width}.png`,fullPage:true});
 }
 await header.getByRole('link',{name:new RegExp(label)}).last().click();
 await expect(page).toHaveURL(/\/documents\/d6a00000-0000-4000-8000-000000000006\/check$/);
});
for(const locale of ['en','hy','ru'] as const)test(`Plan ready: five explicit presses, editable pre-fills in ${locale}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=plan-ready&locale=${locale}`);
 const card=page.locator('[data-plan-ready]');
 const next=card.locator('button.w-full');
 await expect(card).toBeVisible();
 await page.screenshot({path:`/tmp/plan-ready-${locale}-mobile.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:`/tmp/plan-ready-${locale}-desktop.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('textarea[name="instructions"]').fill('Doctor edited these instructions.');
 // The note and proposal are editable pre-fills; no typing is necessary on the default path.
 const notes=card.locator('textarea');
 await expect(notes.last()).toHaveValue(/Thyroid.pdf/);
 await notes.last().fill('Doctor edited receipt note.');
 await notes.first().fill('Doctor edited consultation reason.');
 await card.locator('select').selectOption('required');
 await card.locator('select').selectOption('not-required');
 let presses=0;
 for(const expected of locale==='en'?['Accept prepared fields','Record matched results','Save consultation decision','Use this draft','Approve and publish']:locale==='hy'?['Ընդունել պատրաստված դաշտերը','Գրանցել համապատասխան արդյունքները','Պահպանել խորհրդատվության որոշումը','Օգտագործել այս սևագիրը','Հաստատել և հրապարակել']:['Принять подготовленные поля','Записать совпавшие результаты','Сохранить решение о консультации','Использовать этот черновик','Утвердить и опубликовать']){
  await expect(next).toHaveText(expected);await expect(next).toBeEnabled();await next.click();presses++;
 }
 await expect(card).toHaveCount(0);
 expect(presses).toBeLessThanOrEqual(5);
 const state=await page.evaluate(()=> (window as unknown as {fixture:{aiPlanSaves:Record<string,string>[];readyReceiptCalls:Record<string,string>[];planCommands:{kind:string;note?:string}[]}}).fixture);
 expect(state.aiPlanSaves).toHaveLength(2);
 expect(state.aiPlanSaves[0].instructions).toBe('Doctor edited these instructions.');
 expect(state.readyReceiptCalls).toHaveLength(1);expect(state.readyReceiptCalls[0].note).toBe('Doctor edited receipt note.');
 expect(state.planCommands.map(command=>command.kind)).toEqual(['consultation-decision','regimen']);
 expect(state.planCommands[0].note).toBe('Doctor edited consultation reason.');
});
test('Plan ready: no reviewed covering file never offers recording or publication',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=plan-ready-missing');
 const card=page.locator('[data-plan-ready]');await expect(card).toBeVisible();
 await expect(card).toContainText('Not read from any file');
 await expect(card.getByRole('button',{name:'Record all matched results',exact:true})).toHaveCount(0);
 await expect(card.getByRole('button',{name:'Approve and publish',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=> (window as unknown as {fixture:{readyReceiptCalls?:unknown[]}}).fixture.readyReceiptCalls??[])).toEqual([]);
});
for(const disposition of ['rejected','edited'] as const)test(`Plan ready: ${disposition} follow-up stays truthful after saving`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=plan-ready');
 const card=page.locator('[data-plan-ready]'),fields=card.locator('[data-check="fields"]');
 const followUp=page.locator('textarea[name="followUp"]');
 if(disposition==='rejected')await followUp.locator('../..').getByRole('button',{name:'Reject',exact:true}).click();
 else await followUp.fill('Doctor edited follow-up');
 await expect(fields).toContainText(`1 ${disposition}`);
 await expect(fields).toHaveAttribute('data-state',disposition==='edited'?'green':'amber');
 await page.screenshot({path:`/tmp/plan-ready-${disposition}-mobile.png`,fullPage:true});
 await card.locator('button.w-full').click();
 await expect(card.locator('button.w-full')).toHaveText('Record matched results');
 await expect(fields).toContainText(`1 ${disposition}`);
 const saves=await page.evaluate(()=> (window as unknown as {fixture:{aiPlanSaves:Record<string,string>[]}}).fixture.aiPlanSaves);
 expect(saves[0].followUp).toBe(disposition==='rejected'?'':'Doctor edited follow-up');
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:`/tmp/plan-ready-${disposition}-desktop.png`,fullPage:true});
});
for(const disposition of ['rejected','edited'] as const)for(const keep of [false,true])test(`Plan ready: ${disposition} then ${keep?'keep edits':'use new saved text'}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=plan-ready');
 const card=page.locator('[data-plan-ready]'),fields=card.locator('[data-check="fields"]');
 const followUp=page.locator('textarea[name="followUp"]');
 if(disposition==='rejected')await followUp.locator('../..').getByRole('button',{name:'Reject',exact:true}).click();
 else await followUp.fill('Doctor edited follow-up');
 await expect(fields).toContainText(`1 ${disposition}`);
 await page.evaluate(()=>{
  const f=(window as unknown as {fixture:import('../doctor-chat-v2/actions').PlanFixture&import('../doctor-chat-v2/actions').PlanReadyFixture}).fixture;
  f.aiPlanSavedDraft={explanation:'New saved explanation',instructions:'New saved instructions',followUp:'New saved follow-up',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[],medicines:[]};
  f.readyRevision=(f.readyRevision??4)+1;
  document.dispatchEvent(new Event('noreon:clinical-evidence-changed'));
 });
 const conflict=page.getByRole('region',{name:'Draft conflict'});
 await expect(conflict).toBeVisible();
 await conflict.getByRole('button',{name:keep?'I reviewed the changes, keep my edits':'Use the new text',exact:true}).click();
 const expected=keep?(disposition==='rejected'?'':'Doctor edited follow-up'):'New saved follow-up';
 await expect(followUp).toHaveValue(expected);
 if(keep)await expect(fields).toContainText(`1 ${disposition}`);
 else {await expect(fields).toContainText('3 edited');await expect(fields).not.toContainText('rejected');await expect(fields).not.toContainText('All accepted');}
 await followUp.scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/plan-ready-reload-${disposition}-${keep}-mobile.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Use this draft',exact:true}).last().click();
 await expect.poll(()=>page.evaluate(()=> (window as unknown as {fixture:{aiPlanSaves:Record<string,string>[]}}).fixture.aiPlanSaves.at(-1)?.followUp)).toBe(expected);
 if(keep&&disposition==='rejected')await expect(fields).toContainText('1 rejected (they will not be saved)');
 else await expect(fields).not.toContainText('rejected (they will not be saved)');
 await page.setViewportSize({width:1280,height:900});
 await fields.scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/plan-ready-reload-${disposition}-${keep}-desktop.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const locale of ['en','hy','ru'] as const)test(`Plan ready: missing consultation sentence requires a doctor reason in ${locale}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=plan-ready-no-consultation&locale=${locale}`);
 const card=page.locator('[data-plan-ready]'),next=card.locator('button.w-full');
 await expect(card.locator('select')).toHaveValue('');
 await expect(card.locator('textarea')).toHaveValue('');
 await next.click();
 await expect(next).toHaveText(locale==='en'?'Save consultation decision':locale==='hy'?'Պահպանել խորհրդատվության որոշումը':'Сохранить решение о консультации');
 await card.locator('select').selectOption('not-required');
 await expect(next).toBeDisabled();
 await page.screenshot({path:`/tmp/plan-ready-no-reason-${locale}-mobile.png`,fullPage:true});
 await card.locator('textarea').fill('Doctor-entered clinical reason');
 await expect(next).toBeEnabled();
 await next.click();
 await expect(next).toHaveText(locale==='en'?'Use this draft':locale==='hy'?'Օգտագործել այս սևագիրը':'Использовать этот черновик');
 const commands=await page.evaluate(()=> (window as unknown as {fixture:{planCommands:{note?:string}[]}}).fixture.planCommands);
 expect(commands[0].note).toBe('Doctor-entered clinical reason');
});

for(const width of [390,1280])test(`Plan ready: reject, load empty, type and save at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=plan-ready');
 const card=page.locator('[data-plan-ready]'),fields=card.locator('[data-check="fields"]');
 const followUp=page.locator('textarea[name="followUp"]');
 await followUp.locator('../..').getByRole('button',{name:'Reject',exact:true}).click();
 await page.evaluate(()=>{
  const f=(window as unknown as {fixture:import('../doctor-chat-v2/actions').PlanFixture&import('../doctor-chat-v2/actions').PlanReadyFixture}).fixture;
  f.aiPlanSavedDraft={explanation:'New saved explanation',instructions:'New saved instructions',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[],medicines:[]};
  f.readyRevision=(f.readyRevision??4)+1;
  document.dispatchEvent(new Event('noreon:clinical-evidence-changed'));
 });
 await page.getByRole('region',{name:'Draft conflict'}).getByRole('button',{name:'Use the new text',exact:true}).click();
 await expect(followUp).toHaveValue('');
 await expect(fields).toContainText('1 rejected (they will not be saved)');
 await followUp.fill('Doctor follow-up after empty reload');
 await expect(fields).toContainText('3 edited');
 await expect(fields).not.toContainText('rejected');
 await expect(fields).not.toContainText('All accepted');
 await page.getByRole('button',{name:'Use this draft',exact:true}).last().click();
 await expect.poll(()=>page.evaluate(()=> (window as unknown as {fixture:{aiPlanSaves:Record<string,string>[]}}).fixture.aiPlanSaves.at(-1)?.followUp)).toBe('Doctor follow-up after empty reload');
 await expect(fields).toContainText('3 edited');
 await fields.scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/plan-ready-fix3-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const locale of ['en','hy','ru'] as const)for(const width of [390,1280])test(`Consultation proposal: one explicit save in ${locale} at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=plan-ready-proposal&locale=${locale}`);
 const card=page.locator('[data-plan-ready]'),next=card.locator('button.w-full');
 const save=locale==='en'?'Save consultation decision':locale==='hy'?'Պահպանել խորհրդատվության որոշումը':'Сохранить решение о консультации';
 const label=locale==='en'?"Zoe's proposal":locale==='hy'?'Զոյայի առաջարկը':'Предложение Зои';
 await expect(next).toBeEnabled();await next.click(); // Accept the prepared draft.
 await expect(card.locator('select')).toHaveValue('not-required');
 await expect(card.locator('fieldset textarea')).toHaveValue('No consultation is needed.');
 await next.click(); // Record the matched evidence.
 await expect(next).toHaveText(save);
 await expect(card).toContainText(label);
 const commands=()=>page.evaluate(()=> (window as unknown as {fixture:{planCommands:unknown[]}}).fixture.planCommands);
 expect(await commands()).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/consultation-proposal-${locale}-${width}.png`,fullPage:true});
 await next.click();
 expect(await commands()).toEqual([expect.objectContaining({kind:'consultation-decision',decision:'not-required',note:'No consultation is needed.'})]);
});
