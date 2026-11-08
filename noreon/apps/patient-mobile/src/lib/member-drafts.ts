/** Per-member memory only. Never serialize health drafts or share stores across identities. */
export function createDraftStore() {
  const values = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  return {
    get<T>(key: string, initialize: () => T): T {
      if (!values.has(key)) values.set(key, initialize());
      return values.get(key) as T;
    },
    set<T>(key: string, update: T | ((previous: T) => T)) {
      const previous = values.get(key) as T;
      const next =
        typeof update === "function"
          ? (update as (p: T) => T)(previous)
          : update;
      if (Object.is(previous, next)) return;
      values.set(key, next);
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
