import { MessageCircle } from "lucide-react";
import { IconTile } from "@/components/patient-care/common";
import { tx, type PatientLocale } from "@/lib/patient/copy";

/** How to reach the care team, and that chat is not for emergencies (prototype D10). Shows no hours and promises no reply time (P26, 18 Oct). */
export function WhenWeReply({ locale: l }: { locale: PatientLocale }) {
  return <section aria-labelledby="contact-care-team" className="journey-card space-y-3">
    <header className="flex items-center gap-3"><IconTile icon={MessageCircle}/><h2 id="contact-care-team" className="text-h3">{tx(l, "Կապ ձեր խնամքի թիմի հետ", "Contacting your care team", "Связь с вашей медицинской командой")}</h2></header>
    <p className="text-body2">{tx(l, "Կարող եք գրել ձեր խնամքի թիմին ցանկացած ժամի։ Նրանք կպատասխանեն հնարավորինս շուտ։", "You can write to your care team any time. They reply as soon as they can.", "Вы можете написать вашей медицинской команде в любое время. Они ответят, как только смогут.")}</p>
    {/* No call button here: the header's Emergency 103 pill is the one on everyday screens (Khikar, 18 Oct 22:57). */}
    <p className="border-t border-destructive/40 pt-3 text-body2 font-semibold">{tx(l, "Telegram-ը և Zoe-ն շտապ օգնության համար չեն։ Եթե հիմա վատ եք զգում, զանգահարեք 103։", "Telegram and Zoe are not for emergencies. If you feel unwell now, call 103.", "Telegram и Zoe не предназначены для экстренных ситуаций. Если вам сейчас плохо, вызовите скорую помощь (103).")}</p>
  </section>;
}
