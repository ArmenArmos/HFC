"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { safeRequest } from "@/lib/patient/transport";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { PatientLocale } from "@/lib/patient/copy";
import type { DueDose } from "@/lib/patient-care/types";
import { acknowledgePlan, reportDose } from "@/app/patient/care/actions";
import { copy } from "./common";
function careSaveError(result: unknown, l: PatientLocale) {
  if (result && typeof result === "object" && "reason" in result && result.reason === "conflict")
    return copy(l,"Your check-in changed. Refresh to see the latest before trying again.","Ձեր գրառումը փոխվել է։ Կրկին փորձելուց առաջ թարմացրեք էջը՝ վերջին տվյալները տեսնելու համար։", "Ваша запись изменилась. Обновите страницу, чтобы увидеть последние данные, прежде чем повторить попытку.");
  return copy(l,"Not saved. Refresh and check the current plan before trying again.","Չպահվեց։ Թարմացրեք էջը և ստուգեք ընթացիկ պլանը՝ կրկին փորձելուց առաջ։", "Не сохранено. Обновите страницу и проверьте текущий план, прежде чем повторить попытку.");
}
export function CareRefresh() {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);
  return null;
}
export function DoseButtons({
  dose,
  locale: l,
  compact = false,
  hideUpcomingNotice = false,
  tone = "default",
  onSaved,
}: {
  dose: DueDose;
  locale: PatientLocale;
  compact?: boolean;
  hideUpcomingNotice?: boolean;
  tone?: "default" | "inverse";
  onSaved?: () => void;
}) {
  const router=useRouter();
  const [pending, start] = useTransition(),
    [message, setMessage] = useState(""), [failed,setFailed]=useState(false);
  const send = (status: "taken" | "skipped") =>
    start(async () => {
      setMessage("");
      const result = await safeRequest(() =>
        reportDose(dose.medication.id, dose.dueAt, status, dose.medication.planId, dose.revision ?? 0),
      );
      setFailed(!result?.ok);
      setMessage(
        result?.ok
          ? copy(l, "Saved as your report.", "Պահված է որպես ձեր գրառում։", "Сохранено как ваша запись.")
          : careSaveError(result,l),
      );
      if (result?.ok) onSaved?.();
    });
  if (dose.status === "upcoming" && hideUpcomingNotice) return null;
  if (dose.status === "upcoming")
    return (
      <p className={`text-caption ${tone === "inverse" ? "text-on-inverse-muted" : "text-muted-foreground"}`}>
        {copy(
          l,
          "Check-in opens at the scheduled time.",
          "Գրառումը հասանելի կլինի նշանակված ժամին։", "Запись станет доступна в назначенное время.",
        )}
      </p>
    );
  return (
    <div className="space-y-2">
      {/* The compact row keeps only the correction, so the state itself has to be said; "saved" is gone after a reload (QA a2-01). */}
      {compact && dose.status === "taken" && <p className="text-caption font-semibold">{copy(l, "Reported taken", "Գրանցված է՝ ընդունված", "Отмечено: принято")}</p>}
      {compact && dose.status === "skipped" && <p className="text-caption font-semibold">{copy(l, "Reported skipped", "Գրանցված է՝ բաց թողնված", "Отмечено: пропущено")}</p>}
      <div className="flex flex-wrap gap-2">
        {(!compact || dose.status !== "taken") && <Button
          className="h-auto min-h-11 max-w-full whitespace-normal break-words"
          variant={tone === "inverse" ? "secondary" : dose.status === "skipped" ? "outline" : "default"}
          disabled={pending || dose.status === "taken"}
          onClick={() => send("taken")}
        >
          {dose.status === "taken"
            ? copy(l, "Reported taken", "Գրանցված է՝ ընդունված", "Отмечено: принято")
            : dose.status === "skipped"
              ? copy(l, "Change to taken", "Փոխել՝ ընդունված", "Изменить на «Принято»")
            : copy(l, "Mark as taken", "Նշել որպես ընդունված", "Отметить как принятое")}
        </Button>}
        {(!compact || dose.status !== "skipped") && <Button
          className="h-auto min-h-11 max-w-full whitespace-normal break-words"
          variant={tone === "inverse" ? "outline-inverse" : "outline"}
          disabled={pending || dose.status === "skipped"}
          onClick={() => send("skipped")}
        >
          {dose.status === "skipped"
            ? copy(l, "Reported skipped", "Գրանցված է՝ բաց թողնված", "Отмечено: пропущено")
            : dose.status === "taken"
              ? copy(l, "Change to skipped", "Փոխել՝ բաց թողնված", "Изменить на «Пропущено»")
            : copy(l, "Mark as missed", "Նշել որպես բաց թողնված", "Отметить как пропущенное")}
        </Button>}
      </div>
      <p role="status" className={compact && !pending && !message ? "sr-only" : "text-caption"}>
        {pending ? copy(l, "Saving…", "Պահվում է…", "Сохраняется…") : message}
      </p>
      {failed && <Button className="h-auto min-h-11 max-w-full whitespace-normal break-words" variant={tone === "inverse" ? "outline-inverse" : "outline"} disabled={pending} onClick={()=>router.refresh()}>{copy(l,"Refresh current plan","Թարմացնել ընթացիկ պլանը", "Обновить текущий план")}</Button>}
    </div>
  );
}
export function PlanAcknowledgement({
  planId,
  locale: l,
  saveAction=acknowledgePlan,
}: {
  planId: string;
  locale: PatientLocale;
  saveAction?:typeof acknowledgePlan;
}) {
  const router=useRouter();
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  const sending=useRef(false);
  return (
    <div>
      <Button
        className="min-h-11"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if(sending.current)return;
            sending.current=true;
            const result=await safeRequest(()=>saveAction(planId));
            setError(result?.ok ? "" : careSaveError(result,l));
            sending.current=false;
          })
        }
      >
        {pending
          ? copy(l, "Saving…", "Պահվում է…", "Сохраняется…")
          : copy(l, "I have read my plan", "Կարդացել եմ պլանը", "Подтверждаю прочтение плана")}
      </Button>
      {error && (
        <div><p role="alert">{error}</p><Button variant="outline" disabled={pending} onClick={()=>router.refresh()}>{copy(l,"Refresh current plan","Թարմացնել ընթացիկ պլանը", "Обновить текущий план")}</Button></div>
      )}
    </div>
  );
}
