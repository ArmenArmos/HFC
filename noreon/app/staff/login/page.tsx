import type { Metadata } from "next";
import { headers } from "next/headers";
import { staffPortalForHost, demoStaffHostAllowed } from "@/lib/staff/hosts";
import { redirect, notFound } from "next/navigation";
import { getStaff } from "@/lib/staff/auth";
import { StaffLoginForm } from "@/components/staff/login-form";
import { fieldClass, buttonClass } from "@/components/staff/shell";

async function portalCopy() {
  const portal = staffPortalForHost((await headers()).get("host") ?? "");
  if (portal === "admin") return {
    title: "Noreon Backoffice",
    description: "For the Noreon operations team. Manage clinics, doctor accounts and client assignments.",
    button: "Sign in to Backoffice",
  };
  if (portal === "doctor") return {
    title: "Noreon Doctor Portal",
    description: "For Noreon doctors and nurses. Your role determines your assigned work.",
    button: "Sign in to Doctor Portal",
  };
  return { title: "Noreon Demo Staff", description: "Use your assigned demo account. Your role determines your demo workspace.", button: "Sign in to demo staff workspace" };
}

export async function generateMetadata(): Promise<Metadata> {
  const copy = await portalCopy();
  return { title: { absolute: `${copy.title} · Sign in` } };
}

export default async function StaffLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!demoStaffHostAllowed((await headers()).get("host") ?? "")) notFound();
  const identity = await getStaff();
  if (identity) redirect(identity.role === "admin" ? "/staff/backoffice" : identity.role === "nurse" ? "/staff/nurse" : "/staff/doctor");
  const { error } = await searchParams;
  const copy = await portalCopy();
  return <main className="flex min-h-screen items-center justify-center bg-muted/40 px-5 py-12">
    <section className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
      <p className="text-caption font-semibold uppercase tracking-[0.16em] text-primary">Staff sign in</p>
      <h1 className="mt-5 text-h1 font-semibold">{copy.title}</h1>
      <p className="mt-2 text-body2 text-muted-foreground">{copy.description}</p>
      <StaffLoginForm button={copy.button} fieldClass={fieldClass} buttonClass={buttonClass} initialError={!!error} />
      <p className="mt-6 text-caption text-muted-foreground">Staff access is managed by Noreon. There is no public registration.</p>
    </section>
  </main>;
}
