import { ShieldCheck } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { tx } from "@/lib/patient/copy";
import { zoeName } from "@/lib/brand";

/**
 * "Meet Zoe" (prototype pair 03) without the prototype's unsigned claims: no named staff, no reply
 * times and no "AI" wording (Zoe AI consent and copy are pending sign-off). Staging draft copy for
 * Armen/Tatevik.
 */
export function MeetZoe({ locale: l, name, team: showTeam = true }: { locale: PatientLocale; name?: string; team?: boolean }) {
  const first = name?.trim().split(/\s+/)[0];
  const team: { key: string; badge: string; title: string; text: string }[] = [
    { key: "zoe", badge: "", title: zoeName(l), text: tx(l, "Պարզ բառերով բացատրում է ձեր հաջորդ քայլը և պատասխանում հաճախ տրվող հարցերին։", "Explains your next step in plain words and answers common questions.", "Объясняет ваш следующий шаг простыми словами и отвечает на частые вопросы.") },
    { key: "nurse", badge: tx(l, "Բ", "N", "М"), title: tx(l, "Բուժքույրը", "Your nurse", "Ваша медсестра"), text: tx(l, "Վերցնում է ձեր նմուշները և օգնում գործնական հարցերում։", "Takes your samples and helps with practical things.", "Берёт ваши образцы и помогает с практическими вопросами.") },
    { key: "doctor", badge: tx(l, "Բժ", "Dr", "Вр"), title: tx(l, "Ձեր բժիշկը", "Your doctor", "Ваш врач"), text: tx(l, "Դիտում է ձեր արդյունքները և որոշում ձեր խնամքի ծրագիրը։", "Looks at your results and decides your care plan.", "Изучает ваши результаты и определяет ваш план лечения.") },
  ];
  return (
    <section aria-labelledby="meet-zoe-title" className="meet-zoe">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="journey-orb meet-zoe-orb" aria-hidden />
        <h2 id="meet-zoe-title" className="text-h1">
          {first ? tx(l, `Բարև, ${first}։ Ես Զոյան եմ։`, `Hello, ${first}. I am Zoe.`, `Здравствуйте, ${first}. Я Зоя.`) : tx(l, "Բարև։ Ես Զոյան եմ։", "Hello. I am Zoe.", "Здравствуйте. Я Зоя.")}
        </h2>
        <p className="text-body1 text-muted-foreground">{tx(l, "Ես ձեր խնամքի օգնականն եմ։", "I am your care assistant.", "Я ваш помощник по заботе о здоровье.")}</p>
      </div>
      {showTeam && <div className="journey-card">
        <h3 className="text-h2">{tx(l, "Ձեր թիմը, և ով ինչ է անում", "Your team, and who does what", "Ваша медицинская команда и задачи каждого")}</h3>
        <ul className="flex flex-col gap-4">
          {team.map((m) => (
            <li key={m.key} className="flex items-start gap-3">
              {m.key === "zoe" ? <span className="journey-orb meet-zoe-avatar" aria-hidden /> : <span className="meet-zoe-avatar" data-role={m.key} aria-hidden>{m.badge}</span>}
              <div className="min-w-0">
                <p className="text-body1 font-semibold">{m.title}</p>
                <p className="text-body2 text-muted-foreground">{m.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>}
      <p className="meet-zoe-safety">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          <strong>{tx(l, "Զոյան երբեք չի սկսում, դադարեցնում կամ փոխում դեղը։", "Zoe never starts, stops or changes a medicine.", "Зоя никогда не назначает, не отменяет и не меняет лекарства.")}</strong>{" "}
          {tx(l, "Բժշկական որոշումները կայացնում է ձեր բժիշկը։", "Medical decisions are made by your doctor.", "Медицинские решения принимает ваш врач.")}
        </span>
      </p>
    </section>
  );
}
