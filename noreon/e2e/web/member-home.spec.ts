import { asPerson, env, expect, open, phone, test } from "../fixtures";

test.skip(process.env.NOREON_E2E_MEMBER_HOME !== "true", "Run with NOREON_E2E_MEMBER_HOME=true to exercise the dark Home.");

for (const [who, locale] of [["zoeEn", "en"], ["zoeHy", "hy"]] as const) {
  test(`${locale}: prototype Home, five tabs, 320 px and doubled text, previous Home fallback`, async ({ browser }) => {
    const { page } = await asPerson(browser, who, phone);
    await open(page, "/patient/dashboard");
    const home = page.locator("[data-member-home]");
    await expect(home).toBeVisible();
    await expect(page.locator(".member-journey")).toHaveAttribute("lang", locale);
    const tabs = page.locator(".journey-tabbar a");
    expect(await tabs.evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual([
      "/patient/dashboard", "/patient/progress", "/patient/zoe", "/patient/care", "/patient/account",
    ]);

    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const size of ["100%", "200%"]) {
        await page.evaluate(size => { document.documentElement.style.fontSize = size; }, size);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const menu = home.locator("#member-home-menu");
        await expect(menu).not.toHaveAttribute("open");
        const notices = home.locator('[data-safety-card], [data-exercise-paused], [data-zoe-consent-prompt], #consultation-hold-title, [data-first-note], [data-home-review], [data-home-attention], [data-home-medicine-ask], #home-team-title, [data-ldl-retest], [data-ldl-with-doctor]');
        if (size === "100%" && width < 1024 && await notices.count() === 0) {
          expect(await page.evaluate(() => document.documentElement.scrollHeight), "Notice-free Home stays within about 2.5 phone screens").toBeLessThanOrEqual(844 * 2.5);
        }
        await menu.locator(":scope > summary").click();
        await expect(menu.locator('a[href="/patient/medicines"]')).toBeVisible();
        await expect(menu.locator('a[href="/patient/dashboard?view=classic#daily-routine"]')).toBeVisible();
        await menu.locator(".member-home-journey > summary").click();
        const overflowingStages = await menu.locator(".journey-strip-label").evaluateAll(labels => labels.filter(label => label.scrollWidth > label.clientWidth + 1).map(label => label.textContent));
        expect(overflowingStages, "Expanded journey labels fit at large text sizes").toEqual([]);
        await menu.locator(".member-home-journey > summary").click();
        // The final fallback link must be scrollable clear of the actual fixed bar,
        // even after Armenian labels wrap onto extra lines at 200% text.
        const fallback = home.locator('a[href="/patient/dashboard?view=classic"]');
        await fallback.evaluate(link => link.scrollIntoView({ block: "center" }));
        if (width < 1024) {
          await expect(tabs.nth(2)).toBeVisible();
          await expect.poll(async () => {
            const [link, bar] = await Promise.all([fallback.boundingBox(), page.locator(".journey-tabbar").boundingBox()]);
            return !!link && !!bar && link.y + link.height <= bar.y;
          }).toBe(true);
        }
        const issues = await home.locator("a").evaluateAll(links => links.filter(link => {
          const rect = link.getBoundingClientRect();
          return rect.height > 0 && (rect.height < 44 || link.scrollWidth > link.clientWidth + 1);
        }).map(link => link.getAttribute("href")));
        expect(issues, `${locale}, ${width}px, ${size} text: touch targets and clipped links`).toEqual([]);
        await menu.locator(":scope > summary").click();
      }
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
    await page.setViewportSize({ width: 320, height: 844 });
    // The dev server compiles a route on first use, which took over a minute here under load and outlasted the 30 s wait below.
    await page.request.get(`${env.site}/patient/zoe`, { timeout: 180_000 });
    await tabs.nth(2).click();
    await expect(page).toHaveURL(/\/patient\/zoe$/);
    await expect(page.locator('.journey-tabbar a[aria-current="page"]')).toHaveAttribute("href", "/patient/zoe");
    await open(page, "/patient/dashboard?view=classic");
    await expect(home).toHaveCount(0);
    await expect(page.locator("h1")).toBeVisible();
  });
}
