import {memberDoctorLabel} from "@/lib/member-staff-name.mjs";
import type {ComponentProps} from "react";
import {CareSection,IconTile,RowLink,copy} from "./common";
import {MemberContactLine} from "./member-contact";
import type {MemberContact} from "@/lib/patient-care/member-contact";
import type {PatientLocale} from "@/lib/patient/copy";
import {ClipboardList,ShieldCheck,Stethoscope} from "lucide-react";
import {Button} from "@/components/ui/button";
function TeamLink({open,...props}:ComponentProps<typeof RowLink>&{open?:(href:string)=>void}) {
  return open?<Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" onClick={()=>open(props.href)}>{props.children}</Button>:<RowLink {...props}/>;
}
export function MemberTeamContent({locale:l,clinician,contact,reviewEnabled,open,onMessage,embedded=false}:{embedded?:boolean;locale:PatientLocale;clinician:string|null;contact:MemberContact;reviewEnabled:boolean;open?:(href:string)=>void;onMessage?:()=>void}) {
  // QA N-09: Telegram-only product (lead decision 18 Oct); contact goes through the care-team chat, not email.
  const email = <CareSection title={copy(l, "Contact Noreon", "Կապվել Noreon-ի հետ", "Связаться с Noreon")}>
    <MemberContactLine contact={contact} locale={l} onMessage={onMessage}/>
  </CareSection>;
  const teamInformation = <CareSection title={copy(l, "Care team information", "Խնամքի թիմի մասին", "О медицинской команде")}>
    {clinician && <div className="flex items-start gap-3 rounded-xl bg-muted/40 p-4"><IconTile icon={Stethoscope} /><div className="min-w-0"><p className="text-caption text-muted-foreground">{copy(l, "Plan reviewer: ", "Պլանը վերանայող՝ ", "План проверяет: ")}</p><p className="break-words text-body1 font-semibold">{memberDoctorLabel(clinician,l)}</p></div></div>}
    <div className="flex items-start gap-3 text-body2"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-teal" aria-hidden /><p>{copy(l, "Only your doctor changes treatment.", "Բուժումը փոխում է միայն բժիշկը։", "Только ваш врач меняет лечение.")}</p></div>
    <div className="divide-y rounded-xl border">
      {reviewEnabled && <TeamLink open={open} href="/patient/review" icon={ClipboardList}>{copy(l, "Your review request", "Ձեր վերանայման հարցումը", "Ваш запрос на проверку")}</TeamLink>}
      <TeamLink open={open} href="/patient/care" icon={Stethoscope}>{copy(l, "Your care and visits", "Ձեր խնամքն ու այցերը", "Ваше лечение и визиты")}</TeamLink>
    </div>
  </CareSection>;

  if(embedded)return <div className="space-y-4">
    {clinician&&<p className="text-body2 font-semibold">{memberDoctorLabel(clinician,l)}</p>}
    <MemberContactLine contact={contact} locale={l} onMessage={onMessage} embedded/>
    <p className="text-body2">{copy(l,"Only your doctor changes treatment. For urgent medical help, call 103.","Բուժումը փոխում է միայն բժիշկը։ Շտապ օգնության համար զանգահարեք 103։","Только ваш врач меняет лечение. Для срочной медицинской помощи звоните 103.")}</p>
    <div className="flex flex-col gap-2">{reviewEnabled&&<TeamLink open={open} href="/patient/review" icon={ClipboardList}>{copy(l,"Previous plans","Նախորդ պլանները","Предыдущие планы")}</TeamLink>}<TeamLink open={open} href="/patient/care" icon={Stethoscope}>{copy(l,"Your plan","Ձեր պլանը","Ваш план")}</TeamLink></div>
  </div>;
  return <><div className="space-y-6">
    <header><h1 className="text-h1">{copy(l, "Contact Noreon", "Կապվել Noreon-ի հետ", "Связаться с Noreon")}</h1></header>
    {email}
    <aside className="space-y-3 rounded-2xl border border-border bg-surface-subtle-teal p-5">
      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-teal" aria-hidden /><p className="text-body2">{copy(l, "Only your doctor changes treatment. For urgent medical help, call 103.", "Բուժումը փոխում է միայն բժիշկը։ Շտապ օգնության համար զանգահարեք 103։", "Только ваш врач меняет лечение. Для срочной медицинской помощи звоните 103.")}</p></div>
    </aside>
    {teamInformation}
  </div></>;
}
