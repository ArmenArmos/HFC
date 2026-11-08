import {test,expect} from '@playwright/test';
import {startChatFixture} from '../chat-v2/server.mjs';
import {LAB_VISIT} from '../../lib/zoe-chat-actions/lab-visit-copy';
import {LIVING_VISIT,VISIT_STEPS} from '../../lib/zoe-chat-actions/living-visit';
let fixture:Awaited<ReturnType<typeof startChatFixture>>;
test.beforeAll(async()=>{fixture=await startChatFixture();});
test.afterAll(async()=>{await fixture?.close();});
test.beforeEach(async({page})=>{await page.route('**/*',route=>new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.fulfill(fixture.respond(route.request().url(),route.request().method(),route.request().postData()??'')));});
for(const locale of ['hy','ru','en']as const)for(const width of [390,1280])test(`one living card, transitions and menu focus ${locale} ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.goto(`${fixture.url}/patient/chat?v3&onboarding&no-offer&living-visit&locale=${locale}`);
 const card=page.locator('[data-chat-card-id="00000000-0000-4000-8000-00000000b001"]');
 await expect(card).toHaveCount(1);
 for(const status of VISIT_STEPS){
  fixture.respond(fixture.url+'/fixture/living-status','POST',JSON.stringify({status}));
  fixture.respond(fixture.url+'/fixture/living-status','POST',JSON.stringify({status}));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(card).toHaveAttribute('data-state',status);
  await expect(card.locator('[aria-current="step"]')).toHaveText(new RegExp(LIVING_VISIT[status][locale]));
  await expect(card).toHaveCount(1);
 }
 for(let tap=0;tap<2;tap++){
  await page.locator('.cv2-avatar').click();
  await page.locator('[data-menu-visit]').click();
  await expect(card).toBeInViewport();
  await expect(card).toHaveAttribute('data-card-highlight','true');
 }
 await expect(page.locator('[data-zoe-card="visit"]')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/living-visit-${test.info().project.name}-${locale}-${width}.png`});
});

for(const locale of ['hy','ru','en']as const)for(const width of [390,1280])test(`confirm a living proposal ${locale} ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.goto(`${fixture.url}/patient/chat?v3&onboarding&no-offer&living-visit&living-proposal&locale=${locale}`);
 const card=page.locator('[data-chat-card-id="00000000-0000-4000-8000-00000000b001"]');
 await expect(card).toHaveAttribute('data-state','awaiting');
 await expect(card).toContainText('Synthetic clinic');
 await card.getByRole('button',{name:LAB_VISIT.confirm[locale],exact:true}).click();
 await expect(card).toHaveAttribute('data-state','confirmed');
 await expect(card).toContainText(LIVING_VISIT.confirmed[locale]);
 await expect(card.getByRole('button',{name:LAB_VISIT.confirm[locale],exact:true})).toHaveCount(0);
 await expect(page.locator('[data-zoe-card="visit"]')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // A new clinic proposal updates the same done card and remains actionable.
 const proposalB={appointmentId:'00000000-0000-4000-8000-00000000b001',proposalId:'00000000-0000-4000-8000-00000000b003',startsAt:'2026-11-09T10:00:00Z',endsAt:'2026-11-09T11:00:00Z',clinicName:'Synthetic clinic B',clinicAddress:'Synthetic address B'};
 fixture.respond(fixture.url+'/fixture/living-proposal','POST',JSON.stringify(proposalB));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(card).toContainText(proposalB.clinicName);
 await expect(card.getByRole('button',{name:LAB_VISIT.confirm[locale],exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/living-proposal-${test.info().project.name}-${locale}-${width}.png`});
 await card.getByRole('button',{name:LAB_VISIT.confirm[locale],exact:true}).click();
 await expect(card).toHaveAttribute('data-state','confirmed');
 await expect(card.getByRole('button',{name:LAB_VISIT.confirm[locale],exact:true})).toHaveCount(0);
 await expect(page.locator('[data-zoe-card="visit"]')).toHaveCount(1);
});
