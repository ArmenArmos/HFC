import type { BrowserContext, Page, Response, Route } from "@playwright/test";
import { expect, test, accounts, asPerson, hydrated, open, openZoe, phone, sql } from "../fixtures";

// A member's phone on a bad day (phone tests of 30 Oct, BC-02 to BC-05, BC-12, chat-cards 6). Nothing here waits for time
// to pass: a stale tab is decided by the responses it got, and a hung request by a clock moved past its deadline.

const refused = (r: Response) => r.status() === 409 && !!r.headers()["x-noreon-account-changed"];
/** Every answer to a member page or route that reached this tab's scripts from now on. */
function memberAnswers(page: Page) {
  const seen: string[] = [];
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (/^\/(api\/)?patient(\/|$)/.test(path) && r.request().resourceType() === "fetch") seen.push(`${r.status()} ${path}`);
  });
  return seen;
}
/** Another member signs in on the same browser: the session cookie is replaced under the open page. */
async function signInOver(context: BrowserContext, session: Awaited<ReturnType<BrowserContext["cookies"]>>) {
  await context.addCookies(session);
}
const sessionOf = async (browser: Parameters<typeof asPerson>[0], who: string) => {
  const other = await asPerson(browser, who);
  const cookies = await other.context.cookies();
  await other.context.close();
  return cookies;
};
const softNavigate = (page: Page, href: string) => page.evaluate((to) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(to), href);

/** React props on a link do not establish AccountBinding's layout effect. Observe its actual outgoing header. */
async function waitForAccountBinding(page: Page, account: string) {
  const probe = new URL("/patient/account?e2e-binding-probe", page.url()).href;
  // Only this readiness probe is intercepted. It never reads member data, populates
  // the router cache, or covers a still-unbound tab with a synthetic refusal.
  await page.route(probe, (route) => route.fulfill({
    status: 204,
    headers: { "x-e2e-binding": route.request().headers()["x-noreon-member-page"] ?? "" },
  }));
  try {
    await expect.poll(() => page.evaluate(async (url) => {
      const response = await fetch(url, { method: "HEAD" });
      return response.headers.get("x-e2e-binding");
    }, probe), { message: "The original member's tab must be bound before replacing its session" }).toBe(account);
  } finally {
    await page.unroute(probe);
  }
}

test("BC-02: a soft navigation in a stale tab is covered and never receives the next member's page", async ({ browser }) => {
  const session = await sessionOf(browser, "previewEn");
  const { context, page } = await asPerson(browser, "otherMember");
  await open(page, "/patient/dashboard");
  await waitForAccountBinding(page, accounts.otherMember.id);
  await signInOver(context, session);
  const answers = memberAnswers(page);
  const refusal = page.waitForResponse((r) => refused(r)
    && new URL(r.url()).pathname === "/patient/account"
    && r.request().headers().rsc === "1");
  await softNavigate(page, "/patient/account");
  const response = await refusal;
  expect(response.request().headers()["x-noreon-member-page"]).toBe(accounts.otherMember.id);
  const cover = page.getByRole("alertdialog");
  await expect(cover).toBeVisible();
  // Nothing was being saved, so it does not say so; the way to 103 stays.
  await expect(cover).not.toContainText("Nothing from this page was saved");
  await expect(cover.getByRole("link", { name: /103/ })).toHaveAttribute("href", "tel:103");
  expect(answers.filter((a) => !a.startsWith("409 ")), "every member answer to this tab was the refusal").toEqual([]);
  expect(new URL(page.url()).pathname, "the router never moved").toBe("/patient/dashboard");
  // Reload is the member signed in now: the tab is theirs from one request.
  await cover.getByRole("button", { name: /reload/i }).click();
  await expect(cover).toHaveCount(0);
  await open(page, "/patient/account");
  await expect(cover).toHaveCount(0);
});

test("BC-02: a poll in a stale tab is covered and never replaces the thread with the next member's", async ({ browser }) => {
  const theirs = `Fictional message of the second member ${Date.now()}`;
  const second = await asPerson(browser, "zoeHy");
  await openZoe(second.page);
  await second.page.locator("#zoe-chat-message").fill(theirs);
  await second.page.locator('[data-zoe-composer] button[type="submit"]').click();
  await expect.poll(() => sql(`select count(*) from public.conversation_messages where body='${theirs}'`)).toBe("1");
  const session = await second.context.cookies();
  await second.context.close();

  const { context, page } = await asPerson(browser, "zoeEn");
  await openZoe(page);
  await signInOver(context, session);
  const answers = memberAnswers(page);
  // The chat reads on focus as well as on its timer, so the read happens now.
  await readOnFocus(page, (r) => refused(r) && new URL(r.url()).pathname === "/api/patient/zoe/thread");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByText(theirs)).toHaveCount(0);
  expect(answers.filter((a) => !a.startsWith("409 ")), "every member answer to this tab was the refusal").toEqual([]);
});

