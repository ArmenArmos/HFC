import { Bell, HeartPulse, History } from "lucide-react";
import { PressureDetailSummary, RecentReadings } from "@/components/patient-care/pressure-detail-summary";
import { ProgressNavigation } from "@/components/patient-care/progress-navigation";

import { PatientShell } from "@/components/patient/patient-shell";
import { carePageData } from "@/lib/patient-care/repository";
import { HealthTrends } from "@/components/patient-care/trends";
import { IconTile, RowLink, copy } from "@/components/patient-care/common";
import { BpWeekLink } from "@/components/bp-week/home-card";
import { CareRefresh } from "@/components/patient-care/controls";
export default async function Health() {
  const { profile, chartMeasurements } = await carePageData();
  const l = profile.locale;
  return (
    <PatientShell locale={l}>
      <CareRefresh />
      <div className="space-y-7">
        <header>
          <h1 className="text-h1">{copy(l, "My progress", "Իմ առաջընթացը", "Мой прогресс")}</h1>
          <p className="mt-2 text-body2 text-muted-foreground">
            {copy(
              l,
              "See your measurements and results over time.",
              "Տեսեք ձեր չափումների և արդյունքների փոփոխությունը։",
              "Посмотрите, как меняются ваши измерения и результаты со временем.",
            )}
          </p>
        </header>
        <ProgressNavigation locale={l} active="pressure" />
        <PressureDetailSummary
          measurements={chartMeasurements}
          locale={l}
          now={new Date()}
        />
        {chartMeasurements.length > 0 ? (
          <HealthTrends
            measurements={chartMeasurements}
            results={[]}
            mode="pressure"
            locale={l}
            now={new Date().toISOString()}
          />
        ) : (
          <section className="journey-card space-y-3"><IconTile icon={HeartPulse}/><h2 className="text-h2">{copy(l, "Your first reading", "Ձեր առաջին չափումը", "Ваше первое измерение")}</h2><p className="text-body2 text-muted-foreground">
            {copy(
              l,
              "Record your first blood pressure reading to start your history. Your charts will appear when data is available.",
              "Գրանցեք ճնշման առաջին չափումը՝ պատմությունը սկսելու համար։ Գրաֆիկները կհայտնվեն տվյալների առկայության դեպքում։",
              "Запишите первое измерение давления, чтобы начать историю. Графики появятся, когда будут доступны данные.",
            )}
          </p><p className="text-caption text-muted-foreground">{copy(l, "Recorded values, not a diagnosis.", "Գրանցված արժեքներ են, ոչ թե ախտորոշում։", "Это записанные значения, а не диагноз.")}</p></section>
        )}
        <RecentReadings measurements={chartMeasurements} locale={l} now={new Date()} />
        <section className="journey-card space-y-3">
          <h2 className="text-h2">{copy(l, "Your readings and reminders", "Ձեր չափումներն ու հիշեցումները", "Ваши измерения и напоминания")}</h2>
          <div className="divide-y">
            <BpWeekLink locale={l} />
            <RowLink href="/patient/account/reminders" icon={Bell}>{copy(l, "Set my BP reminders", "Կարգավորել ճնշման հիշեցումները", "Настроить напоминания об измерении давления")}</RowLink>
            <RowLink href="/patient/health/monitor" icon={HeartPulse}>{copy(l, "Connect my BP monitor", "Միացնել ճնշման սարքը", "Подключить мой тонометр")}</RowLink>
            <RowLink href="/patient/measurements" icon={History}>{copy(l, "My entered measurements", "Իմ մուտքագրած չափումները", "Мои введённые измерения")}</RowLink>
          </div>
        </section>

      </div>
    </PatientShell>
  );
}
