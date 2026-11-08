export type AuthLease<T> = { client: T; retire(): void; active(): boolean };
/** Replacement cannot race mandatory credential deletion, including across provider remounts. */
export function createAuthLifetime<T>(
  create: () => AuthLease<T>,
  remove: () => Promise<void>,
) {
  let current: AuthLease<T> | null = null;
  let cleanup: Promise<void> | null = null;
  let cleanupRequired = false;
  function retire(lease = current) {
    if (!lease) return;
    if (current === lease) current = null;
    lease.retire();
  }
  return {
    current: () => current,
    start() {
      if (cleanupRequired) throw Error("Session cleanup required");
      return current ?? (current = create());
    },
    retire,
    clear() {
      if (cleanup) return cleanup;
      cleanupRequired = true;
      retire();
      cleanup = Promise.resolve()
        .then(remove)
        .then(() => {
          cleanupRequired = false;
        })
        .finally(() => {
          cleanup = null;
        });
      return cleanup;
    },
  };
}
