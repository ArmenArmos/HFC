"use client";
import { unsubscribeMemberPush } from "@/lib/member-push/client";
import { LogOut } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/app/patient/actions";
import { safeSignOut } from "@/lib/patient/transport";
import { sweepSignupDrafts } from "@/lib/patient/signup-draft";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { Button } from "@/components/ui/button";

export function SignOutButton({ locale }: { locale: PatientLocale }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <div className="space-y-3">
      <Button
        className="h-auto min-h-12 max-w-full gap-2 whitespace-normal px-4 py-3"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setError("");
          start(async () => {
            await unsubscribeMemberPush();
            const result = await safeSignOut(signOut);
            if (result?.ok) {
              sweepSignupDrafts(true);
              router.replace("/patient");
              router.refresh();
            } else {
              setError(
                tx(
                      locale,
                      "Չհաջողվեց դուրս գալ։ Փորձեք կրկին։",
                      "We couldn’t sign out. Try again.",
                      "Не удалось выйти. Попробуйте снова.",
                    ),
              );
            }
          });
        }}
      >
        <LogOut className="size-4" aria-hidden />
        {busy
          ? tx(locale, "Խնդրում ենք սպասել…", "Please wait…", "Подождите…")
          : tx(locale, "Դուրս գալ", "Sign out", "Выйти")}
      </Button>
      {error && (
        <p role="alert" className="text-body2 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
