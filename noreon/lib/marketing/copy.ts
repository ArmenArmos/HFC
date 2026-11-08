import type { LocalizedHyEn } from "@/lib/clinical/types";

/** Chrome copy for the public site. Armenian is authoritative; `en` falls back to `hy`. */
export const COPY = {
  "marketing.home": { hy: "Նորեոն Հելթ, գլխավոր", en: "Noreon, home" },
  "nav.menu": { hy: "Մենյու", en: "Menu" },
  "marketing.disclaimer": {
    hy: "Նորեոն Հելթը բժշկական սարք չէ և բժշկական խորհրդատվություն չի տրամադրում։",
    en: "Noreon is not a medical device and does not provide medical advice.",
  },
  "marketing.account": { hy: "Հաշիվ", en: "Account" },
  "marketing.signIn": { hy: "Մուտք", en: "Sign in" },
  "marketing.signInPending": {
    hy: "Մուտքը դեռ միացված չէ։ Ուղեկցվող դեմոն աշխատում է առանց հաշվի և սեսիան պահում է այս սարքում։",
    en: "Sign in is not wired up yet. The guided product demo runs without an account and keeps its session on this device.",
  },
  "notFound.title": {
    hy: "Այս հասցեով էջ չկա",
    en: "There is no page at this address",
  },
  "notFound.body": {
    hy: "Հղումը կարող է հնացած լինել, կամ հասցեում վրիպակ է։",
    en: "The link may be out of date, or the address may have a typo in it.",
  },
  "notFound.home": { hy: "Գնալ գլխավոր էջ", en: "Go to the home page" },
} as const satisfies Record<string, LocalizedHyEn>;
