/** Sign-up drafts left in this browser (privacy audit B3-8). Every expired draft, any member's, is removed when
 *  any member screen opens; signing out removes them all, so a shared browser does not keep someone's details. */
export const SIGNUP_DRAFT_PREFIX = "noreon.signup.profile.";
export const SIGNUP_DRAFT_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
export function sweepSignupDrafts(all = false) {
  try {
    const store = window.localStorage;
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i);
      if (!key?.startsWith(SIGNUP_DRAFT_PREFIX)) continue;
      let savedAt: unknown;
      try { savedAt = JSON.parse(store.getItem(key) ?? "null")?.savedAt; } catch { savedAt = undefined; }
      if (all || typeof savedAt !== "number" || Date.now() - savedAt > SIGNUP_DRAFT_MAX_AGE_MS) store.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing was kept.
  }
}
