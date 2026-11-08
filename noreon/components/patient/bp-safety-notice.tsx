import { Phone } from "lucide-react";

const CALL = { en: "Call 103", hy: "Զանգահարել 103", ru: "Позвонить 103" } as const;
/** The one BP check's next step for a member, with the number one press away. The words come from lib/clinical/rules/bp-words.ts. */
export function BpSafetyNotice({ text, locale }: { text: string; locale: keyof typeof CALL }) {
  return <div role="alert" data-bp-safety className="space-y-2 rounded-lg bg-destructive/10 p-3 text-body2">
    <p>{text}</p>
    <a href="tel:103" className="emergency-call flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 py-2"><Phone className="size-4" aria-hidden />{CALL[locale]}</a>
  </div>;
}
