import {ArrowLeft,HeartPulse,PhoneCall} from "lucide-react";
import {CareLink,CareSection,IconTile,copy} from "@/components/patient-care/common";
import {currentWeek,weekPhase,type BpWeekRead} from "@/lib/bp-week/model";
import {WeekView} from "./week-view";
import {StartWeekForm,StopWeekButton,WeekReminderToggle} from "./week-controls";
import type {PatientLocale} from "@/lib/patient/copy";
export function MemberBpWeekContent({read,locale:l,now,showDevice,embedded=false,record,onSaved}:{read:Extract<BpWeekRead,{enabled:true}>;locale:PatientLocale;now:Date;showDevice:boolean;embedded?:boolean;record?:(slot:'morning'|'evening')=>void;onSaved?:()=>void}) {
 const week=currentWeek(read,now),phase=week?weekPhase(week,now):null;
 const open=phase==='running'||phase==='not-started';
 return (
      <div className="space-y-5">
        <header className="flex items-start gap-3">
          <IconTile icon={HeartPulse} />
          <div>
            <h1 className="text-h1">{copy(l, "Your 7-day blood pressure week", "Ձեր 7-օրյա ճնշման շաբաթը", "Ваша 7-дневная неделя измерений давления")}</h1>
            <p className="mt-1 text-body2 text-muted-foreground">{copy(l, "Two readings every morning and every evening, for 7 days, at home.", "Ամեն առավոտ և ամեն երեկո երկու չափում՝ 7 օր, տանը։", "По два измерения каждое утро и каждый вечер в течение 7 дней, дома.")}</p>
          </div>
        </header>

        {week && <WeekView week={week} l={l} now={now} showDevice={showDevice} record={record} />}

        {!open && (read.memberCanStart ? (
          <CareSection title={week ? copy(l, "Start a new week", "Սկսել նոր շաբաթ", "Начать новую неделю") : copy(l, "Start your week", "Սկսեք ձեր շաբաթը", "Начать неделю")}
            detail={copy(l, "Choose the first day and your two times. You can stop at any time.", "Ընտրեք առաջին օրը և ձեր երկու ժամերը։ Կարող եք դադարեցնել ցանկացած պահի։", "Выберите первый день и два времени для измерений. Остановиться можно в любой момент.")}>
            <StartWeekForm locale={l} today={read.today} onSaved={onSaved} />
          </CareSection>
        ) : !week && (
          <CareSection title={copy(l, "Your week has not started yet", "Ձեր շաբաթը դեռ չի սկսվել", "Ваша неделя ещё не началась")}>
            <p className="text-body2 text-muted-foreground">{copy(l, "Your nurse starts it with you, usually when you get your monitor.", "Ձեր բուժքույրը այն սկսում է ձեզ հետ, սովորաբար, երբ ստանում եք սարքը։", "Медсестра начинает её вместе с вами, обычно когда вы получаете тонометр.")}</p>
          </CareSection>
        ))}

        {week && open && (
          <CareSection title={copy(l, "Reminders and changes", "Հիշեցումներ և փոփոխություններ", "Напоминания и изменения")}>
            <p className="text-body2 text-muted-foreground">{week.reminders
              ? copy(l, `We remind you in Telegram at ${week.morningTime} and ${week.eveningTime} while a slot is open. Never during your quiet hours.`, `Մենք հիշեցնում ենք Telegram-ում ժամը ${week.morningTime}-ին և ${week.eveningTime}-ին, քանի դեռ չափումները պահված չեն։ Երբեք՝ ձեր հանգստի ժամերին։`, `Мы напоминаем вам в Telegram в ${week.morningTime} и ${week.eveningTime}, пока время для измерений остаётся открытым. Никогда в ваши часы тишины.`)
              : copy(l, "Telegram reminders are off for this week.", "Telegram հիշեցումներն այս շաբաթվա համար անջատված են։", "Напоминания в Telegram на эту неделю отключены.")}</p>
            <div className="flex flex-wrap items-start gap-3">
              <WeekReminderToggle locale={l} weekId={week.id} on={week.reminders} onSaved={onSaved} />
              <StopWeekButton locale={l} weekId={week.id} onSaved={onSaved} />
            </div>
          </CareSection>
        )}

        <p className="flex items-start gap-2 rounded-xl border border-border/70 bg-card p-4 text-body2">
          <PhoneCall className="mt-0.5 size-4 shrink-0" aria-hidden />
          {copy(l, "If you feel unwell, call 103", "Եթե վատ եք զգում, զանգահարեք 103", "Если вы плохо себя чувствуете, звоните 103")}
        </p>
        {!embedded && <CareLink href="/patient/health" icon={ArrowLeft}>{copy(l, "Back to Pressure", "Վերադառնալ «Ճնշում»", "Вернуться к разделу «Давление»")}</CareLink>}
      </div>
 );
}
