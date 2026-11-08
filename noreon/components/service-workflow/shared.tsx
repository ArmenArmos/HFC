"use client";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { serviceCommand } from "@/app/patient/service/actions";
import { safeRequest } from "@/lib/patient/transport";
import type {
  ServiceCommand,
  ServiceWorkflow,
} from "@/lib/service-workflow/types";
import { pick, type Locale } from "@/lib/locale";
import { CareLink } from "@/components/patient-care/common";
export const inputClass =
  "w-full min-h-11 rounded-md border bg-background px-3 py-2 text-body2 focus-visible:outline-2 focus-visible:outline-ring";
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export const quietClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-body2 font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring";
export function useWorkflowCommand(workflow: ServiceWorkflow) {
  const router = useRouter();
  const path = usePathname();
  const caseId = path.startsWith("/staff/case/") ? path.split("/")[3] : undefined;
  const [pending, start] = useTransition();
  const [activeCommand, setActiveCommand] = useState<ServiceCommand["type"] | null>(null);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  function run(command: ServiceCommand, done?: () => void | false | Promise<void | false>, failed?: () => void | Promise<void>) {
    if (inFlight.current || pending) return;
    inFlight.current = true;
    setActiveCommand(command.type);
    setError("");
    start(async () => {
      try {
        const result = await safeRequest(() =>
          serviceCommand(command, workflow.revision, caseId),
        );
        if (!result || !result.ok) {
          setError(
            result && "error" in result && result.error
              ? result.error
              : "This change could not be saved. Refresh and try again.",
          );
          await failed?.();
          return;
        }
        if (await done?.() === false) return;
        router.refresh();
      } finally {
        inFlight.current = false;
        setActiveCommand(null);
      }
    });
  }
  return { run, pending, activeCommand, error };
}
export function ActionError({ error }: { error: string }) {
  return error ? (
    <p
      role="alert"
      className="rounded-md border border-destructive bg-destructive/10 p-3 text-body2"
    >
      {error}
    </p>
  ) : null;
}
export function StaffShell({
  role,
  children,
}: {
  role: "doctor" | "backoffice";
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <p className="text-h2">
            Noreon{" "}
            <span className="text-body2 font-normal">
              / {role === "doctor" ? "Doctor workspace" : "Operations"}
            </span>
          </p>
          <span className="rounded-md border px-3 py-1 text-caption">
            Simulation
          </span>
        </div>
      </header>
      <div className="border-b bg-surface-subtle-teal">
        <div className="mx-auto max-w-7xl px-6 py-3 text-caption">
          Demo case. No real doctor, laboratory or member is contacted.
        </div>
      </div>
      <nav
        aria-label="Demo workspaces"
        className="mx-auto flex max-w-7xl flex-wrap gap-x-7 px-6 py-3"
      >
        <CareLink href="/patient/dashboard">Member view</CareLink>
        <CareLink href="/patient/doctor">Doctor workspace</CareLink>
        <CareLink href="/patient/backoffice">Operations</CareLink>
      </nav>
      <main className="mx-auto max-w-7xl space-y-7 px-6 py-6 pb-16">
        {children}
      </main>
    </div>
  );
}
export function SlotFields({
  min,
  prefix,
  locale = "en",
}: {
  min: string;
  prefix: string;
  locale?: Locale;
}) {
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2 text-body2" htmlFor={`${prefix}-day`}>
        <span>{t("Date", "Ամսաթիվ", "Дата")}</span>
        <input
          className={inputClass}
          id={`${prefix}-day`}
          name="day"
          type="date"
          min={min}
          defaultValue={min}
          required
        />
      </label>
      <label className="space-y-2 text-body2" htmlFor={`${prefix}-time`}>
        <span>{t("Time in Armenia (UTC+4)", "Ժամը Հայաստանում (UTC+4)", "Время в Армении (UTC+4)")}</span>
        <select
          className={inputClass}
          id={`${prefix}-time`}
          name="time"
          defaultValue="09:00"
        >
          <option>09:00</option>
          <option>11:00</option>
          <option>14:00</option>
        </select>
      </label>
    </div>
  );
}
export function formTime(data: FormData) {
  return `${data.get("day")}T${data.get("time")}:00+04:00`;
}
