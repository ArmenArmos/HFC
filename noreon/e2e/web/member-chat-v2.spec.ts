import { accounts, asPerson, expect, hydrated, open, phone, sql, test } from "../fixtures";

// The new member chat (NOREON_MEMBER_CHAT_V2, /patient/chat) against the real stack. chat-v2.spec.ts covers the
// view alone with a stand-in server; this checks the real thread, the real send and a real second device.
test.skip(process.env.NOREON_E2E_CHAT_V2 !== "true", "Run with NOREON_E2E_CHAT_V2=true: the new chat is behind a switch, and with it on sign-up lands in it.");
const memberId = accounts.chatMember.id;
const stored = (like: string) => sql(`select count(*) from public.conversation_messages m join public.conversations c on c.id=m.conversation_id
  where c.member_id='${memberId}' and m.author_id='${memberId}' and m.body like '${like}'`);

test("new member chat: opens on the newest message, sends to the bottom, and a message from another phone does not move a reader", async ({ browser }) => {
  test.setTimeout(240_000);
  // History is a prerequisite, not the outcome: sixty member messages from days ago (so the send limit is not used up), long enough to need scrolling on a phone.
  sql(`with c as (insert into public.conversations(member_id,version) values('${memberId}',60) returning id)
    insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,created_at)
    select c.id,n,'${memberId}','History message '||n||'. '||repeat('A fictional line to fill the screen. ',3),'authenticated_member',gen_random_uuid(),now()-interval '3 days'+n*interval '1 minute' from c,generate_series(1,60) n`);

  const { page } = await asPerson(browser, "chatMember", phone);
  await open(page, "/patient/chat");
  const thread = page.locator(".cv2-thread");
  const input = page.getByLabel("Your message");
  await hydrated(input);
  const gap = () => thread.evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop));
  const overflow = () => thread.evaluate((el) => el.scrollHeight - el.clientHeight);

  // Open on newest. The overflow check keeps a short, empty page from passing.
  expect(await overflow(), "the history is longer than the screen").toBeGreaterThan(1000);
  await expect(page.getByText("History message 60.")).toBeInViewport();
  await expect(page.getByText("History message 1.", { exact: false }).first()).not.toBeInViewport();
  await expect.poll(gap).toBeLessThan(2);

  // Send: stored once, and the new message is at the bottom, in view.
  await input.fill("First fictional question from the new chat");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => stored("First fictional question%")).toBe("1");
  await expect(page.getByText("First fictional question from the new chat")).toBeInViewport();
  await expect.poll(gap).toBeLessThan(2);

  // A reload opens on the newest message again, with the sent text still there.
  await page.reload();
  await hydrated(page.getByLabel("Your message"));
  await expect(page.getByText("First fictional question from the new chat")).toBeInViewport();
  await expect.poll(gap).toBeLessThan(2);

  // Reading older messages: the person scrolls up on purpose, then the same member writes from a second phone.
  await thread.evaluate((el) => { el.dispatchEvent(new Event("touchstart")); el.scrollTop = 800; });
  await expect.poll(gap).toBeGreaterThan(500);
  const reading = await thread.evaluate((el) => el.scrollTop);
  const { page: other } = await asPerson(browser, "chatMember", phone);
  await open(other, "/patient/chat");
  await hydrated(other.getByLabel("Your message"));
  await other.getByLabel("Your message").fill("Written from the second phone");
  await other.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => stored("Written from the second phone")).toBe("1");

  // The reader's page picks the message up on its next read (up to 30 s) and leaves the reader where they are.
  const arrived = page.getByText("Written from the second phone");
  await expect(arrived).toHaveCount(1, { timeout: 90_000 });
  const pill = page.locator(".cv2-new");
  await expect(pill).toBeVisible();
  expect(Math.abs((await thread.evaluate((el) => el.scrollTop)) - reading), "the reader was not moved").toBeLessThan(2);
  await expect(arrived).not.toBeInViewport();

  // Choosing the new-message pill is the deliberate return.
  await pill.click();
  await expect(arrived).toBeInViewport();
  await expect.poll(gap).toBeLessThan(2);
  await expect(pill).toHaveCount(0);
});