/**
 * Window focus asks the chat to read now, but a read already in flight swallows it (one refresh at a time), and the
 * mount read may still be finishing when the test gets here. Ask again until a read starts after the ask.
 */
async function readOnFocus(page: Page, answer: (r: Response) => boolean) {
  await expect(async () => {
    const read = page.waitForResponse(answer, { timeout: 5_000 });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await read;
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
}

test("BC-02: the same tab with the same account is not covered by its reads", async ({ browser }) => {
  const { page } = await asPerson(browser, "zoeEn");
  await openZoe(page);
  await readOnFocus(page, (r) => new URL(r.url()).pathname === "/api/patient/zoe/thread" && r.status() === 200);
  await softNavigate(page, "/patient/account");
  await expect(page).toHaveURL(/patient\/account/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

const hold = (page: Page, url: string) => {
  const held: Route[] = [];
  return { held, done: page.route(url, (route) => { if (route.request().method() !== "POST") return route.fallback(); held.push(route); }) };
};

test("BC-03: a Zoe message that never gets an answer reads as not sent, keeps its text, and Try again stores it once", async ({ browser }) => {
  const text = `Fictional hung message ${Date.now()}`;
  const { page } = await asPerson(browser, "zoeEn", phone);
  await page.clock.install();
  await openZoe(page);
  const { held, done } = hold(page, "**/patient/zoe");
  await done;
  await page.locator("#zoe-chat-message").fill(text);
  await page.locator('[data-zoe-composer] button[type="submit"]').click();
  const bubble = page.locator('[data-zoe-bubble="pending"]');
  await expect(bubble).toHaveAttribute("data-state", "sending");
  await expect.poll(() => held.length).toBe(1);
  await page.clock.fastForward(26_000);
  await expect(bubble).toHaveAttribute("data-state", "failed");
  await expect(bubble).toContainText(text);
  await page.unroute("**/patient/zoe");
  // Next runs Server Actions one at a time: this only lands if the hung one really ended.
  await bubble.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => sql(`select count(*) from public.conversation_messages where body='${text}'`)).toBe("1");
  await expect(bubble).toHaveCount(0);
});

test("BC-03: a reading that never gets an answer lets the member out, keeps the numbers, and saves once", async ({ browser }) => {
  const count = () => sql(`select count(*) from public.patient_measurements where user_id='${accounts.zoeEn.id}' and systolic=137 and diastolic=87`);
  const { page } = await asPerson(browser, "zoeEn", phone);
  await page.clock.install();
  await open(page, "/patient/measurements/new");
  const close = page.getByRole("button", { name: "Close" });
  await hydrated(close);
  const { held, done } = hold(page, "**/patient/measurements/new");
  await done;
  await page.locator("#systolic").fill("137");
  await page.locator("#diastolic").fill("87");
  await page.getByRole("button", { name: "Save measurement" }).click();
  await expect.poll(() => held.length).toBe(1);
  await expect(close).toBeDisabled();
  await page.clock.fastForward(26_000);
  await expect(page.getByText("We couldn’t confirm your save")).toBeVisible();
  await expect(close).toBeEnabled();
  await expect(page.locator("#systolic")).toHaveValue("137");
  await page.unroute("**/patient/measurements/new");
  await page.getByRole("button", { name: "Save measurement" }).click();
  await expect(page).toHaveURL(/patient\/measurements$/);
  expect(count()).toBe("1");
});

test("BC-03, Astra BC-R1: a reply that stalls after its headers also reads as not sent, and Try again gets through", async ({ browser }) => {
  const text = `Fictional stalled reply ${Date.now()}`;
  const { page } = await asPerson(browser, "zoeEn", phone);
  await page.clock.install();
  // Under the app's own wrapper: valid action headers, then a body that never ends until the request is aborted.
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (!(window as unknown as { stall?: boolean }).stall || !new Headers(init?.headers).has("next-action")) return real(input, init);
      const body = new ReadableStream({ start(c) { init?.signal?.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError"))); } });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/x-component" } }));
    };
  });
  await openZoe(page);
  await page.evaluate(() => { (window as unknown as { stall?: boolean }).stall = true; });
  await page.locator("#zoe-chat-message").fill(text);
  await page.locator('[data-zoe-composer] button[type="submit"]').click();
  const bubble = page.locator('[data-zoe-bubble="pending"]');
  await expect(bubble).toHaveAttribute("data-state", "sending");
  await page.clock.fastForward(26_000);
  await expect(bubble).toHaveAttribute("data-state", "failed");
  await page.evaluate(() => { (window as unknown as { stall?: boolean }).stall = false; });
  await bubble.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => sql(`select count(*) from public.conversation_messages where body='${text}'`)).toBe("1");
});

