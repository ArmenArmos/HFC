import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function CaseUnavailable() {
  return (
    <section className="mx-auto max-w-xl space-y-4 rounded-xl border bg-card p-6">
      <h1 className="text-h1">Case unavailable</h1>
      <p className="text-body2 text-muted-foreground">
        Return to your workspace to see the members currently available to you.
      </p>
      <Link
        href="/staff/real/members"
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden />
        Back to workspace
      </Link>
    </section>
  );
}
