import type { MetadataRoute } from "next";
import { cookies, headers } from "next/headers";
import { NOREON, NOREON_HY } from "@/lib/brand";
import { parseLocale, pick, type Locale } from "@/lib/locale";
import { staffLocaleCookie } from "@/lib/staff/staff-locale";
import { backofficeHost } from "@/lib/staff/hosts";

/**
 * The web app manifest.
 *
 * Next picks this file up by convention and emits the `<link rel="manifest">`
 * itself, so nothing in `app/layout.tsx` names it.
 *
 * It is here for the install: an Android home screen, a pinned Chrome tab or a
 * desktop shortcut all read this rather than the `<head>`, and without it they
 * fall back to a screenshot of the favicon on a white plate. The icons it
 * points at live in `public/icons/` rather than being the `app/icon.png` route,
 * because a manifest needs a stable URL and that route's is generated.
 *
 * The `maskable` icons are the same app icon with its navy plate extended to
 * the edge and the mark scaled to 85%, so the teal dot stays inside the
 * circular safe zone Android launchers crop to. They were cut from
 * `icon-512.png` with sharp rather than redrawn; if the design team supplies a
 * proper maskable tile, replace the two files.
 *
 * `start_url` is `/patient`, which sends a signed-in member to Home and anyone
 * else to sign-in, so the installed app opens the member app rather than the
 * informational homepage. The marketing deployment has no `/patient`, so it
 * keeps `/`. The backoffice host has no `/patient` either, and `/` is its sign-in.
 *
 * `#fcfcfc` is `--noreon-stone`, the ground `app/globals.css` declares and the
 * colour the app actually paints. A manifest is JSON read by the operating
 * system, so it cannot reference a custom property; `pnpm check:tokens`
 * compares this literal against the stylesheet and fails if they drift.
 *
 * Name and description follow the reader's language cookie (the member app's
 * `noreon_locale`, the staff screens' `noreon-staff-locale`) and are Armenian
 * when none is set: «Նորեոն Հելթ», from `lib/brand.ts`.
 */
const COPY = {
  app: (l: Locale) => ({
    name: pick(l, { hy: NOREON_HY.base, en: "Noreon, understand your health data", ru: NOREON.ru }),
    short_name: pick(l, { hy: NOREON_HY.base, en: "Noreon", ru: NOREON.ru }),
    description: pick(l, {
      hy: `${NOREON_HY.definite} ձեր ամենօրյա առողջական չափումները դարձնում է միտումներ, որոնց հիման վրա կարող եք գործել։`,
      en: "Noreon turns everyday health measurements into trends you can act on.",
      ru: `${NOREON.ru} превращает ежедневные измерения здоровья в понятную динамику, по которой можно действовать.`,
    }),
  }),
  backoffice: (l: Locale) => ({
    name: pick(l, { hy: `${NOREON_HY.base}, աշխատակազմ`, en: "Noreon backoffice", ru: `${NOREON.ru}, для сотрудников` }),
    short_name: pick(l, { hy: NOREON_HY.base, en: "Noreon", ru: NOREON.ru }),
    description: pick(l, {
      hy: `${NOREON_HY.genitive} աշխատակազմի հավելվածը։`,
      en: "Noreon turns everyday health measurements into trends you can act on.",
      ru: `Приложение ${NOREON.ru} для сотрудников.`,
    }),
  }),
};
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const backoffice = backofficeHost((await headers()).get("host") ?? "");
  const jar = await cookies();
  const locale = parseLocale(jar.get(backoffice ? staffLocaleCookie : "noreon_locale")?.value, "hy");
  const copy = (backoffice ? COPY.backoffice : COPY.app)(locale);
  return {
    name: copy.name,
    short_name: copy.short_name,
    description: copy.description,
    lang: locale,
    start_url: backoffice || process.env.NOREON_DEPLOYMENT_TARGET === "marketing" ? "/" : "/patient",
    scope: "/",
    display: "standalone",
    background_color: "#fcfcfc",
    theme_color: "#fcfcfc",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
