import { boundAccount } from "@/components/patient/account-binding";

/**
 * What a member was typing, kept through a reload or a new sign-in (BC-05, BC-11). This tab only, this account only, and
 * for half an hour: on a shared phone the next member never gets it, and an old reading never comes back as a new one.
 */
const MAX_AGE_MS = 30 * 60_000;
const key = (name: string) => `noreon.draft.v1.${name}`;

export function readDraft(name: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(key(name));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { account?: unknown; at?: unknown; value?: unknown };
    if (saved.account === boundAccount() && typeof saved.at === "number" && Date.now() - saved.at < MAX_AGE_MS && typeof saved.value === "string") return saved.value;
    window.sessionStorage.removeItem(key(name));
  } catch {}
  return null;
}

/** An empty value, or a tab that does not know its account, keeps nothing. */
export function keepDraft(name: string, value: string) {
  try {
    const account = boundAccount();
    if (value && account) window.sessionStorage.setItem(key(name), JSON.stringify({ account, at: Date.now(), value }));
    else window.sessionStorage.removeItem(key(name));
  } catch {}
}
