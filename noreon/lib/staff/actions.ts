"use server";

import { loggedAction } from "@/lib/observability/with-logging";
import { claimAdmission, requestAdmissionIdentity } from "@/lib/security/admission";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { workspaceAdmin, workspaceAuthClient } from "./auth";
import { requireStaff } from "./auth";
import { demoStaffHostAllowed } from "./hosts";
import type { StaffRole } from "./types";
import type { Route } from "next";

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string): string {
  const result = value(formData, key);
  if (!result) throw new Error(`Missing ${key}`);
  return result;
}

export type BackofficeFormState = {
  status: "idle" | "success" | "error";
  message: string;
  values?: Record<string, string>;
};

function submittedValues(formData: FormData, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, value(formData, key)]));
}
function formError(error: unknown, fallback: string): BackofficeFormState {
  return { status: "error", message: error instanceof Error ? error.message : fallback };
}

const LOGIN_FAILED: Route = "/staff/login?error=1";
/** One staff sign-in attempt: the destination after success, or LOGIN_FAILED. */
async function attemptLogin(formData: FormData): Promise<Route> {
  const host = (await headers()).get("host") ?? "";
  if (!demoStaffHostAllowed(host)) return LOGIN_FAILED;
  const email = value(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const client = await workspaceAuthClient();
  if (!client || !email || !password) return LOGIN_FAILED;
  try {
    const admin = workspaceAdmin();
    const identity = await requestAdmissionIdentity(email);
    await claimAdmission("login", identity);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user) return LOGIN_FAILED;
    const { data: member, error: memberError } = await admin.from("workspace_staff").select("role,active,clinic_id").eq("user_id", data.user.id).maybeSingle();
    if (memberError || !member?.active || (!["admin","doctor","nurse"].includes(member.role) || (member.role !== "admin" && !member.clinic_id))) {
      await client.auth.signOut({ scope: "local" });
      return LOGIN_FAILED;
    }
    if (!demoStaffHostAllowed(host, member.role as StaffRole)) {
      await client.auth.signOut({ scope: "local" });
      return LOGIN_FAILED;
    }
    if (member.role !== "admin") {
      const { data: clinic } = await admin.from("workspace_clinics").select("active").eq("id", member.clinic_id!).maybeSingle();
      if (!clinic?.active) {
        await client.auth.signOut({ scope: "local" });
        return LOGIN_FAILED;
      }
    }
    await admin.rpc("clear_workspace_login_source", { p_source: identity.source, p_email: identity.email! });
    return member.role === "admin" ? "/staff/backoffice" : member.role === "nurse" ? "/staff/nurse" : "/staff/doctor";
  } catch {
    return LOGIN_FAILED;
  }
}
export const login = loggedAction("login",async function login(formData: FormData): Promise<void> {
  redirect(await attemptLogin(formData));
});
export type StaffLoginState = { failed: number };
/** The sign-in form's action (QA 188): a failed attempt returns to the form instead of reloading
 * the page, so the form keeps the email (never in the URL) and clears only the password. */
export const loginForm = loggedAction("loginForm",async function loginForm(previous: StaffLoginState, formData: FormData): Promise<StaffLoginState> {
  const destination = await attemptLogin(formData);
  if (destination === LOGIN_FAILED) return { failed: previous.failed + 1 };
  redirect(destination);
});

export const signOut = loggedAction("signOut",async function signOut(): Promise<void> {
  const host = (await headers()).get("host") ?? "";
  if (!demoStaffHostAllowed(host)) redirect("/staff/login");
  const client = await workspaceAuthClient();
  await client?.auth.signOut({ scope: "local" });
  redirect("/staff/login");
});