test("BC-03: a language change that never gets an answer frees the buttons", async ({ browser }) => {
  const { page } = await asPerson(browser, "zoeEn", phone);
  await page.clock.install();
  await open(page, "/patient/account");
  const english = page.getByRole("button", { name: "English" });
  await hydrated(english);
  const { held, done } = hold(page, "**/patient/account");
  await done;
  await page.getByRole("button", { name: "Русский" }).click();
  await expect.poll(() => held.length).toBe(1);
  await expect(english).toBeDisabled();
  await page.clock.fastForward(26_000);
  await expect(page.getByText("Your language could not be saved. Try again.")).toBeVisible();
  await expect(english).toBeEnabled();
});

const medicines = (who: string, name: string) => sql(`select count(*) from public.member_medicines where user_id='${accounts[who].id}' and name='${name}'`);
/** The server does the work; the reply never reaches the phone. */
const loseNextReply = (page: Page, url: string) => {
  let lost = false;
  return page.route(url, async (route) => {
    if (lost || route.request().method() !== "POST") return route.fallback();
    lost = true;
    await route.fetch();
    await route.abort("connectionreset");
  });
};
async function fillMedicine(page: Page, name: string) {
  const add = page.getByRole("button", { name: /add a medicine/i });
  await hydrated(add);
  await add.click();
  await page.getByLabel("Name, as on the box", { exact: true }).fill(name);
  await page.getByLabel("Time 1", { exact: true }).fill("07:30");
}

test("BC-04: adding a medicine after a lost reply stores it once", async ({ browser }) => {
  const name = `Fictional lost reply ${Date.now()}`;
  const { page } = await asPerson(browser, "zoeEn", phone);
  await open(page, "/patient/medicines");
  await fillMedicine(page, name);
  await loseNextReply(page, "**/patient/medicines");
  const save = page.getByRole("button", { name: /save to my list/i });
  await save.click();
  await expect(page.getByText("We couldn’t confirm your save")).toBeVisible();
  expect(medicines("zoeEn", name)).toBe("1");
  await page.getByLabel("Name, as on the box", { exact: true }).waitFor();
  await save.click();
  await expect(page.getByLabel("Name, as on the box", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(name)).toHaveCount(1);
  expect(medicines("zoeEn", name), "one row, so one set of reminders").toBe("1");
});

test("BC-12: a dose saved with a lost reply is shown from the record, without a false failure", async ({ browser }) => {
  const id = accounts.zoeEn.id;
  sql(`delete from public.member_medicine_doses where user_id='${id}'; delete from public.member_medicines where user_id='${id}';
   insert into public.member_medicines(user_id,name,dose,times,started_on) values('${id}','Fictional dose','5 mg',array[to_char((clock_timestamp()-interval '5 minutes') at time zone 'Asia/Yerevan','HH24:MI')::time],current_date-3);`);
  const { page } = await asPerson(browser, "zoeEn", phone);
  await open(page, "/patient/medicines");
  const took = page.getByRole("button", { name: "I took it" }).first();
  await hydrated(took);
  await loseNextReply(page, "**/patient/medicines");
  await took.click();
  await expect(page.getByRole("button", { name: "Taken" }).first()).toBeVisible();
  await expect(page.getByText("We couldn’t save")).toHaveCount(0);
  await expect(page.getByText("another window")).toHaveCount(0);
  expect(sql(`select string_agg(status||':'||revision,',') from public.member_medicine_doses where user_id='${id}'`)).toBe("taken:1");
});

test("chat-cards 6: a reading saved from a card with a lost reply shows as saved, once", async ({ browser }) => {
  const id = accounts.zoeEn.id;
  sql(`delete from public.patient_measurements where user_id='${id}' and systolic=139`);
  const { page } = await asPerson(browser, "zoeEn", phone);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="bp"]').click();
  const card = page.locator('[data-zoe-card="bp"]').last();
  const prefix = (await card.locator('input[inputmode="numeric"]').first().getAttribute("id"))!.replace(/systolic$/, "");
  await page.locator(`[id="${prefix}systolic"]`).fill("139");
  await page.locator(`[id="${prefix}diastolic"]`).fill("89");
  await loseNextReply(page, "**/patient/zoe");
  await card.getByRole("button", { name: "Save reading" }).click();
  await expect(card.locator("[data-zoe-bp-saved]")).toContainText("139/89");
  await expect(card.getByText("We could not save this")).toHaveCount(0);
  expect(sql(`select count(*) from public.patient_measurements where user_id='${id}' and systolic=139`)).toBe("1");
});

