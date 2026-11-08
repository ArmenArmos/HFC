import Link from "next/link";
import type { Route } from "next";
import { Pill } from "lucide-react";
import { Status, stamp } from "@/components/patient-care/common";
import { st, type StaffLocale } from "@/lib/staff/staff-locale-copy";
import { concernSummary } from "@/lib/member-medicines/staff-copy";
import { handleMedicineConcern } from "@/lib/member-medicines/doctor-actions";
import type { DoctorConcern } from "@/lib/member-medicines/asks";

/** Russian UI wrapper; medicine names and doses remain exactly as recorded. */
function russianConcernSummary(c: DoctorConcern) {
  const due = new Date(Date.parse(c.ask.dueAt) + 4 * 3600000).toISOString();
  const when = `${due.slice(8, 10)}.${due.slice(5, 7)} ${due.slice(11, 16)}`;
  const med = [c.ask.medicine.name, c.ask.medicine.dose].filter(Boolean).join(" ");
  const what = c.ask.trigger === "skipped" ? `Приём ${med} в ${when} отмечен как пропущенный.` : `Приём ${med} в ${when} не отмечен.`;
  const reasons = {forgot: "забыл", side_effect: "побочный эффект", cost_or_availability: "стоимость или не удалось получить", ran_out: "лекарство закончилось", decided_to_stop: "решил прекратить приём"};
  const why = c.ask.reason ? `Сообщил Зое: ${reasons[c.ask.reason]}.` : "";
  const ticks = `За последние 14 дней: принято ${c.ticks14.taken}, пропущено ${c.ticks14.skipped} (по отметкам самого участника).`;
  const ask = c.kind === "refill" ? "Просит медицинскую команду помочь пополнить запас лекарства." : "Участнику сообщили, что вы ответите.";
  return [what, why, ticks, ask].filter(Boolean).join(" ");
}

const button = "inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring";
function kindLabel(c: DoctorConcern, l: StaffLocale) {
  return c.kind === "refill" ? st(l, "Refill", "Նոր դեղ","Пополнить запас лекарства") : c.kind === "side_effect" ? st(l, "Side effect", "Կողմնակի ազդեցություն","Побочный эффект") : st(l, "Stopped a medicine", "Դադարեցրել է դեղը","Прекратил приём лекарства");
}

/**
 * Item 5 on the doctor's Today: medicines waiting for the doctor (side effect, stopping, refill), oldest first.
 * Read by the page (readDoctorMedicineConcerns), separate from doctor_ai_inbox; nothing when empty or switched off,
 * "unavailable" when the read failed (null).
 */
export function MedicineConcernsSection({ items, l }: { items: DoctorConcern[] | null; l: StaffLocale }) {
  const t = (en: string, hy: string, ru: string) => st(l, en, hy, ru);
  if (items !== null && items.length === 0) return null;
  return (
    <section aria-labelledby="medicine-concerns" className="space-y-3 rounded-xl border bg-background p-4">
      <h2 id="medicine-concerns" className="flex flex-wrap items-baseline gap-2 text-h3">{t("Waiting for you: medicines", "Սպասում է ձեզ՝ դեղեր","Ждут вас: лекарства")}<span className="text-body2 font-normal text-muted-foreground">{items?.length ?? ""}</span></h2>
      <p className="text-body2 text-muted-foreground">{t("Members who told Zoe about a side effect, stopping a medicine, or needing a refill. Zoe gave no medicine advice. Answer the member, then mark it handled.", "Անդամներ, ովքեր Զոյային հայտնել են կողմնակի ազդեցության, դեղը դադարեցնելու կամ նոր դեղի կարիքի մասին։ Զոյան դեղերի վերաբերյալ խորհուրդ չի տվել։ Պատասխանեք անդամին, ապա նշեք որպես լուծված։","Участники, сообщившие Зое о побочном эффекте, прекращении приёма или необходимости пополнить запас лекарства. Зоя не давала советов о лекарствах. Ответьте участнику, затем отметьте вопрос как решённый.")}</p>
      {items === null ? <p role="alert" className="text-body2">{t("Unavailable. Reload to check.", "Անհասանելի է։ Թարմացրեք էջը՝ ստուգելու համար։","Недоступно. Обновите страницу, чтобы проверить.")}</p> : (
        <ul className="divide-y">{items.map(c => (
          <li key={c.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Pill className="size-5 shrink-0" aria-hidden />
              <span className="text-body2 font-semibold"><Link href={`/staff/real/members/${c.memberId}` as Route} className="underline underline-offset-4">{c.memberName || t("Member without a name", "Անանուն անդամ","Участник без имени")}</Link></span>
              <Status tone={c.kind === "refill" ? "neutral" : "attention"}>{kindLabel(c, l)}</Status>
            </div>
            <p className="text-body2">{l === "ru" ? russianConcernSummary(c) : concernSummary(c, l)}</p>
            <p className="text-caption text-muted-foreground">{t("Since", "Սկսած","С")} {stamp(c.createdAt, l)} · {c.ask.source === "plan" ? t("Care plan medicine", "Խնամքի պլանի դեղ","Лекарство из плана заботы") : t("Self-reported medicine", "Անդամի կողմից հաղորդված դեղ","Лекарство, указанное участником")}</p>
            <div className="flex flex-wrap items-start gap-3">
              <Link href={`/staff/real/conversations/${c.memberId}` as Route} className={`${button} border`}>{t("Open conversation", "Բացել զրույցը","Открыть разговор")}</Link>
              <form action={handleMedicineConcern}><input type="hidden" name="concernId" value={c.id} />
                <button className={`${button} bg-primary text-primary-foreground`}>{t("Mark handled", "Նշել որպես լուծված","Отметить как решённое")}</button></form>
            </div>
          </li>))}
        </ul>)}
    </section>
  );
}
