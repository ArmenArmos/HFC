"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  ChevronDown,
  Leaf,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Utensils,
  Waves,
} from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { Button } from "@/components/ui/button";
import { copy } from "./common";

export function BreathingSession({ locale: l }: { locale: PatientLocale }) {
  const [elapsed, setElapsed] = useState(0),
    [running, setRunning] = useState(false);
  const complete = elapsed === 60;
  useEffect(() => {
    if (!running || complete) return;
    const timer = setInterval(
      () => setElapsed((value) => Math.min(60, value + 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [running, complete]);
  return (
    <section
      className="rounded-2xl bg-surface-subtle-teal p-5 sm:p-6"
      aria-label={copy(l, "Calming breathing", "Հանգիստ շնչառություն", "Спокойное дыхание")}
    >
      <header className="flex items-center gap-3">
        <Waves className="size-6 text-brand-teal" aria-hidden />
        <div>
          <h3 className="text-body1 font-semibold">
            {copy(l, "A minute to breathe", "Մեկ րոպե՝ շնչելու համար", "Минута для дыхания")}
          </h3>
          <p className="text-caption text-muted-foreground">
            {copy(
              l,
              "One minute · At your own pace",
              "Մեկ րոպե · Ձեր հարմար տեմպով", "Одна минута · В удобном для вас темпе",
            )}
          </p>
        </div>
      </header>
      <div className="my-5 flex flex-col items-center gap-3">
        <div className="relative grid size-32 place-items-center">
          <svg
            className="absolute inset-0 size-full -rotate-90 text-brand-teal"
            viewBox="0 0 120 120"
            aria-hidden
          >
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              opacity=".15"
            />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeDasharray="326.73"
              strokeDashoffset={326.73 * (1 - elapsed / 60)}
            />
          </svg>
          <div className="grid size-24 place-items-center rounded-full border border-brand-teal/30 text-brand-navy">
            <span className="font-display text-2xl font-bold tabular-nums">{`${Math.floor((60 - elapsed) / 60)}:${String((60 - elapsed) % 60).padStart(2, "0")}`}</span>
          </div>
        </div>
        <p className="text-center text-body2 font-medium" aria-live="polite">
          {complete
            ? copy(l, "Your minute is complete", "Ձեր րոպեն ավարտվել է", "Ваша минута завершена")
            : running
              ? copy(
                  l,
                  "Breathe gently, at a comfortable pace",
                  "Շնչեք մեղմ՝ հարմար տեմպով", "Дышите спокойно, в удобном темпе",
                )
              : elapsed
                ? copy(
                    l,
                    "Paused. Continue when you are ready.",
                    "Դադարեցված է։ Շարունակեք, երբ պատրաստ եք։", "Пауза. Продолжите, когда будете готовы.",
                  )
                : copy(
                    l,
                    "Settle in. Start when you are ready.",
                    "Հարմար տեղավորվեք։ Սկսեք, երբ պատրաստ եք։", "Устройтесь удобно. Начните, когда будете готовы.",
                  )}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          className="min-h-11"
          disabled={complete}
          onClick={() => setRunning(!running)}
        >
          {running ? <Pause aria-hidden /> : <Play aria-hidden />}
          {running
            ? copy(l, "Pause", "Դադար", "Приостановить")
            : elapsed
              ? copy(l, "Resume", "Շարունակել", "Продолжить")
              : copy(l, "Start", "Սկսել", "Начать")}
        </Button>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setRunning(false);
            setElapsed(0);
          }}
        >
          <RotateCcw aria-hidden />
          {copy(l, "Reset", "Վերակայել", "Сбросить")}
        </Button>
      </div>
      <p className="mt-4 text-center text-caption text-muted-foreground">
        {copy(
          l,
          "Let your breath move naturally. Stop if this feels uncomfortable.",
          "Շնչեք բնական ձևով։ Դադարեցրեք, եթե անհարմար եք զգում։", "Дышите естественно. Остановитесь, если почувствуете дискомфорт.",
        )}
      </p>
    </section>
  );
}

function Tip({
  title,
  subtitle,
  children,
  image,
  ingredients,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  image?: string;
  ingredients?: string[];
  icon: typeof Leaf;
}) {
  return (
    <details
      className="group overflow-hidden rounded-2xl border border-border bg-card"
      // Native disclosure can be opened before React hydrates. Preserve that choice.
      suppressHydrationWarning
    >
      <summary className="block cursor-pointer list-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        {image && (
          <Image
            src={image}
            alt=""
            width={720}
            height={440}
            className="h-44 w-full object-cover"
          />
        )}
        <span className="flex min-h-16 items-center gap-3 p-4">
          <Icon className="size-5 shrink-0 text-brand-teal" aria-hidden />
          <span className="min-w-0 flex-1">
            <strong className="block text-body2">{title}</strong>
            <span className="mt-1 block text-caption text-muted-foreground">
              {subtitle}
            </span>
          </span>
          <ChevronDown
            className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </span>
        {ingredients && (
          <span className="flex flex-wrap gap-2 px-4 pb-4">
            {ingredients.map((ingredient) => (
              <span
                key={ingredient}
                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-subtle-teal px-3 py-2 text-caption"
              >
                <Leaf className="size-4 text-brand-teal" aria-hidden />
                {ingredient}
              </span>
            ))}
          </span>
        )}
      </summary>
      <div className="space-y-3 px-4 pb-5 pt-2 text-body2 text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

/** `hasPlan`: a published care plan exists. Without one, no line may refer to an agreed diet or
 *  activity plan the member does not have (Gohar D-003). */
export function MealIdeas({ locale: l, hasPlan }: { locale: PatientLocale; hasPlan: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Tip
        title={copy(
          l,
          "Lentil and vegetable bowl",
          "Ոսպով և բանջարեղենով ուտեստ", "Чечевица с овощами",
        )}
        subtitle={copy(
          l,
          "About 20 minutes · Meal idea",
          "Մոտ 20 րոպե · Ուտեստի գաղափար", "Около 20 минут · Идея блюда",
        )}
        icon={Utensils}
        ingredients={[
          copy(l, "Lentils", "Ոսպ", "Чечевица"),
          copy(l, "Vegetables", "Բանջարեղեն", "Овощи"),
          copy(l, "Greens", "Կանաչեղեն", "Зелень"),
        ]}
      >
        <p>
          {copy(
            l,
            "Warm cooked lentils with vegetables you enjoy. Add leafy greens and a little olive oil, then serve in a bowl.",
            "Տաքացրեք եփած ոսպը ձեր նախընտրած բանջարեղենի հետ։ Ավելացրեք կանաչեղեն և մի քիչ ձիթապտղի յուղ, ապա մատուցեք ամանի մեջ։", "Разогрейте варёную чечевицу с овощами, которые вам нравятся. Добавьте листовую зелень и немного оливкового масла, затем подайте в миске.",
          )}
        </p>
        <p>
          {hasPlan
            ? copy(
                l,
                "Choose ingredients and portions that fit your agreed plan and dietary needs.",
                "Ընտրեք ձեր համաձայնեցված պլանին և սննդային կարիքներին համապատասխան բաղադրիչներ ու չափաբաժիններ։", "Выбирайте ингредиенты и порции в соответствии с согласованным планом и вашими потребностями в питании.",
              )
            : copy(
                l,
                "Choose ingredients and portions that fit your dietary needs.",
                "Ընտրեք ձեր սննդային կարիքներին համապատասխան բաղադրիչներ ու չափաբաժիններ։", "Выбирайте ингредиенты и порции в соответствии с вашими потребностями в питании.",
              )}
        </p>
      </Tip>
      <Tip
        title={copy(l, "Savory oats with greens", "Վարսակ՝ կանաչեղենով", "Несладкая овсянка с зеленью")}
        subtitle={copy(
          l,
          "About 15 minutes · Meal idea",
          "Մոտ 15 րոպե · Ուտեստի գաղափար", "Около 15 минут · Идея блюда",
        )}
        icon={Leaf}
        ingredients={[
          copy(l, "Oats", "Վարսակ", "Овсяные хлопья"),
          copy(l, "Greens", "Կանաչեղեն", "Зелень"),
          copy(l, "Herbs", "Կանաչի", "Пряные травы"),
        ]}
      >
        <p>
          {copy(
            l,
            "Cook oats, stir in softened greens and add herbs you like. Adjust the texture with water while cooking.",
            "Եփեք վարսակը, ավելացրեք փափկեցրած կանաչեղեն և ձեր սիրած կանաչիները։ Եփելիս ջրով կարգավորեք խտությունը։", "Сварите овсяные хлопья, вмешайте размягчённую зелень и добавьте любимые пряные травы. Во время приготовления добавляйте воду до желаемой густоты.",
          )}
        </p>
        <p>
          {hasPlan
            ? copy(
                l,
                "This is an idea, not a daily portion or water target. Follow your agreed nutrition plan.",
                "Սա գաղափար է, ոչ օրական չափաբաժնի կամ ջրի թիրախ։ Հետևեք ձեր համաձայնեցված սննդակարգին։", "Это идея блюда, а не дневная норма еды или воды. Следуйте согласованному плану питания.",
              )
            : copy(
                l,
                "This is an idea, not a daily portion or water target.",
                "Սա գաղափար է, ոչ օրական չափաբաժնի կամ ջրի թիրախ։", "Это идея блюда, а не дневная норма еды или воды.",
              )}
        </p>
      </Tip>
    </div>
  );
}
export function MovementTip({ locale: l, hasPlan }: { locale: PatientLocale; hasPlan: boolean }) {
  return (
    <Tip
      title={copy(
        l,
        "A comfortable movement break",
        "Հարմար շարժման ընդմիջում", "Перерыв для комфортного движения",
      )}
      subtitle={hasPlan
        ? copy(l, "A few minutes · Follow your activity plan", "Մի քանի րոպե · Հետևեք ձեր շարժման պլանին", "Несколько минут · Следуйте вашему плану активности")
        : copy(l, "A few minutes · At your own pace", "Մի քանի րոպե · Ձեր հարմար տեմպով", "Несколько минут · В удобном для вас темпе")}
      image="/brand/photo/woman-stretching-golden.png"
      icon={Leaf}
    >
      <p>
        {hasPlan
          ? copy(
              l,
              "If your plan allows, try gentle shoulder rolls, seated ankle circles or a short comfortable walk. Choose what feels manageable today.",
              "Եթե ձեր պլանը թույլ է տալիս, փորձեք ուսերի մեղմ շրջանաձև շարժումներ, նստած՝ կոճերի պտույտներ կամ կարճ, հարմար քայլք։ Ընտրեք այն, ինչ այսօր ձեզ հարմար է։", "Если ваш план позволяет, попробуйте мягкие круговые движения плечами, вращения стопами сидя или короткую прогулку в удобном темпе. Выберите то, что вам по силам сегодня.",
            )
          : copy(
              l,
              "Try gentle shoulder rolls, seated ankle circles or a short comfortable walk. Choose what feels manageable today, and stop if you feel unwell.",
              "Փորձեք ուսերի մեղմ շրջանաձև շարժումներ, նստած՝ կոճերի պտույտներ կամ կարճ, հարմար քայլք։ Ընտրեք այն, ինչ այսօր ձեզ հարմար է, և դադարեցրեք, եթե վատ եք զգում։", "Попробуйте мягкие круговые движения плечами, вращения стопами сидя или короткую прогулку в удобном темпе. Выберите то, что вам по силам сегодня, и остановитесь, если почувствуете себя плохо.",
            )}
      </p>
    </Tip>
  );
}
export function EveningTip({ locale: l }: { locale: PatientLocale }) {
  return (
    <Tip
      title={copy(
        l,
        "Make room for a quieter evening",
        "Ժամանակ հատկացրեք հանգիստ երեկոյին", "Найдите время для спокойного вечера",
      )}
      subtitle={copy(l, "A wind-down idea", "Հանգստանալու գաղափար", "Идея для отдыха")}
      icon={Moon}
    >
      <p>
        {copy(
          l,
          "Try a calmer activity before bed. You might dim the lights, put your phone aside and choose a quiet routine you enjoy.",
          "Քնելուց առաջ փորձեք ավելի հանգիստ զբաղմունք։ Կարող եք մեղմացնել լույսը, մի կողմ դնել հեռախոսը և ընտրել ձեզ հաճելի հանգիստ առօրյա։", "Перед сном выберите спокойное занятие. Можно приглушить свет, отложить телефон и заняться чем-то спокойным и приятным.",
        )}
      </p>
    </Tip>
  );
}
export function MeditationTip({ locale: l }: { locale: PatientLocale }) {
  return (
    <Tip
      title={copy(l, "A quiet moment", "Հանգիստ պահ", "Минута покоя")}
      subtitle={copy(
        l,
        "Two minutes · Guided text",
        "Երկու րոպե · Ուղղորդող տեքստ", "Две минуты · Текст с подсказками",
      )}
      image="/brand/photo/woman-sunrise-breath.png"
      icon={Waves}
    >
      <p>
        {copy(
          l,
          "Sit comfortably and notice the support beneath you. Bring your attention to the sounds around you, then to your natural breath. When your mind wanders, gently return to what you notice.",
          "Հարմար նստեք և զգացեք ձեր տակ եղած հենարանը։ Ուշադրություն դարձրեք շրջապատի ձայներին, ապա՝ ձեր բնական շնչառությանը։ Երբ մտքերը շեղվեն, մեղմորեն վերադարձեք ձեր զգացածին։", "Сядьте удобно и почувствуйте опору под собой. Обратите внимание на звуки вокруг, затем на своё естественное дыхание. Когда мысли отвлекают, мягко возвращайте внимание к своим ощущениям.",
        )}
      </p>
    </Tip>
  );
}
