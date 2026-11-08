import { test, expect } from '@playwright/test';
import { startPracticeFixture } from '../zoe-practice/server.mjs';

// Actual view and pipeline; only model transport, authentication and persistence are stand-ins.
let fixture: Awaited<ReturnType<typeof startPracticeFixture>>;
test.use({ viewport: { width:402, height:714 }, isMobile:true, hasTouch:true });
test.beforeAll(async () => { fixture = await startPracticeFixture(); });
test.afterAll(async () => { await fixture?.close(); });
test.beforeEach(async ({page}) => {
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') return route.abort();
    return route.fulfill(await fixture.respond(route.request().url(), route.request().method(), route.request().postData() ?? ''));
  });
});
const send = async (page: import('@playwright/test').Page, text:string) => {
  await page.getByRole('textbox', {name:'Your message'}).fill(text);
  await page.getByRole('button', {name:'Send',exact:true}).click();
  await expect(page.getByRole('textbox', {name:'Your message'})).toHaveValue('');
};
test('choose, converse with history, edit record, mark both ways and retry a failed save', async ({page}) => {
  await page.goto(fixture.url+'/staff/real/zoe-practice');
  await page.getByRole('button',{name:/Alex \(fictional\)/}).click();
  await send(page,'Can we discuss my cholesterol?');
  await expect(page.locator('[data-practice-reply]')).toHaveCount(1);
  await send(page,'And my next test?');
  await expect(page.locator('[data-practice-reply]')).toHaveCount(2);
  expect(fixture.jobs.at(-1).messages.some((m:{text:string})=>m.text==='Can we discuss my cholesterol?')).toBe(true);
  expect(fixture.jobs.at(-1).answers.length).toBeGreaterThan(0);
  await page.getByRole('button',{name:'What Zoe saw',exact:true}).last().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Change the record',exact:true}).click();
  await page.getByLabel('LDL (mmol/L)').fill('3,7');
  await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/Record changed/)).toBeVisible();
  await send(page,'What does the updated LDL mean?');
  expect(fixture.jobs.at(-1).memberRecord.ldl.latest.mmol).toBe(3.7);
  await page.locator('[data-practice-reply]').first().getByRole('button',{name:'Good',exact:true}).click();
  await expect(page.locator('[data-practice-reply]').first().getByRole('status')).toHaveText('Saved: good');
  await page.locator('[data-practice-reply]').last().getByRole('button',{name:'Wrong',exact:true}).click();
  await page.getByLabel('Reason').selectOption('wrong_fact');
  await page.getByLabel('What Zoe should have said').fill('Use the updated LDL result and the medicine already in the record.');
  fixture.failNextMark();
  await page.getByRole('button',{name:'Save correction',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry save',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Retry save',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-practice-reply]').last().getByRole('status')).toHaveText('Saved: wrong');
  expect(fixture.marks.at(-1).correction).toContain('updated LDL');
  expect(await page.locator('a[href]').count()).toBe(0);
  await page.screenshot({path:'/tmp/zoe-practice-phone.png'});
});
test('turn limit refuses a call and reset returns the fictional record to its start', async ({page}) => {
  await page.goto(fixture.url+'/staff/real/zoe-practice');
  await page.getByRole('button',{name:/Alex \(fictional\)/}).click();
  fixture.reachLimit();
  await page.getByRole('textbox',{name:'Your message'}).fill('May I ask a question?');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:/daily practice limit/})).toBeVisible();
  expect(fixture.jobs).toHaveLength(0);
  await page.getByRole('button',{name:'Reset conversation',exact:true}).click();
  await page.getByRole('button',{name:'Reset to the start',exact:true}).click();
  await expect(page.locator('[data-practice-reply]')).toHaveCount(0);
  expect(await page.locator('a[href]').count()).toBe(0);
});

test('lost send response reconciles the committed reply and the next turn succeeds', async ({page})=>{
 await page.goto(fixture.url+'/staff/real/zoe-practice');
 await page.getByRole('button',{name:/Alex \(fictional\)/}).click();
 fixture.loseNextSendResponse();
 const field=page.getByRole('textbox',{name:'Your message'});
 await field.fill('Can we look at my cholesterol?');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(field).toHaveValue('Can we look at my cholesterol?');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('[data-practice-reply]')).toHaveCount(1);
 await expect(field).toHaveValue('');
 expect(fixture.jobs).toHaveLength(1);
 await send(page,'What should I ask at my next appointment?');
 await expect(page.locator('[data-practice-reply]')).toHaveCount(2);
 expect(fixture.jobs).toHaveLength(2);
});
