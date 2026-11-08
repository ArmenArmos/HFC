import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import * as SecureStore from "expo-secure-store";
import type { Locale } from "./copy";
import { createLocalePreference } from "./locale-preference";
const Context = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  storageError: "restore" | "save" | null;
} | null>(null);
export function LocaleProvider({ children }: PropsWithChildren) {
  const [preference] = useState(() => createLocalePreference({
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  }));
  const snapshot = useSyncExternalStore(preference.subscribe, preference.getSnapshot);
  useEffect(() => { void preference.hydrate(); }, [preference]);
  return (
    <Context.Provider value={{ ...snapshot, setLocale: (locale) => { void preference.setLocale(locale); } }}>
      {children}
    </Context.Provider>
  );
}
export function useLocale() {
  const value = useContext(Context);
  if (!value) throw Error("Locale provider missing");
  return value;
}
