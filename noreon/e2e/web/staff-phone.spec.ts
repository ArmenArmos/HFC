import { devices } from "@playwright/test";
import { expect, test, accounts, desktop, open, sql, staffSignIn } from "../fixtures";

// Phone test of 30 Oct, findings 1, 2 and 5. Sizes are the two phones the test measured.
const phones = [
  ["iphone-15", { ...devices["iPhone 15"], defaultBrowserType: undefined }],
  ["galaxy-s8", { ...devices["Galaxy S8"], defaultBrowserType: undefined }],
] as const;
const treated = accounts.zoeEn.id;

for (const [name, phone] of phones) {
  test(`${name}: staff pages start on the first screen, with the menu behind a button`, async ({ browser }) => {
    const { page } = await staffSignIn(browser, "doctor", "en", phone);
    await open(page, "/staff/real/members?locale=en");
    const height = page.viewportSize()!.height;
    const heading = await page.locator("main h1").first().boundingBox();
    expect(heading!.y, "the heading is in the top third").toBeLessThan(height / 3);
    const today = page.getByRole("link", { name: "Today" });
    await expect(today).toBeHidden();
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(today).toBeVisible();
    await today.click();
    await expect(page).toHaveURL(/\/staff\/real\/today/, { timeout: 120_000 }); // Today's first load is the slowest staff page: a cold compile of the dev server
    await expect(page.getByRole("link", { name: "My members" })).toBeHidden();
  });

  test(`${name}: a plan that cannot be published says why and offers no publish`, async ({ browser }) => {
    const { page } = await staffSignIn(browser, "doctor", "en", phone);
    await open(page, `/staff/real/members/${treated}?locale=en`);
    await page.getByRole("button", { name: "Evidence" }).click();
    const prepare = page.getByRole("button", { name: /(Prepare|Refresh) clinical requirements/ });
    await prepare.click();
    await expect(page.locator('form:has(input[name="performedOn"]):has(input[value="ecg-12-lead"])').getByRole("button", { name: "Save and confirm" })).toBeVisible();
    await page.getByRole("button", { name: "Treatment plan" }).click();
    const reason = page.getByText("Publishing is blocked: 12-lead ECG not confirmed yet");
    await expect(reason.first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish reviewed care plan" })).toBeDisabled();
    await expect(page.getByText("See the Evidence tab.").first()).toBeVisible();
    expect(sql(`select count(*) from public.patient_care_plans where user_id='${treated}'`)).toBe("0");
  });

  test(`${name}: a due first note shows on Today`, async ({ browser }) => {
    sql(`update public.member_first_note_settings set enabled=true`);
    const { page } = await staffSignIn(browser, "doctor", "en", phone);
    await open(page, "/staff/real/today?locale=en");
    await expect(page.getByText("Nothing waiting")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "First notes to approve" })).toBeVisible();
    await expect(page.getByText(/\d+ first notes?\b/).first()).toBeVisible();
  });
}

test("desktop keeps the sidebar and no menu button", async ({ browser }) => {
  const { page } = await staffSignIn(browser, "doctor", "en", desktop);
  await open(page, "/staff/real/members?locale=en");
  await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
});
