"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { loginForm, type StaffLoginState } from "@/lib/staff/actions";

export const STAFF_LOGIN_ERROR = "We couldn’t sign you in. Check your details or contact your administrator.";

/** QA 188: a wrong password keeps the email (held in this form, never in the URL), clears only the
 * password and puts focus there. `initialError` keeps the page's ?error=1 notice from other routes. */
export function StaffLoginForm({ button, fieldClass, buttonClass, initialError = false }: { button: string; fieldClass: string; buttonClass: string; initialError?: boolean }) {
  const [state, action, pending] = useActionState<StaffLoginState, FormData>(loginForm, { failed: 0 });
  // Controlled, so React's reset of the form after the action leaves the email in place.
  const [email, setEmail] = useState("");
  const password = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!state.failed || !password.current) return;
    password.current.value = "";
    password.current.focus();
  }, [state]);
  return <>
    {(initialError || state.failed > 0) && <p role="alert" className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-body2 text-destructive">{STAFF_LOGIN_ERROR}</p>}
    <form action={action} className="mt-7 space-y-5">
      <label className="block text-body2 font-medium">Email<input className={`${fieldClass} mt-2`} type="email" name="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="block text-body2 font-medium">Password<input ref={password} className={`${fieldClass} mt-2`} type="password" name="password" autoComplete="current-password" required /></label>
      <button className={`${buttonClass} w-full`} type="submit" disabled={pending}>{button}</button>
    </form>
  </>;
}