export const createClinic = loggedAction("createClinic",async function createClinic(_previous: BackofficeFormState, formData: FormData): Promise<BackofficeFormState> {
  await requireStaff("admin");
  const values = submittedValues(formData, ["name", "address"]);
  try {
    const db = workspaceAdmin();
    const name = required(formData, "name");
    const address = required(formData, "address");
    const { error } = await db.from("workspace_clinics").insert({ name, address, active: true });
    if (error) throw new Error("Could not create clinic. Check the details and try again.");
    revalidatePath("/staff/backoffice");
    for (const section of ["cases", "doctors", "clinics"]) revalidatePath(`/staff/backoffice/${section}`);
    return { status: "success", message: "Clinic created." };
  } catch (error) { return { ...formError(error, "Could not create clinic. Try again."), values }; }
});

export const editClinic = loggedAction("editClinic",async function editClinic(_previous: BackofficeFormState, formData: FormData): Promise<BackofficeFormState> {
  await requireStaff("admin");
  const values = submittedValues(formData, ["name", "address", "active"]);
  try {
    const id = required(formData, "clinicId");
    const activeField = value(formData, "active");
    const active = activeField === "true" || activeField === "on";
    const { error } = await workspaceAdmin().from("workspace_clinics").update({ name: required(formData, "name"), address: required(formData, "address"), active }).eq("id", id);
    if (error) throw new Error("Could not update clinic. Check the details and try again.");
    revalidatePath("/staff/backoffice");
    for (const section of ["cases", "doctors", "clinics"]) revalidatePath(`/staff/backoffice/${section}`);
    return { status: "success", message: "Clinic updated." };
  } catch (error) { return { ...formError(error, "Could not update clinic. Try again."), values }; }
});

export const createDoctor = loggedAction("createDoctor",async function createDoctor(_previous: BackofficeFormState, formData: FormData): Promise<BackofficeFormState> {
  await requireStaff("admin");
  const values = submittedValues(formData, ["name", "email", "clinicId"]);
  try {
    const email = required(formData, "email").toLowerCase();
    const password = String(formData.get("password") ?? "");
    const name = required(formData, "name");
    const clinicId = required(formData, "clinicId");
    if (password.length < 12) throw new Error("Password must be at least 12 characters");
    const db = workspaceAdmin();
    const { data: clinic, error: clinicError } = await db.from("workspace_clinics").select("id").eq("id", clinicId).eq("active", true).maybeSingle();
    if (clinicError || !clinic) throw new Error("Choose an active clinic");
    const { data: created, error: authError } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError || !created.user) throw new Error("Could not create doctor account. The email may already be in use.");
    const { error: profileError } = await db.from("workspace_staff").insert({ user_id: created.user.id, role: "doctor", display_name: name, clinic_id: clinicId, active: true });
    if (profileError) {
      await db.auth.admin.deleteUser(created.user.id);
      throw new Error("Could not create doctor account. Check the details and try again.");
    }
    revalidatePath("/staff/backoffice");
    for (const section of ["cases", "doctors", "clinics"]) revalidatePath(`/staff/backoffice/${section}`);
    return { status: "success", message: "Doctor account created." };
  } catch (error) { return { ...formError(error, "Could not create doctor account. Try again."), values }; }
});

export const activateDoctor = loggedAction("activateDoctor",async function activateDoctor(_previous: BackofficeFormState, formData: FormData): Promise<BackofficeFormState> {
  await requireStaff("admin");
  try {
    const id = required(formData, "doctorId");
    const activeValue = value(formData, "active");
    const active = activeValue === "true" || activeValue === "on";
    const { error } = await workspaceAdmin().from("workspace_staff").update({ active }).eq("user_id", id).eq("role", "doctor");
    if (error) throw new Error("Could not update doctor access. Try again.");
    revalidatePath("/staff/backoffice");
    for (const section of ["cases", "doctors", "clinics"]) revalidatePath(`/staff/backoffice/${section}`);
    return { status: "success", message: active ? "Doctor activated." : "Doctor deactivated." };
  } catch (error) { return formError(error, "Could not update doctor access. Try again."); }
});

