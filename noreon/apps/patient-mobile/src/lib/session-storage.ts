export interface SecureDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
/** Serialize native storage operations; never fall back to unencrypted storage. */
export function sessionStorage(driver: SecureDriver): SecureDriver {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work).catch(() => {
      throw Error("Secure session storage unavailable");
    });
    tail = result.catch(() => {});
    return result;
  };
  return {
    getItem: (key) => serial(() => driver.getItem(key)),
    setItem: (key, value) => serial(() => driver.setItem(key, value)),
    removeItem: (key) => serial(() => driver.removeItem(key)),
  };
}
