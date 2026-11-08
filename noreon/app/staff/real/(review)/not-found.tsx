import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRealStaff } from "@/lib/patient-care/clinical-case-repository";
import { staffLocale } from "@/lib/staff/staff-locale";
import { st } from "@/lib/staff/staff-locale-copy";

/** QA N-11: a missing or switched-off staff page keeps the staff shell, not the marketing header. */
export default async function StaffPageNotFound() {
  const { identity } = await requireRealStaff();
  const locale = await staffLocale(identity.role);
  const t = (en: string, hy: string, ru: string) => st(locale, en, hy, ru);
  return (
    <section className="mx-auto max-w-xl space-y-4 rounded-xl border bg-card p-6">
      <h1 className="text-h1">{t("Page not found", "Էջը չի գտնվել", "Страница не найдена")}</h1>
      <p className="text-body2 text-muted-foreground">
        {t("This page does not exist or is not switched on for your workspace.", "Այս էջը գոյություն չունի կամ միացված չէ ձեր աշխատատարածքի համար։", "Эта страница не существует или не включена для вашего рабочего пространства.")}
      </p>
      <Link
        href="/staff/real/members"
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden />
        {t("Back to workspace", "Վերադառնալ աշխատատարածք", "Вернуться в рабочее пространство")}
      </Link>
    </section>
  );
}