const endSignIn = (context: BrowserContext) => context.clearCookies({ name: /auth-token/ });
const signIn = async (page: Page, who: string) => {
  const box = page.locator("input").first();
  await hydrated(box);
  await box.fill(accounts[who].phone!.slice(3));
  await page.getByRole("button", { name: /send|Ուղարկել/i }).click();
  // The same locator, a new box: the code screen has to be up before the code goes in.
  await expect(box).toHaveValue("");
  await box.fill("246810");
};

test("BC-05: Zoe says the sign-in ended, keeps the text, and sign-in comes back to the chat with it", async ({ browser }) => {
  const text = `Fictional ended session ${Date.now()}`;
  const { context, page } = await asPerson(browser, "previewEn", phone);
  await openZoe(page);
  await page.locator("#zoe-chat-message").fill(text);
  await endSignIn(context);
  await page.locator('[data-zoe-composer] button[type="submit"]').click();
  const notice = page.locator('[data-zoe-notice="sign_in_again"]');
  await expect(notice).toContainText("Your sign-in has ended");
  await expect(page.locator("#zoe-chat-message")).toHaveValue(text);
  await expect(page).toHaveURL(/patient\/zoe/);
  await notice.getByRole("button", { name: "Sign in again" }).click();
  // This is a full document load, including a cold sign-in compilation in dev.
  // Use the navigation budget, then keep the exact destination assertion below.
  await page.waitForURL(/\/patient\?.*next=%2Fpatient%2Fzoe/, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/patient\?.*next=%2Fpatient%2Fzoe/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await signIn(page, "previewEn");
  await expect(page).toHaveURL(/patient\/zoe/);
  await expect(page.locator("#zoe-chat-message")).toHaveValue(text);
});

// In Armenian on purpose: the sign-in page must keep the member's language. A separate number too: Auth limits a second code.
test("BC-05: the blood pressure form says the sign-in ended, keeps the reading, and comes back with it", async ({ browser }) => {
  const { context, page } = await asPerson(browser, "previewHy", phone);
  await open(page, "/patient/measurements/new");
  await hydrated(page.getByRole("button", { name: "Փակել" }));
  await page.locator("#systolic").fill("131");
  await page.locator("#diastolic").fill("83");
  await endSignIn(context);
  await page.getByRole("button", { name: "Պահել չափումը" }).click();
  const ended = page.locator("[data-sign-in-ended]");
  await expect(ended).toContainText("Ձեր մուտքի ժամկետն ավարտվել է");
  await expect(page.locator("#systolic")).toHaveValue("131");
  await ended.getByRole("button", { name: "Մուտք գործել նորից" }).click();
  await expect(page).toHaveURL(/next=%2Fpatient%2Fmeasurements%2Fnew/);
  await expect(page.locator("html")).toHaveAttribute("lang", "hy");
  await signIn(page, "previewHy");
  await expect(page).toHaveURL(/patient\/measurements\/new/);
  await expect(page.locator("#systolic")).toHaveValue("131");
  await expect(page.locator("#diastolic")).toHaveValue("83");
});

test("BC-05: adding a medicine says the sign-in ended, not that medicines are unavailable", async ({ browser }) => {
  const { context, page } = await asPerson(browser, "previewEn", phone);
  await open(page, "/patient/medicines");
  await fillMedicine(page, "Fictional ended medicine");
  await endSignIn(context);
  await page.getByRole("button", { name: /save to my list/i }).click();
  await expect(page.locator("[data-sign-in-ended]")).toContainText("Your sign-in has ended");
  await expect(page.getByText("not available right now")).toHaveCount(0);
  await expect(page.getByLabel("Name, as on the box", { exact: true })).toHaveValue("Fictional ended medicine");
});

test("BC-05: changing the language says the sign-in ended", async ({ browser }) => {
  const { context, page } = await asPerson(browser, "previewEn", phone);
  await open(page, "/patient/account");
  await hydrated(page.getByRole("button", { name: "English" }));
  await endSignIn(context);
  await page.getByRole("button", { name: "Русский" }).click();
  await expect(page.locator("[data-sign-in-ended]")).toContainText("Your sign-in has ended");
  await page.locator("[data-sign-in-ended]").getByRole("button", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(/next=%2Fpatient%2Faccount/);
});

test("Astra BC-R2: a reading kept through a reload keeps its submission, so a lost reply never stores it twice", async ({ browser }) => {
  const count = () => sql(`select count(*) from public.patient_measurements where user_id='${accounts.zoeEn.id}' and systolic=143 and diastolic=91`);
  sql(`delete from public.patient_measurements where user_id='${accounts.zoeEn.id}' and systolic=143 and diastolic=91`);
  const { page } = await asPerson(browser, "zoeEn", phone);
  await open(page, "/patient/measurements/new");
  await hydrated(page.getByRole("button", { name: "Close" }));
  await page.locator("#systolic").fill("143");
  await page.locator("#diastolic").fill("91");
  await loseNextReply(page, "**/patient/measurements/new");
  await page.getByRole("button", { name: "Save measurement" }).click();
  await expect(page.getByText("We couldn’t confirm your save")).toBeVisible();
  expect(count()).toBe("1");
  await page.reload();
  await hydrated(page.getByRole("button", { name: "Close" }));
  await expect(page.locator("#systolic")).toHaveValue("143");
  await page.getByRole("button", { name: "Save measurement" }).click();
  await expect(page).toHaveURL(/patient\/measurements$/);
  expect(count()).toBe("1");
});

test("Astra BC-R2: a message kept through a reload keeps its request id, so it never stores twice", async ({ browser }) => {
  const text = `Fictional reload during send ${Date.now()}`;
  const count = () => sql(`select count(*) from public.conversation_messages where body='${text}'`);
  const { context, page } = await asPerson(browser, "zoeEn", phone);
  await openZoe(page);
  const { held, done } = hold(page, "**/patient/zoe");
  await done;
  await page.locator("#zoe-chat-message").fill(text);
  await page.locator('[data-zoe-composer] button[type="submit"]').click();
  await expect.poll(() => held.length).toBe(1);
  const sent = held[0].request();
  const [url, headers, data] = [sent.url(), await sent.allHeaders(), sent.postDataBuffer()];
  // Ended here, so it has not landed: an unanswered held request is released by the browser.
  await held[0].abort("connectionreset");
  await page.unroute("**/patient/zoe");
  await expect(page.locator('[data-zoe-bubble="pending"]')).toHaveAttribute("data-state", "failed");
  // Twice: the id has to survive a restored draft being kept again (Astra follow-up).
  for (let reload = 0; reload < 2; reload++) {
    await page.reload();
    await expect(page.locator("#zoe-chat-message")).toHaveValue(text);
    await hydrated(page.locator("#zoe-chat-message"));
  }
  expect(count()).toBe("0");
  // The first send reaches the server only now, after the page that opened could see it stored.
  await context.request.post(url, { headers, data: data ?? undefined });
  expect(count()).toBe("1");
  await page.locator('[data-zoe-composer] button[type="submit"]').click();
  await expect(page.locator('[data-zoe-bubble="pending"]')).toHaveCount(0);
  expect(count()).toBe("1");
});

test("BC-05, shared phone: a kept draft never reaches the next member", async ({ browser }) => {
  const text = `Fictional private draft ${Date.now()}`;
  const session = await sessionOf(browser, "zoeHy");
  const { context, page } = await asPerson(browser, "zoeEn", phone);
  await openZoe(page);
  await page.locator("#zoe-chat-message").fill(text);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("noreon.draft.v1.zoe"))).toContain("private draft");
  await signInOver(context, session);
  await page.reload();
  await expect(page.locator("#zoe-chat-message")).toHaveValue("");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("noreon.draft.v1.zoe")), "and it is gone from the tab").toBeNull();
});