export const assignCase = loggedAction("assignCase",async function assignCase(_previous: BackofficeFormState, formData: FormData): Promise<BackofficeFormState> {
  const actor = await requireStaff("admin");
  const values = submittedValues(formData, ["doctorId"]);
  try {
    const caseId = required(formData, "caseId");
    const db = workspaceAdmin();
    const doctorId = required(formData, "doctorId");
    const { data: doctor, error: doctorError } = await db.from("workspace_staff").select("user_id,active,clinic_id").eq("user_id", doctorId).eq("role", "doctor").maybeSingle();
    if (doctorError || !doctor?.active || !doctor.clinic_id) throw new Error("Choose an active doctor");
    const { data: clinic, error: clinicError } = await db.from("workspace_clinics").select("active").eq("id", doctor.clinic_id).maybeSingle();
    if (clinicError || !clinic?.active) throw new Error("Choose an active doctor at an active clinic");
    const { data: current, error: caseError } = await db.from("workspace_cases").select("revision").eq("id", caseId).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (caseError || !current) throw new Error("Could not assign case. It may have expired.");
    const { data: revision, error } = await db.rpc("workspace_assign_case_audited", {
      p_actor: actor.id,
      p_id: caseId,
      p_expected_revision: current.revision,
      p_doctor_id: doctorId,
    });
    if (error || typeof revision !== "number" || revision < 0) throw new Error("Case changed. Refresh and try again.");
    revalidatePath("/staff/backoffice");
    for (const section of ["cases", "doctors", "clinics"]) revalidatePath(`/staff/backoffice/${section}`);
    revalidatePath("/staff/doctor");
    return { status: "success", message: "Case assignment updated." };
  } catch (error) { return { ...formError(error, "Could not assign case. Refresh and try again."), values }; }
});

/** Separate fixed-role action: a submitted role cannot elevate a nurse account. */
export const createNurse = loggedAction("createNurse",async function createNurse(_previous:BackofficeFormState,formData:FormData):Promise<BackofficeFormState> {
 await requireStaff('admin');
 const values=submittedValues(formData,['name','email','clinicId']);
 try {
  const email=required(formData,'email').toLowerCase(),name=required(formData,'name'),clinicId=required(formData,'clinicId');
  const password=String(formData.get('password')??'');
  if(password.length<12)throw Error('Password must be at least 12 characters');
  const db=workspaceAdmin();
  const clinic=await db.from('workspace_clinics').select('id').eq('id',clinicId).eq('active',true).maybeSingle();
  if(clinic.error||!clinic.data)throw Error('Choose an active clinic');
  const created=await db.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error||!created.data.user)throw Error('Could not create nurse account. The email may already be in use.');
  const result=await db.from('workspace_staff').insert({user_id:created.data.user.id,role:'nurse',display_name:name,clinic_id:clinicId,active:true});
  if(result.error){await db.auth.admin.deleteUser(created.data.user.id);throw Error('Could not create nurse account. Check the details and try again.');}
  revalidatePath('/staff/backoffice','layout');return {status:'success',message:'Nurse account created.'};
 }catch(error){return {...formError(error,'Could not create nurse account. Try again.'),values};}
});
export const activateNurse = loggedAction("activateNurse",async function activateNurse(_previous:BackofficeFormState,formData:FormData):Promise<BackofficeFormState> {
 await requireStaff('admin');
 try {
  const id=required(formData,'nurseId'),activeValue=value(formData,'active'),active=activeValue==='true'||activeValue==='on';
  const db=workspaceAdmin();
  const current=await db.from('workspace_staff').select('clinic_id').eq('user_id',id).eq('role','nurse').single();
  if(current.error||!current.data.clinic_id)throw Error('Choose a nurse account');
  if(active){const clinic=await db.from('workspace_clinics').select('active').eq('id',current.data.clinic_id).single();if(clinic.error||!clinic.data.active)throw Error('Activate the clinic before this nurse account');}
  const result=await db.from('workspace_staff').update({active}).eq('user_id',id).eq('role','nurse').select('user_id').single();
  if(result.error)throw Error('Could not update nurse access');
  revalidatePath('/staff/backoffice','layout');return {status:'success',message:active?'Nurse activated.':'Nurse deactivated.'};
 }catch(error){return formError(error,'Could not update nurse access.');}
});
