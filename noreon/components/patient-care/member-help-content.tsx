import type {ComponentProps} from "react";
import {CareSection, CareLink, copy} from "./common";
import {MemberContactLine} from "./member-contact";
import type {MemberContact} from "@/lib/patient-care/member-contact";
import type {PatientLocale} from "@/lib/patient/copy";
import {ZOE_FAQ} from "@/lib/zoe/member-screen";
import {Phone, Stethoscope} from "lucide-react";
import {Button} from "@/components/ui/button";

function SupportLink({open,...props}:ComponentProps<typeof CareLink>&{open?:(href:string)=>void}) {
  if(open && props.href.startsWith('/patient/'))return <Button type="button" variant="outline" className="h-auto min-h-12 max-w-full whitespace-normal" onClick={()=>open(props.href)}>{props.children}</Button>;
  return <CareLink {...props}/>;
}

/** The same help content in the page and in Zoe's thread. */
export function MemberHelpContent({locale:l,contact,signedIn=true,signingUp=false,open,onMessage,embedded=false}:{embedded?:boolean;locale:PatientLocale;contact:MemberContact;signedIn?:boolean;signingUp?:boolean;open?:(href:string)=>void;onMessage?:()=>void}) {
  return <div className="space-y-6">
        {!embedded&&<header>
          <h1 className="text-h1">{copy(l, "Get help", "Ստանալ օգնություն", "Получить помощь")}</h1>
        </header>}
        <CareSection
          title={copy(
            l,
            "Need urgent medical help?",
            "Շտապ բժշկական օգնությո՞ւն է պետք։", "Нужна срочная медицинская помощь?",
          )}
        >
          <p className="max-w-2xl text-body2">
            {copy(
              l,
              "Call 103 for emergency medical help. This app does not notify a doctor or emergency service when you open this page.",
              "Շտապ բժշկական օգնության համար զանգահարեք 103։ Այս էջը բացելը չի ծանուցում բժշկին կամ շտապ օգնությանը։", "Для экстренной медицинской помощи позвоните 103. Открытие этой страницы не уведомляет врача или службу скорой помощи.",
            )}
          </p>
          {/* Signed in, the header's Emergency 103 pill is the one call button (Khikar, 18 Oct 22:57).
              Signed out there is no pill, so the page keeps its own. */}
          {!signedIn && (
            <CareLink href="tel:103" icon={Phone} variant="emergency">
              {copy(l, "Call 103", "Զանգահարել 103", "Позвонить 103")}
            </CareLink>
          )}
        </CareSection>
        <CareSection title={copy(l,"Contact Noreon","Կապվել Noreon-ի հետ", "Связаться с Noreon")}>
          <MemberContactLine contact={contact} locale={l} signedIn={signedIn} onMessage={onMessage} embedded={embedded} />
          {signedIn
            ? <SupportLink open={open} href="/patient/team?section=contact" icon={Stethoscope}>{copy(l,"Care team information","Խնամքի թիմի մասին", "О медицинской команде")}</SupportLink>
            : <CareLink href={`/patient?locale=${l}`}>{signingUp ? copy(l,"Back to sign-up","Վերադառնալ գրանցմանը", "Вернуться к регистрации") : copy(l,"Back to sign in","Վերադառնալ մուտքին", "Вернуться ко входу")}</CareLink>}
        </CareSection>
        {signedIn && (
          <CareSection id={open?undefined:"about-zoe"} title={copy(l, "About Zoe", "Zoe-ի մասին", "О Zoe")}>
            {/* Moved from the Zoe screen (Khikar, 18 Oct 22:57). Staging draft copy for Armen/Tatevik sign-off. */}
            <p className="max-w-2xl text-body2" data-zoe-about>
              {copy(
                l,
                "Zoe is an AI assistant, not a doctor, and she is still learning. For health questions, your doctor answers. Zoe explains; only your doctor changes treatment.",
                "Zoe-ն ԱԲ օգնական է, ոչ բժիշկ, և դեռ սովորում է։ Առողջության հարցերին պատասխանում է ձեր բժիշկը։ Zoe-ն բացատրում է, իսկ բուժումը փոխում է միայն ձեր բժիշկը։", "Zoe является ИИ-помощником, а не врачом, и ещё учится. На вопросы о здоровье отвечает ваш врач. Zoe объясняет, а лечение меняет только ваш врач.",
              )}
            </p>
            <div className="divide-y rounded-xl border">
              {ZOE_FAQ.filter((item) => !embedded && item.id === "treatment" || item.id === "reading").map((item) => (
                <details key={item.id} className="group px-4">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center py-3 text-body2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    {item.question[l]}
                  </summary>
                  <div className="space-y-3 pb-4">
                    <p className="text-body2">{item.answer[l]}</p>
                    {item.link && <SupportLink open={open} href={item.link.href} variant="secondary">{item.link.label[l]}</SupportLink>}
                  </div>
                </details>
              ))}
            </div>
          </CareSection>
        )}
  </div>;
}
