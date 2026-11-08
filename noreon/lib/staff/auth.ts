import "server-only";
import { noteActor } from "@/lib/observability/context";
import { cache } from "react";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { StaffIdentity, StaffRole } from "./types";
import { demoStaffHostAllowed } from "./hosts";

const COOKIE_NAME = "noreon-workspace-auth";
const roleValues: StaffRole[] = ["admin", "doctor", "nurse"];

function authConfig() {
  const url = process.env.NOREON_WORKSPACE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NOREON_WORKSPACE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export async function workspaceAuthClient() {
  if (!demoStaffHostAllowed((await headers()).get("host") ?? "")) return null;
  const config = authConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient<Database>(config.url, config.anonKey, {
    cookieOptions: { name: COOKIE_NAME, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) cookieStore.set(name, value, options);
        } catch {
          // Server components cannot write cookies; server actions can.
        }
      },
    },
  });
}

/** Privileged workspace access is enabled only for the explicitly shared demo deployment. */
export function workspaceAdmin(): SupabaseClient<Database> {
  if (process.env.NOREON_SHARED_DEMO !== "true") throw new Error("Staff workspace is unavailable");
  const url = process.env.NOREON_WORKSPACE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.NOREON_WORKSPACE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Staff workspace is unavailable");
  return createSupabaseClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// React cache is scoped to this server render, never shared between identities/requests.
export const getStaff = cache(async (): Promise<StaffIdentity | null> => {
  const host = (await headers()).get("host") ?? "";
  if (!demoStaffHostAllowed(host)) return null;
  const client = await workspaceAuthClient();
  if (!client) return null;
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user?.email) return null;
  noteActor("staff", user.id);

  try {
    const db = workspaceAdmin();
    const { data: member, error: memberError } = await db
      .from("workspace_staff")
      .select("user_id, role, display_name, clinic_id, active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError || !member?.active || !roleValues.includes(member.role as StaffRole)) return null;
    if (!demoStaffHostAllowed(host, member.role as StaffRole)) return null;
    if (member.role !== "admin") {
      if (!member.clinic_id) return null;
      const { data: clinic, error: clinicError } = await db.from("workspace_clinics").select("active").eq("id", member.clinic_id).maybeSingle();
      if (clinicError || !clinic?.active) return null;
    }
    return {
      id: user.id,
      email: user.email,
      name: member.display_name,
      role: member.role as StaffRole,
      clinicId: member.clinic_id,
    };
  } catch {
    return null;
  }
});

export async function requireStaff(role?: StaffRole): Promise<StaffIdentity> {
  const identity = await getStaff();
  if (!identity || (role && identity.role !== role)) redirect("/staff/login");
  return identity;
}
