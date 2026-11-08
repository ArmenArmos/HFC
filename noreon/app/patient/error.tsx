"use client";
import { ReportError } from "@/components/report-error";
import { Button } from "@/components/ui/button";
export default function PatientError({ error, retry }: { error?: unknown; retry: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-5 px-5 py-16">
      <ReportError error={error} />
      <h1 className="text-h2">Չհաջողվեց բացել ձեր տվյալները։</h1>
      <p>We couldn’t load your information. Try again in a moment.</p>
      <p lang="ru">Не удалось загрузить ваши данные. Попробуйте ещё раз через минуту.</p>
      <Button onClick={retry}>Փորձել կրկին / Try again / Попробовать снова</Button>
      {/* This page opens without auth or data, so it is the one place the urgent screens can land during an outage (Astra R3). */}
      <a href="tel:103" className="emergency-call flex min-h-12 w-full items-center justify-center rounded-md px-5 py-3 text-center">Շտապ օգնություն 103 / Emergency 103 / Скорая помощь 103</a>
    </div>
  );
}
