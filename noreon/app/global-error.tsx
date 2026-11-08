"use client";

import { ReportError } from "@/components/report-error";

import "./globals.css";

/** Last-resort boundary for errors in the root layout; it replaces the whole document. */
export default function GlobalError({ error }: { error?: unknown }) {
  return (
    <html lang="hy">
      <body>
        <main className="mx-auto max-w-md space-y-5 px-5 py-16">
          <ReportError error={error} />
          <h1 className="text-h2">Չհաջողվեց բացել էջը։</h1>
          <p>We couldn’t open this page. Try again in a moment.</p>
          <p lang="ru">Не удалось открыть страницу. Попробуйте ещё раз через минуту.</p>
          <button type="button" onClick={() => window.location.reload()} className="min-h-12 rounded-md border px-4 text-body2">
            Փորձել կրկին / Try again / Попробовать снова
          </button>
        </main>
      </body>
    </html>
  );
}
