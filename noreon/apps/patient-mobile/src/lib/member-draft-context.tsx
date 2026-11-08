import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createDraftStore } from "./member-drafts";
const Context = createContext<ReturnType<typeof createDraftStore> | null>(null);
export function MemberDraftProvider({ children }: PropsWithChildren) {
  const [store] = useState(createDraftStore);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useMemberDraft<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(Context);
  if (!store) throw Error("Member draft provider missing");
  const get = () =>
    store.get<T>(key, () =>
      typeof initial === "function" ? (initial as () => T)() : initial,
    );
  const value = useSyncExternalStore(store.subscribe, get, get);
  return [value, (update) => store.set<T>(key, update)];
}
