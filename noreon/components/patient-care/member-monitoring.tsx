"use client";
import { useState } from "react";
import {isTextUsableInLocale,memberInstruction} from '@/lib/text-language';
import { useRouter } from "next/navigation";
import { Activity, Check, ChevronDown, ClipboardList, Mail } from "lucide-react";
import { acknowledgeMonitoring } from "@/lib/staff/monitoring-actions";
import type { MemberMonitoring as Requirements } from "@/lib/service-workflow/follow-up";
import type { PatientLocale } from "@/lib/patient/copy";
import { CareLink, copy, stamp } from "./common";
export function MemberMonitoring({
  requirements,
  locale: l,
  now,
}: {
  requirements: Requirements;
  locale: PatientLocale;
  now: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  if (!requirements.length) return (
    <section className="flex flex-wrap items-center justify-between gap-2 border-y py-3">
      <h2 className="inline-flex items-center gap-2 text-body2 font-semibold">
        <Activity size={18} className="text-brand-teal" aria-hidden="true" />
        {copy(l, "Your monitoring", "Ձեր չափումները", "Ваши измерения")}
      </h2>
      <p className="text-caption text-muted-foreground">
        {copy(l, "No monitoring requirement recorded", "Չափումների պահանջ չի գրանցվել", "Обязательные измерения не назначены")}
      </p>
    </section>
  );
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Activity size={20} className="text-brand-teal" aria-hidden="true" />
        <h2 className="text-h2">
          {copy(l, "Your monitoring", "Ձեր չափումները", "Ваши измерения")}
        </h2>
      </div>
      {!requirements.length && (
        <p className="mt-3 text-body2 text-muted-foreground">
          {copy(
            l,
            "Your doctor has not added a monitoring requirement.",
            "Ձեր բժիշկը չափումների պահանջ դեռ չի ավելացրել։",
            "Ваш врач пока не назначил обязательные измерения.",
          )}
        </p>
      )}
      <div className="mt-3 divide-y">
        {requirements.map((r) => {
          const usable = isTextUsableInLocale(r.instructions,l);
          const upcoming = r.status === "active" && now < Date.parse(r.startsAt);
          const ended = r.status === "active" && now >= Date.parse(r.endsAt);
          const InstructionsContainer = r.status === "active" ? "div" : "details";
          const InstructionsHeading = r.status === "active" ? "h3" : "summary";
          return (
          <article key={r.id} className="space-y-3 py-4 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-body1 font-semibold">
                {copy(
                  l,
                  `${r.received} of ${r.requiredCount} verified readings recorded`,
                  `${r.requiredCount} ստուգված չափումից ${r.received}-ը գրանցված է`,
                  `Внесено проверенных измерений: ${r.received} из ${r.requiredCount}`,
                )}
              </p>
              <p className="text-caption text-muted-foreground">
                {stamp(r.startsAt, l)} – {stamp(r.endsAt, l)}
              </p>
            </div>
            {upcoming && <p className="text-caption font-medium">
              {copy(l, `Starts ${stamp(r.startsAt, l)}`, `Սկսվում է ${stamp(r.startsAt, l)}`, `Начало: ${stamp(r.startsAt, l)}`)}
            </p>}
            {ended && <p className="text-caption font-medium">
              {copy(l, "Window ended", "Ժամանակահատվածն ավարտվել է", "Период завершён")}
              {r.missing === 0 && <> · {copy(l, "No readings missing", "Բացակայող չափումներ չկան", "Все измерения внесены")}</>}
            </p>}
            {!!r.late && (
              <p className="text-caption text-muted-foreground">
                {copy(
                  l,
                  `${r.late} ${r.late === 1 ? "reading" : "readings"} entered late`,
                  `${r.late} չափում մուտքագրվել է ժամանակահատվածի ավարտից հետո։`,
                  `Измерений, внесённых после завершения периода: ${r.late}`,
                )}
              </p>
            )}
            <InstructionsContainer className={r.status === "active" ? "space-y-3 rounded-xl border bg-surface-subtle-teal/40 p-4" : "group rounded-xl border px-4"}>
              <InstructionsHeading className={r.status === "active" ? "flex items-start gap-2 text-body2 font-semibold" : "flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg py-3 text-body2 font-semibold transition-colors hover:text-brand-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"}>
                <ClipboardList className="mt-0.5 size-4 shrink-0 text-brand-teal" aria-hidden />
                <span className="min-w-0 flex-1">
                {copy(
                  l,
                  "Your doctor’s monitoring instructions",
                  "Ձեր բժշկի չափումների ցուցումները",
                  "Указания вашего врача по измерениям",
                )}
                </span>
                {r.status !== "active" && <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />}
              </InstructionsHeading>
              <div className="mt-2 space-y-2">
                <p className="text-caption text-muted-foreground">
                  {r.doctor} · {stamp(r.createdAt, l)}
                </p>
                <p className="max-w-2xl whitespace-pre-wrap break-words text-body2">
                  {memberInstruction(r.instructions,l)}
                </p>
                {r.status === "active" && (r.acknowledgedAt ? (
                  <p className="text-caption text-brand-teal">
                    {copy(
                      l,
                      "You marked these instructions as read",
                      "Դուք նշել եք այս ցուցումները որպես կարդացված",
                      "Вы отметили эти указания как прочитанные",
                    )}{" "}
                    · {stamp(r.acknowledgedAt, l)}
                  </p>
                ) : (
                  <button
                    type="button"
                    className="inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-body2 font-semibold transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                    disabled={!!busy||!usable}
                    onClick={async () => {
                      if(!usable||busy)return;
                      setBusy(r.id);
                      setError("");
                      try {
                        const result = await acknowledgeMonitoring(r.id);
                        if (!result.ok) throw new Error();
                        router.refresh();
                      } catch {
                        setError(
                          copy(
                            l,
                            "Could not confirm this. Please try again.",
                            "Չհաջողվեց հաստատել։ Կրկին փորձեք։",
                            "Не удалось подтвердить. Попробуйте ещё раз.",
                          ),
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <Check className="size-4 shrink-0" aria-hidden />
                    {copy(
                      l,
                      "I have read these instructions",
                      "Ես կարդացել եմ այս ցուցումները",
                      "Я прочитал(а) эти указания",
                    )}
                  </button>
                ))}
                {!usable&&<CareLink href="/patient/team?section=contact" icon={Mail}>
                  {copy(l, "Message your care team", "Գրել խնամքի թիմին", "Написать медицинской команде")}
                </CareLink>}
              </div>
            </InstructionsContainer>
            {r.status !== "active" ? (
              <p className="text-caption">
                {r.status === "cancelled"
                  ? copy(
                      l,
                      "This requirement was cancelled.",
                      "Այս պահանջը չեղարկվել է։",
                      "Это назначение отменено.",
                    )
                  : copy(
                      l,
                      "This requirement was superseded. Follow your current instructions.",
                      "Այս պահանջը փոխարինվել է։ Հետևեք ձեր գործող ցուցումներին։",
                      "Это назначение заменено. Следуйте вашим текущим указаниям.",
                    )}
              </p>
            ) : !upcoming && !(ended && r.missing === 0) && (
              <div className="space-y-1">
                {ended && r.missing > 0 && <p className="text-caption text-muted-foreground">
                  {copy(l, "Only readings taken during this window count. You can still enter an earlier reading.", "Հաշվվում են միայն այս ժամանակահատվածում կատարված չափումները։ Կարող եք դեռ մուտքագրել նախկին չափումը։", "Учитываются только измерения, сделанные в этот период. Вы ещё можете внести ранее сделанное измерение.")}
                </p>}
                <div className="flex flex-wrap gap-3">
                <CareLink href="/patient/measurements/new" icon={Activity} variant={ended ? "secondary" : "primary"}>
                  {copy(
                    l,
                    ended ? "Add a reading from this window" : "Record a blood pressure reading",
                    ended ? "Ավելացնել այս ժամանակահատվածի չափումը" : "Գրանցել զարկերակային ճնշման չափում",
                    ended ? "Добавить измерение за этот период" : "Записать измерение артериального давления",
                  )}
                </CareLink>
                {ended && r.missing > 0 && <CareLink href="/patient/team?section=contact" icon={Mail}>
                  {copy(l, "See contact options", "Դիտել կապի տարբերակները", "Посмотреть способы связи")}
                </CareLink>}
                </div>
              </div>
            )}
          </article>
        );})}
      </div>
      {!!requirements.length && (
        <aside className="border-t pt-4">
          <h3 className="text-caption font-semibold text-muted-foreground">
            {copy(
              l,
              "About your required readings",
              "Պահանջվող չափումների մասին",
              "О ваших обязательных измерениях",
            )}
          </h3>
          {requirements.some(r => r.status === "active") && <p className="mt-2 text-caption text-muted-foreground">
            {copy(l, "Recorded readings have not necessarily been reviewed. Your approved plan stays available during review.", "Գրանցված չափումները կարող են դեռ վերանայված չլինել։ Ձեր հաստատված պլանը հասանելի է վերանայման ընթացքում։", "Внесённые измерения могут быть ещё не проверены. Ваш утверждённый план остаётся доступным во время проверки.")}
          </p>}
          <p className="mt-2 text-caption text-muted-foreground">
            {copy(
              l,
              "These instructions were added by your doctor. Your personal reminder settings do not change the required readings. This is not continuous or emergency monitoring.",
              "Այս ցուցումները ավելացրել է ձեր բժիշկը։ Ձեր անձնական հիշեցումների կարգավորումները չեն փոխում պահանջվող չափումները։ Սա շարունակական կամ շտապ վերահսկում չէ։",
              "Эти указания добавил ваш врач. Ваши настройки напоминаний не меняют обязательные измерения. Это не непрерывное наблюдение и не экстренная помощь.",
            )}
          </p>
        </aside>
      )}
      {error && (
        <p role="alert" className="mt-3 text-body2 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
