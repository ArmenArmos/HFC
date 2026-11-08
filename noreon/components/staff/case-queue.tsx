"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { QueueItem, QueueStatus } from "@/lib/staff/queue";
import {SelectField} from '@/components/ui/select-field';
const labels: Record<QueueStatus, string> = {
  urgent: "Urgent",
  questions: "Questionnaire pending",
  tests: "Waiting for tests",
  review: "Needs review",
  consultation: "Consultation needed",
  published: "Published care",
};
export function CaseQueue({ items }: { items: QueueItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const matches = (i: QueueItem, f: string) =>
    f === "all" ||
    (f === "attention"
      ? i.status === "urgent" || i.overdue || i.owner === "You"
      : f === "overdue"
        ? i.overdue
        : i.status === f);
  const visible = items.filter(
    (i) =>
      matches(i, filter) &&
      `${i.name} ${i.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" aria-label="Priority views">
        {[
          ["all", "All cases"],
          ["attention", "Needs my attention"],
          ["published", "Published plans"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`min-h-12 rounded-lg px-5 text-body2 font-medium ${filter === key ? "bg-primary text-primary-foreground" : "border bg-background hover:bg-muted"}`}
          >
            {label}
            <span className="ml-3 opacity-70">
              {items.filter((i) => matches(i, key)).length}
            </span>
          </button>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border bg-background">
        <div className="flex flex-wrap items-end gap-4 border-b p-5">
          <label className="min-w-48 flex-1 text-caption">
            Find a member or case
            <input
              type="search"
              placeholder="Name or case ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mt-2 min-h-12 w-full rounded-md border bg-background px-4 text-body2"
            />
          </label>
          <label className="text-caption">
            Status
            <SelectField
              value={filter}
              onValueChange={setFilter}
              className="mt-2 min-w-56"
              options={[
                { value: "all", label: "All statuses" },
                { value: "attention", label: "Needs my attention" },
                { value: "overdue", label: "Overdue" },
                ...Object.entries(labels).map(([key, label]) => ({ value: key, label })),
              ]}
            />
          </label>
          <button
            disabled={pending}
            onClick={() => start(() => router.refresh())}
            className="min-h-12 rounded-md border px-4 text-body2"
          >
            {pending ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p
          role="status"
          className="px-5 py-3 text-caption text-muted-foreground"
        >
          {visible.length} of {items.length} cases · Urgent first, then overdue
          reviews
        </p>
        <div className="hidden grid-cols-[1fr_1.5fr_auto] gap-6 border-y bg-muted/40 px-5 py-3 text-caption text-muted-foreground lg:grid">
          <span>Member and status</span>
          <span>Next action</span>
          <span className="w-28">Review</span>
        </div>
        <div className="divide-y">
          {visible.map((i) => (
            <article
              key={i.id}
              className={`grid items-start gap-4 px-5 py-5 lg:grid-cols-[1fr_1.5fr_auto] lg:gap-6 ${i.status === "urgent" ? "border-l-4 border-l-destructive" : ""}`}
            >
              <div>
                <h2 className="text-body1 font-semibold">{i.name}</h2>
                <p
                  className={`mt-2 text-caption ${i.status === "urgent" ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                >
                  {labels[i.status]}
                </p>
                {i.due && (
                  <p className="mt-2 text-caption">
                    {i.overdue ? "Overdue since" : "Review by"} {i.due}
                  </p>
                )}
              </div>
              <div>
                <p className="text-caption text-muted-foreground">
                  {i.owner === "You"
                    ? "Your next action"
                    : i.owner === "None"
                      ? "No review action currently due"
                      : `Waiting on ${i.owner.toLowerCase()}`}
                </p>
                <p className="mt-1 text-body2 leading-relaxed">{i.next}</p>
              </div>
              <Link
                className={`inline-flex min-h-12 items-center justify-center rounded-md px-4 text-body2 font-medium ${i.owner === "You" ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}
                href={`/staff/case/${i.id}`}
              >
                {i.status === "urgent"
                  ? "Review urgent case"
                  : i.owner === "You"
                    ? "Review case"
                    : "Open case"}
              </Link>
            </article>
          ))}
        </div>
        {!visible.length && (
          <div className="p-8">
            <h2 className="text-h3">
              {items.length ? "No cases in this view" : "No assigned cases yet"}
            </h2>
            <p className="mt-2 text-body2 text-muted-foreground">
              {filter === "attention"
                ? "You have no cases requiring your action right now. Other cases may be waiting for questions or tests."
                : "New demo members are assigned automatically when your test account and clinic are active."}
            </p>
            <button
              className="mt-3 min-h-11 text-body2 underline"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Show all cases
            </button>
          </div>
        )}
      </section>
      <p className="text-caption text-muted-foreground">
        Review targets use Armenia time and exclude weekends.
      </p>
    </div>
  );
}
