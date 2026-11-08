// Cards under pressure: races, records changed elsewhere, long chats, limits, relink and old buttons.
import { asPerson, desktop, expect, fixtureId, open, sql, test } from "../fixtures";
import { cards, deliver, dueNow, person, pressUpdate, say, sweep, zoeCron, zoeFinished } from "./bot";
import { answers, buttons, cardRows, chatProblems, edits, press, readings, refOf, typeAndSettle, unlinkSql } from "./cards-lib";
import { BOT } from "./config.mjs";

const STALE = "This changed after the card was shown. You can see the current record here in the chat.";
const meds = (id: string, names: string[]) => sql(names.map((n) => `insert into public.member_medicines(user_id,name,dose,times,started_on) values('${id}','${n}','5 mg',${dueNow},current_date-3);`).join("\n"));
const doses = (id: string) => sql(`select coalesce(string_agg(m.name||'='||d.status||':'||d.revision,',' order by m.name),'') from public.member_medicine_doses d join public.member_medicines m on m.id=d.medicine_id where d.user_id='${id}'`);
const logElsewhere = (id: string, name: string, status: string) => sql(`insert into public.member_medicine_doses(medicine_id,user_id,due_at,status) select m.id,m.user_id,public._member_medicine_due((clock_timestamp() at time zone 'Asia/Yerevan')::date,m.times[1]),'${status}' from public.member_medicines m where m.user_id='${id}' and m.name='${name}'`);
async function doseCard(who: Parameters<typeof person>[0]) {
  const m = person(who);
  await typeAndSettle(who, "I took my pill, can you log it");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, "dose card").toBe(1);
  return { m, card: (await cards(m.chat))[0] };
}

test("dose card pressed after the doses were logged elsewhere: nothing is overwritten", async () => {
  const id = person("tgDoseElse").id;
  meds(id, ["Aaa elsewhere skipped", "Bbb elsewhere taken", "Ccc elsewhere taken"]);
  const { m, card } = await doseCard("tgDoseElse");
  logElsewhere(id, "Aaa elsewhere skipped", "skipped");
  logElsewhere(id, "Bbb elsewhere taken", "taken");
  logElsewhere(id, "Ccc elsewhere taken", "taken");
  const before = doses(id);
  const mid = Number(card.result?.message_id);
  const a = await press(m.chat, mid, refOf(card, "1. Mark as taken"));
  const b = await press(m.chat, mid, refOf(card, "2. Mark as missed"));
  const c = await press(m.chat, mid, refOf(card, "3. Mark as taken"));
  expect(await answers(a), "taken over skipped").toEqual([STALE]);
  expect(await answers(b), "missed over taken").toEqual([STALE]);
  expect(await answers(c), "taken over taken is a clean replay").toEqual(["Logged as taken."]);
  expect(doses(id), "nothing overwritten").toBe(before);
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});

test("dose card: taps on three rows and on both answers of one row at once store one status each", async () => {
  const id = person("tgDoseRace").id;
  meds(id, ["Aaa one", "Bbb two", "Ccc three"]);
  const { m, card } = await doseCard("tgDoseRace");
  const mid = Number(card.result?.message_id);
  const ups = [refOf(card, "1. Mark as taken"), refOf(card, "2. Mark as taken"), refOf(card, "3. Mark as taken"), refOf(card, "3. Mark as missed")].map((d) => pressUpdate(m.chat, mid, d));
  await Promise.all(ups.map((u) => deliver(u)));
  await Promise.all([sweep(), sweep(), sweep()]);
  await sweep();
  // The stored doses, not the last edit of the card: which press edits last is a race (QA finding 3, 30 Oct).
  expect(doses(id)).toMatch(/^Aaa one=taken:1,Bbb two=taken:1,Ccc three=(taken|skipped):1$/);
  expect((await Promise.all(ups.map((u) => answers(u)))).flat().length, "every press answered once").toBe(4);
});

test("dose card with 24 long Armenian medicines stays within the limits", async () => {
  const m = person("tgDoseBig");
  const name = (i: number) => `Դեղ ${String(i).padStart(2, "0")} ` + "բ".repeat(100);
  sql(Array.from({ length: 24 }, (_, i) => `insert into public.member_medicines(user_id,name,dose,times,started_on) values('${m.id}','${name(i)}','${"դ".repeat(110)}',${dueNow},current_date-3);`).join("\n"));
  await typeAndSettle("tgDoseBig", "ես ընդունեցի իմ դեղերը, նշիր խնդրեմ");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, "dose card").toBe(1);
  expect(await chatProblems(m.chat, "hy")).toEqual([]);
});

