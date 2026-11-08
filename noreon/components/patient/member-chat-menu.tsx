"use client";
import Link from "next/link";
import type { Route } from "next";
import { UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { copy } from "@/components/patient-care/common";
import {memberCardTarget} from "@/lib/zoe-chat-actions/everyday-contract";
import { CHIP } from "@/lib/zoe-chat-actions/copy";
import { SignOutButton } from "./sign-out-button";
import type { PatientLocale } from "@/lib/patient/copy";

export function MemberChatMenu({ locale: l, name }: { locale: PatientLocale; name?: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  // Closes without stopping the tap, so whatever is underneath still gets it.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, []);
  const links = [
    ["/patient/zoe?card=account", copy(l, "Me", "Իմ էջը", "Мой профиль")],
    ["/patient/zoe?card=progress", copy(l, "My progress", "Իմ առաջընթացը", "Мой прогресс")],
    ["/patient/zoe?card=medicines", copy(l, "My medicines", "Իմ դեղերը", "Мои лекарства")],
    ["/patient/zoe?card=results", copy(l, "My results", "Իմ արդյունքները", "Мои результаты")],
    ["/patient/zoe?card=plan", copy(l, "My plan", "Իմ պլանը", "Мой план")],
    ["/patient/zoe?card=previous_plans", copy(l, "Previous plans", "Նախորդ պլանները", "Предыдущие планы")],
    ["/patient/zoe?card=visit", copy(l, "My tests and visits", "Իմ հետազոտություններն ու այցերը", "Мои анализы и визиты")],
    ["/patient/zoe?card=bp_week", copy(l, "My blood pressure week", "Իմ ճնշման շաբաթը", "Моя неделя давления")],
    ["/patient/zoe?card=bp", copy(l, "Record a reading", "Գրանցել չափում", "Записать измерение")],
    ["/patient/zoe?card=account&section=reminders", copy(l, "My reminders", "Իմ հիշեցումները", "Мои напоминания")],
    ["/patient/zoe?card=lessons", copy(l, "My lessons", "Իմ դասերը", "Мои уроки")],
    ["/patient/zoe?card=earlier", copy(l, "Add earlier results", "Ավելացնել նախկին արդյունքներ", "Добавить предыдущие результаты")],
    ["/patient/zoe?card=result_history", copy(l, "My result history", "Իմ արդյունքների պատմությունը", "История моих результатов")],
    ["/patient/zoe?card=reports", copy(l, "My reports", "Իմ զեկույցները", "Мои отчёты")],
    ["/patient/zoe?card=questionnaire", copy(l, "Change my answers", "Փոխել պատասխանները", "Изменить ответы")],
    ["/patient/zoe?card=team", copy(l, "My care team", "Իմ խնամքի թիմը", "Моя медицинская команда")],
    ["/patient/zoe?card=help", copy(l, "Get help", "Օգնություն", "Получить помощь")],
    ["/patient/dashboard?view=classic", copy(l, "Open the previous pages", "Բացել նախորդ էջերը", "Открыть прежние страницы")],
  ];
  const hint = (href: string) => {
    if (href.includes('section=reminders')) return copy(l,'Choose reminder times','Ընտրել հիշեցման ժամերը','Выбрать время напоминаний');
    if (href.includes('questionnaire')) return copy(l,'Review and update answers','Դիտել և փոխել պատասխանները','Проверить и изменить ответы');
    if (href.includes('previous_plans')) return copy(l,'Plans shared before','Նախկինում ստացած պլանները','Ранее полученные планы');
    if (href.includes('bp_week')) return copy(l,'Your recent readings','Ձեր վերջին չափումները','Ваши недавние измерения');
    if (href.includes('lessons')) return copy(l,'Read and track lessons','Կարդալ և հետևել դասերին','Читать и отмечать уроки');
    if (href.includes('earlier')) return copy(l,'Save results you already have','Պահպանել առկա արդյունքները','Сохранить имеющиеся результаты');
    if (href.includes('result_history')) return copy(l,'Results over time','Արդյունքները ժամանակի ընթացքում','Результаты за всё время');
    if (href.includes('reports')) return copy(l,'Your saved reports','Ձեր պահպանված զեկույցները','Ваши сохранённые отчёты');
    if (href.includes('team')) return copy(l,'People supporting your care','Ձեր խնամքի մասնագետները','Специалисты вашей команды');
    return copy(l,'Use the earlier pages','Օգտվել նախորդ էջերից','Открыть прежние страницы');
  };
  const initials = name?.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("");
  return <details ref={menu} className="member-chat-menu" data-member-chat-menu onKeyDown={e => {
    if (e.key === "Escape" && menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); }
  }}>
    <summary aria-label={copy(l, "Open my menu", "Բացել իմ ընտրացանկը", "Открыть моё меню")}>
      {initials || <UserRound aria-hidden className="size-5" />}
    </summary>
    <nav aria-label={copy(l, "All your pages", "Ձեր բոլոր էջերը", "Все ваши страницы")} onClick={e => {
      if ((e.target as HTMLElement).closest("a") && menu.current) menu.current.open = false;
    }} onClickCapture={e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>("a");
      const kind = anchor?.dataset.chatAction ?? memberCardTarget(anchor?.getAttribute("href")??null);
      const reader = anchor?.getAttribute("href")?.match(/[?&]card=(progress|reports|questionnaire|care)(?:&|$)/)?.[1];
      if (window.location.pathname === "/patient/zoe" && !kind && reader) {
        const handled = !window.dispatchEvent(new CustomEvent("noreon:member-reader-open", {cancelable:true,detail:{card:reader}}));
        if (handled) e.preventDefault();
      }
      if (window.location.pathname === "/patient/zoe" && kind) {
        const section = anchor?.getAttribute("href")?.match(/[?&]section=(reminders|language|text-size|privacy)/)?.[1];
        const handled = !window.dispatchEvent(new CustomEvent(`noreon:member-${kind}-open`, { cancelable: true, detail: { section } }));
        if (handled) e.preventDefault();
      }
    }}>
      <div className="grid grid-cols-2 gap-1" data-menu-main>
        {links.filter(([href]) => ["account", "progress", "medicines", "results", "plan", "visit", "bp", "help"].some(kind => href === `/patient/zoe?card=${kind}`)).map(([href,label]) => <Link key={href} href={href as Route} className="!items-start rounded-md font-medium">{label}</Link>)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t pt-2">
        <Link href="/patient/zoe?card=account&section=language">{copy(l, "Language", "Լեզու", "Язык")}</Link>
        <SignOutButton locale={l}/>
      </div>
      <details className="mt-2 border-t pt-2" data-menu-more>
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-2 font-semibold">{copy(l, "More", "Ավելին", "Ещё")}<span aria-hidden>⌄</span></summary>
        <p className="px-2 pb-2 text-caption text-muted-foreground">{copy(l, "Your history, reminders and other tools", "Ձեր պատմությունը, հիշեցումներն ու այլ գործիքներ", "История, напоминания и другие инструменты")}</p>
        <div className="grid grid-cols-2 gap-1">
          {links.filter(([href]) => !["account", "progress", "medicines", "results", "plan", "visit", "bp", "help"].some(kind => href === `/patient/zoe?card=${kind}`)).map(([href,label]) => <Link key={href} href={href as Route} className="!flex-col !items-start rounded-md"><span className="font-medium">{label}</span><span className="text-caption text-muted-foreground">{hint(href)}</span></Link>)}
          {([
            ["dose", "/patient/medicines"], ["side_effect", "/patient/team?section=contact"],
            ["ldl", "/patient/progress"],
          ] as const).map(([kind, href]) => <Link key={kind} href={href} data-chat-action={kind} className="!flex-col !items-start rounded-md"><span className="font-medium">{CHIP[kind][l]}</span><span className="text-caption text-muted-foreground">{kind === "dose" ? copy(l,"Record a scheduled dose","Գրանցել դեղի ընդունումը","Отметить приём лекарства") : kind === "side_effect" ? copy(l,"Tell your care team","Տեղեկացնել խնամքի թիմին","Сообщить медицинской команде") : copy(l,"Your doctor-set goal","Ձեր բժշկի սահմանած նպատակը","Цель, установленная врачом")}</span></Link>)}
        </div>
      </details>
    </nav>
  </details>;
}
