import Link from "next/link";
import { requireStaff } from "@/lib/staff/auth";
import { listCases } from "@/lib/staff/admin";
import type { DemoState } from "@/lib/patient/demo-model";
export default async function NurseQueue() {
  await requireStaff("nurse");
  const { cases } = await listCases();
  return <div className="space-y-6"><header><p className="text-caption text-muted-foreground">Nurse workspace</p><h1 className="text-h1">Your members</h1><p className="mt-2 text-body2 text-muted-foreground">Measurements, evidence collection and follow-up.</p></header>{cases.length ? <ul className="divide-y rounded-xl border bg-card">{cases.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-5"><h2 className="text-body1 font-medium">{(item.state as unknown as DemoState).state.profile?.name || "Member"}</h2><Link href={`/staff/case/${item.id}`} className="inline-flex min-h-11 items-center rounded-md border px-4 text-body2">Open member</Link></li>)}</ul> : <section className="rounded-xl border bg-card p-5"><h2 className="text-h3">No assigned members</h2><p className="mt-2 text-body2 text-muted-foreground">Your administrator assigns members within your clinic.</p></section>}</div>;
}
