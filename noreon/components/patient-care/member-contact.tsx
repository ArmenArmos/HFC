import { MessageCircle } from "lucide-react";
import { CareLink, copy } from "@/components/patient-care/common";
import type { PatientLocale } from "@/lib/patient/copy";
import type { MemberContact } from "@/lib/patient-care/member-contact";
import {Button} from '@/components/ui/button';

/** The care-team contact line for the member's current route; the text never promises a chat that is off. */
export function MemberContactLine({ contact, locale: l, signedIn = true, onMessage, embedded=false }: { embedded?:boolean; contact: MemberContact; locale: PatientLocale; signedIn?: boolean; onMessage?:()=>void }) {
  const text = embedded && signedIn && contact.mode === "chat"
    ? copy(l,"Write your question in the chat below. Your care team can read it.","Գրեք ձեր հարցը ներքևի զրույցում։ Ձեր խնամքի թիմը կարող է կարդալ այն։","Напишите вопрос в чате ниже. Ваша медицинская команда сможет его прочитать.")
    : !signedIn
    ? copy(l, "Sign in to write to your care team. For urgent medical help, call 103.", "Մուտք գործեք՝ ձեր խնամքի թիմին գրելու համար։ Շտապ բժշկական օգնության համար զանգահարեք 103։", "Войдите, чтобы написать вашей медицинской команде. Для срочной медицинской помощи звоните 103.")
    : contact.mode === "chat"
      ? copy(l, "Write to your care team in the Zoe chat. For urgent medical help, call 103.", "Գրեք ձեր խնամքի թիմին Zoe-ի զրույցում։ Շտապ բժշկական օգնության համար զանգահարեք 103։", "Напишите вашей медицинской команде в чате Zoe. Для срочной медицинской помощи звоните 103.")
      : contact.mode === "none"
        ? copy(l, "Messaging your care team in the app is not switched on yet. For urgent medical help, call 103.", "Հավելվածում խնամքի թիմին գրելը դեռ միացված չէ։ Շտապ բժշկական օգնության համար զանգահարեք 103։", "Переписка с вашей медицинской командой в приложении пока не включена. Для срочной медицинской помощи звоните 103.")
        : copy(l, "Write to your care team on Telegram. For urgent medical help, call 103.", "Գրեք ձեր խնամքի թիմին Telegram-ով։ Շտապ բժշկական օգնության համար զանգահարեք 103։", "Напишите вашей медицинской команде в Telegram. Для срочной медицинской помощи звоните 103.");
  const label = contact.mode === "chat" ? copy(l, "Message your care team", "Գրել խնամքի թիմին", "Написать медицинской команде")
    : contact.mode === "telegram" ? copy(l, "Write to your doctor", "Գրել ձեր բժշկին", "Написать вашему врачу")
    : contact.mode === "connect" ? copy(l, "Connect Telegram", "Միացնել Telegram-ը", "Подключить Telegram") : null;
  return <>
    <p className="text-body2 text-muted-foreground">{text}</p>
    {signedIn && !(embedded && contact.mode === "chat") && contact.mode !== "none" && label && (contact.mode==='chat'&&onMessage
      ? <Button type="button" className="h-auto min-h-12 whitespace-normal" onClick={onMessage}><MessageCircle aria-hidden className="size-4"/>{label}</Button>
      : <CareLink href={contact.href} icon={MessageCircle} variant="primary">{label}</CareLink>)}
  </>;
}
