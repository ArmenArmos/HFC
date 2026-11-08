import { accounts, asPerson, expect, openZoe, phone, sql, test } from "../fixtures";

const id = accounts.zoeEn.id;
const clear = () => sql(`delete from public.zoe_chat_cards where member_id='${id}'; set session_replication_role=replica; delete from public.member_reported_documents where user_id='${id}'; set session_replication_role=origin;`);
test.afterEach(clear);

test("a message on its way can be read, and a failed one keeps its text and retry", async ({ browser }) => {
  clear();
  const { page } = await asPerson(browser, "zoeEn", phone);
  await openZoe(page);
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/patient/zoe", async route => { if (route.request().method() !== "POST") return route.continue(); await held; await route.abort(); });
  await page.locator("#zoe-chat-message").fill("Is this still on its way");
  await page.locator('button[type="submit"]').click();
  const pending = page.locator('[data-zoe-bubble="pending"][data-state="sending"] > div');
  await expect(pending).toContainText("Is this still on its way");
  const paint = await pending.evaluate(el => { const c = getComputedStyle(el); return [c.color, c.backgroundColor]; });
  expect(paint[0]).not.toBe(paint[1]);
  release();
  const failed = page.locator('[data-zoe-bubble="pending"][data-state="failed"]');
  await expect(failed).toContainText("Is this still on its way");
  await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
  const lost = await failed.locator("> div").evaluate(el => { const c = getComputedStyle(el); return [c.color, c.backgroundColor]; });
  expect(lost[0]).not.toBe(lost[1]);
});

test("a stored member message is readable once the send settles and after a reload", async ({ browser }) => {
  clear();
  const { page } = await asPerson(browser, "zoeEn", phone);
  await openZoe(page);
  const text = `Can you read this ${Date.now()}`;
  await page.locator("#zoe-chat-message").fill(text);
  await page.locator('button[type="submit"]').last().click();
  const stored = page.locator('[data-zoe-bubble="member"] > div', { hasText: text });
  const expectReadable = async () => {
    await expect(stored).toBeVisible();
    await expect(page.locator('[data-zoe-bubble="pending"]', { hasText: text })).toHaveCount(0);
    const [ink, ground] = await stored.locator("p").first().evaluate(el => [getComputedStyle(el).color, getComputedStyle(el.parentElement!).backgroundColor]);
    expect(ink).not.toBe(ground);
  };
  await expectReadable();
  await page.reload();
  await expectReadable();
});

test("phone: chat buttons are 48 px, BP boxes hold a reading, and a file attaches from the chat", async ({ browser }) => {
  clear();
  const { page } = await asPerson(browser, "zoeEn", phone);
  await openZoe(page);
  for (const control of [page.locator('[data-zoe-card-chip="bp"]'), page.locator("[data-zoe-attach]"), page.locator('button[type="submit"]').last()])
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.locator('[data-zoe-card-chip="bp"]').click();
  const box = (await page.locator('[data-zoe-card="bp"] input[id$="-systolic"]').last().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(80);
  expect(box.height).toBeGreaterThanOrEqual(48);
  await page.locator("[data-zoe-attach-input]").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 fictional") });
  await expect(page.locator('[data-zoe-attach-status="saved"]')).toBeVisible();
  // The line sits under the box, so the member can still read what they type.
  expect((await page.locator("#zoe-chat-message").boundingBox())!.width).toBeGreaterThanOrEqual(180);
  expect(sql(`select count(*) from public.member_reported_documents where user_id='${id}'`)).toBe("1");
  await page.locator("[data-zoe-attach-input]").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ not a pdf") });
  await expect(page.locator('[data-zoe-attach-status="invalid"]')).toBeVisible();
  expect(sql(`select count(*) from public.member_reported_documents where user_id='${id}'`)).toBe("1");
});
