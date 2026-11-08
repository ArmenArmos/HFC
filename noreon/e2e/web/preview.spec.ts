import { expect, test, accounts, asPerson, desktop, open, phone, sql } from "../fixtures";

const writes = (who: string) => sql(`select (select count(*) from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${accounts[who].id}')||'/'||(select count(*) from public.zoe_chat_cards where member_id='${accounts[who].id}')||'/'||(select count(*) from public.patient_measurements where user_id='${accounts[who].id}')`);

for (const [name, who, device, path, failures, journey] of [
  ["Armenian phone", "previewHy", phone, "/patient/zoe/preview?l=hy", "Ցույց տալ սխալները", "Գրանցել ճնշումը"],
  ["English desktop", "previewEn", desktop, "/patient/zoe/preview?l=en", "Show failures", "Record blood pressure"],
] as const) {
  test(`Zoe preview works and saves nothing: ${name}`, async ({ browser }) => {
    const { page } = await asPerson(browser, who, device);
    const before = writes(who);
    await open(page, path);
    const frame = page.locator("[data-zoe-kit-preview]");
    await expect(frame).toHaveAttribute("data-zoe-kit-preview", "questionnaire");
    await page.getByRole("button", { name: failures }).click();
    await expect(page.getByRole("button", { name: failures })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: journey }).click();
    await expect(frame).toHaveAttribute("data-zoe-kit-preview", "bp");
    expect(writes(who)).toBe(before);
  });
}