test("BP week: typed reading saved into the due slot; a slot filled elsewhere makes the card stale", async ({ browser }) => {
  // The morning slot is due from its time, and the product keeps that time at 05:00 or later. This local copy drops the
  // check, so a morning slot at 00:00 is due whenever the suite runs.
  sql(`do $$ declare c text; begin for c in select conname from pg_constraint where conrelid='public.bp_weeks'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%time%' loop execute format('alter table public.bp_weeks drop constraint %I',c); end loop; end $$;`);
  sql(`update public.bp_week_settings set enabled=true where singleton`);
  const week = (n: number) => fixtureId(9900 + n);
  const start = (id: string, n: number) => sql(`insert into public.bp_weeks(id,member_id,starts_on,morning_time,evening_time,started_by,started_by_role) values('${week(n)}','${id}',(clock_timestamp() at time zone 'Asia/Yerevan')::date,'00:00','23:59','${id}','member')`);
  const a = person("tgBpWeek"), b = person("tgBpStale");
  start(a.id, 1); start(b.id, 2);
  await typeAndSettle("tgBpWeek", "bp 118/76");
  await typeAndSettle("tgBpStale", "bp 142/91");
  await expect.poll(async () => { await sweep(); return (await cards(a.chat)).length + (await cards(b.chat)).length; }).toBe(2);
  const ca = (await cards(a.chat))[0], cb = (await cards(b.chat))[0];
  expect(ca.body.text).toContain("Your BP week: day 1 of 7, morning reading");
  // b's slot is filled in the app by two readings before the press
  sql(`select public._bp_week_record('${b.id}','${week(2)}','morning',gen_random_uuid(),150,90,null,now()-interval '2 minutes');
       select public._bp_week_record('${b.id}','${week(2)}','morning',gen_random_uuid(),149,91,null,now()-interval '1 minute');`);
  const ua = await press(a.chat, Number(ca.result?.message_id), refOf(ca, "Yes, save it"));
  const ub = await press(b.chat, Number(cb.result?.message_id), refOf(cb, "Yes, save it"));
  expect(await answers(ua)).toEqual(["Saved."]);
  expect(await answers(ub)).toEqual([STALE]);
  const inWeek = (id: string) => sql(`select count(*) from public.bp_week_readings r join public.bp_weeks w on w.id=r.week_id where w.member_id='${id}'`);
  expect(inWeek(a.id)).toBe("1");
  expect(inWeek(b.id)).toBe("2");
  expect(readings(b.id), "the stale press saved nothing").toBe("150/90/-,149/91/-");
  expect((await edits(a.chat)).at(-1)?.body.text).toContain("Saved: 118/76.");
  const { page } = await asPerson(browser, "tgBpWeek", desktop);
  await open(page, "/patient/measurements");
  expect(await page.locator("main").innerText()).toContain("118/76");
  expect(await chatProblems(a.chat, "en")).toEqual([]);
  expect(await chatProblems(b.chat, "en")).toEqual([]);
});

test("BP card after unlink and relink: the old button is refused, nothing is saved", async () => {
  const m = person("tgRelink");
  await typeAndSettle("tgRelink", "my bp is 122/78");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }).toBe(1);
  const card = (await cards(m.chat))[0];
  unlinkSql(m.id);
  // relink the same chat the way the seed does (a new link generation)
  const principal = `["telegram","${BOT.account}",${BOT.id},"user",${m.chat}]`, account = `["${BOT.account}",${BOT.id}]`;
  sql(`select public._telegram_replies_activate('${m.id}',(public._telegram_auth_bind('${m.id}','member','${principal}','${account}',public._auth_phone('${m.id}'),'${m.chat}',null)->>'bindingId')::uuid);`);
  await sweep();
  const u = await press(m.chat, Number(card.result?.message_id), refOf(card, "Yes, save it"));
  expect(readings(m.id)).toBe("");
  expect(await answers(u)).toEqual(["This button no longer works. Write to Zoe here again."]);
});

test("a button older than 48 hours is refused and writes nothing", async () => {
  const m = person("tgExpire");
  await typeAndSettle("tgExpire", "my bp is 119/77");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }).toBe(1);
  const card = (await cards(m.chat))[0];
  sql(`update public.zoe_chat_card_intents set expires_at=now()-interval '1 minute',created_at=now()-interval '49 hours' where member_id='${m.id}'`);
  const u = await press(m.chat, Number(card.result?.message_id), refOf(card, "Yes, save it"));
  expect(await answers(u)).toEqual(["This button no longer works. Write to Zoe here again."]);
  expect(readings(m.id)).toBe("");
  expect((await edits(m.chat)).length).toBe(0);
});

test("/menu and card opens stop at 40 an hour, and a button at the limit says so", async () => {
  const m = person("tgRate");
  for (let i = 0; i < 43; i++) await say(m.chat, "/menu");
  for (let i = 0; i < 6; i++) await sweep();
  expect((await cards(m.chat)).length).toBe(40);
  expect(sql(`select count(*) from public.zoe_chat_cards where member_id='${m.id}'`)).toBe("40");
  // Not asserted: /menu itself is silent at the limit (QA finding 4, 30 Oct).
  const u = await press(m.chat, Number((await cards(m.chat))[0].result?.message_id), buttons((await cards(m.chat))[0])[1].callback_data);
  expect(await answers(u)).toEqual(["You opened many cards in a short time. Wait a few minutes."]);
});

test("a long chat first: 40 messages, then the dose card and a typed reading still arrive once", async () => {
  const m = person("tgLong");
  meds(m.id, ["Aaa long chat"]);
  for (let i = 1; i <= 40; i++) await say(m.chat, `Question number ${i} about cholesterol and food`);
  await zoeFinished(m.id);
  for (let i = 0; i < 4; i++) { await zoeCron(); await sweep(); }
  await typeAndSettle("tgLong", "I took my pill, can you log it");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, "dose card after 40 messages").toBe(1);
  await typeAndSettle("tgLong", "my bp is 126/80");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, "bp card after dose card").toBe(2);
  expect(cardRows(m.id)).toMatch(/^dose:open:\d+,bp:open:\d+$/);
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});

test("sweeps and Zoe's cron at once while a card is offered: one card message", async () => {
  const m = person("tgSweeps");
  await say(m.chat, "my bp is 133/87");
  await Promise.all([zoeCron(), zoeCron(), sweep(), sweep(), sweep(), sweep()]);
  await zoeFinished(m.id);
  await Promise.all([sweep(), sweep(), sweep(), sweep()]);
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).filter((c) => c.body.text!.includes("133/87")).length; }).toBe(1);
  await Promise.all([sweep(), sweep(), sweep(), sweep()]);
  expect((await cards(m.chat)).filter((c) => c.body.text!.includes("133/87")).length).toBe(1);
});
