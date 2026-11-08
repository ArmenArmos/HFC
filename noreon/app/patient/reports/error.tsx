"use client";
import { ReportError as ReportToSentry } from "@/components/report-error";

import { Button } from "@/components/ui/button";

export default function ReportError({ error }: { error?: unknown } = {}) {
  return (
    <div className="mx-auto max-w-md space-y-5 px-5 py-16">
      <ReportToSentry error={error} />
      <h1 className="text-h2">Չհաջողվեց բացել ձեր տվյալները։</h1>
      <p>We couldn’t load your information. Try again in a moment.</p>
      <p lang="ru">Не удалось загрузить ваши данные. Попробуйте ещё раз через минуту.</p>
      <Button onClick={() => window.location.reload()}>
        Փորձել կրկին / Try again / Попробовать снова
      </Button>
    </div>
  );
}
