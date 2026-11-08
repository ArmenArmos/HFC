import type { Locale } from "./copy";

// Device preference, deliberately separate from account data and auth storage.
export const LANGUAGE_PREFERENCE_KEY = "noreon.device.language";
type Snapshot = { locale: Locale; storageError: "restore" | "save" | null };
export function createLocalePreference(storage: {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}) {
  let snapshot: Snapshot = { locale: "hy", storageError: null };
  let revision = 0;
  let hydration: Promise<void> | undefined;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  function update(next: Snapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    hydrate() {
      if (hydration) return hydration;
      const startedAt = revision;
      hydration = (async () => {
        try {
          const saved = await storage.getItem(LANGUAGE_PREFERENCE_KEY);
          if (revision === startedAt && (saved === "en" || saved === "hy"))
            update({ locale: saved, storageError: null });
        } catch {
          if (revision === startedAt)
            update({ ...snapshot, storageError: "restore" });
        }
      })();
      return hydration;
    },
    setLocale(locale: Locale) {
      if (locale !== "en" && locale !== "hy") return Promise.resolve();
      const selectedAt = ++revision;
      update({ locale, storageError: null });
      // SecureStore writes cannot be cancelled: serialize them so an older
      // completion cannot replace the final choice on the device.
      writes = writes.then(async () => {
        try {
          await storage.setItem(LANGUAGE_PREFERENCE_KEY, locale);
          if (revision === selectedAt) update({ locale, storageError: null });
        } catch {
          if (revision === selectedAt) update({ locale, storageError: "save" });
        }
      });
      return writes;
    },
  };
}
