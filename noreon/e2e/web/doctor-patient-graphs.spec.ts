import {test,expect} from '@playwright/test';
import {startDoctorChatFixture} from '../doctor-chat-v2/server.mjs';
let fixture:Awaited<ReturnType<typeof startDoctorChatFixture>>;
test.beforeAll(async()=>{fixture=await startDoctorChatFixture();});
test.afterAll(async()=>{await fixture?.close();});
test.beforeEach(async({page})=>{await page.route('**/*',async route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fulfill(await fixture.respond(route.request().url())):route.abort());});
for(const [locale,chip,plan] of [['en','At a glance','Plan'],['hy','Մի հայացքով','Պլան'],['ru','Кратко','План']] as const)for(const theme of ['light','dark'])test(`Patient graphs ${locale} ${theme}: phone, desktop and draft previews`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?patient&state=plan-ai-ready&locale=${locale}`);
 if(theme==='dark')await page.locator('html').evaluate(el=>el.setAttribute('data-theme','dark'));
 await page.getByRole('button',{name:chip,exact:true}).click();
 const graphs=page.locator('[data-patient-graphs]');await expect(graphs).toBeVisible();
 await expect(graphs.locator('[data-trend]')).toHaveCount(7);
 const bp=graphs.locator('[data-trend="bp"]');await bp.locator('button').click();
 await expect(bp.getByRole('table')).toBeVisible();await expect(bp.getByRole('table')).toContainText('155/96');
 await expect(bp.getByRole('table')).toContainText(locale==='en'?'not verified':locale==='hy'?'չստուգված':'не проверено');
 await expect(bp.locator('polyline')).toHaveCount(2);
 await bp.scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/slice2c-${locale}-${theme}-390.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1280,height:900});await bp.scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/slice2c-${locale}-${theme}-desktop.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:plan,exact:true}).click();
 const previews=page.locator('[data-plan-sparklines]');await expect(previews).toBeVisible();
 await previews.locator('[data-trend="ldl"] button').click();await expect(previews.getByRole('table')).toBeVisible();
 await page.setViewportSize({width:390,height:844});await previews.scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/slice2c-plan-${locale}-${theme}-390.png`,fullPage:true});
});
for(const state of ['graphs-empty','graphs-one','graphs-unavailable'])test(`Patient graphs ${state}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(fixture.url+`/staff/real/doctor-chat-v2?patient&state=${state}`);
 await page.getByRole('button',{name:'At a glance',exact:true}).click();
 if(state==='graphs-unavailable')await expect(page.getByText('Graphs could not be read. Try At a glance again.',{exact:true})).toBeVisible();
 else if(state==='graphs-empty')await expect(page.locator('[data-patient-graphs]').getByText('Needs 2 readings in the last 2 weeks',{exact:true})).toHaveCount(2);
 else {const bp=page.locator('[data-patient-graphs] [data-trend="bp"]');await bp.locator('button').click();await expect(bp.getByRole('table')).toContainText('138/86');await expect(bp.locator('polyline')).toHaveCount(0);}
});

for(const [locale,label] of [['en','From your notification'],['hy','Ձեր ծանուցումից'],['ru','Из вашего уведомления']] as const)test(`Notification source card ${locale}: phone and desktop`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?patient&state=notice-focus&locale=${locale}&alert=a1a00000-0000-4000-8000-000000000001`);
 const card=page.locator('article[aria-current="true"]');
 await expect(card).toBeVisible();await expect(card).toContainText(label);
 await expect(card).toHaveCSS('outline-style','solid');
 expect(await page.locator('textarea').evaluate(el=>el===document.activeElement)).toBe(false);
 await page.screenshot({path:`/tmp/alert-focus-${locale}-390.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1280,height:900});await expect(card).toBeVisible();
 await page.screenshot({path:`/tmp/alert-focus-${locale}-desktop.png`});
 await card.getByRole('button',{name:{en:'Acknowledge',hy:'Հաստատել',ru:'Подтвердить'}[locale],exact:true}).click();
 await expect(page.locator('article[aria-current="true"]')).toHaveCount(0);
});
