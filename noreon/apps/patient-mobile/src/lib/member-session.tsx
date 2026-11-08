import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import { abortableRequest } from "./request";
import { readRecords, type Records } from "./records";
import { clientFor } from "./actions";
import { armeniaDate } from "../../../../lib/patient-care/model";
type MemberState = {
  userId: string;
  data: Records | null;
  error: boolean;
  now: Date;
  reload: () => void;
};
const Context = createContext<MemberState | null>(null);
export function MemberProvider({
  userId,
  children,
}: PropsWithChildren<{ userId: string }>) {
  const [data, setData] = useState<Records | null>(null),
    [error, setError] = useState(false),
    [refresh, setRefresh] = useState(0),
    [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let day = armeniaDate(new Date());
    const updateClock = () => {
      const next = new Date(),
        nextDay = armeniaDate(next);
      setNow(next);
      if (nextDay !== day) {
        day = nextDay;
        setRefresh((r) => r + 1);
      }
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        day = armeniaDate(new Date());
        setNow(new Date());
        setRefresh((r) => r + 1);
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") updateClock();
    }, 60000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    abortableRequest(async () => {
      const client = await clientFor(userId, controller.signal);
      return readRecords(client, controller.signal);
    }, controller.signal)
      .then((result) => {
        if (active) {
          setData(result);
          setError(false);
          setNow(new Date());
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      active = false;
      controller.abort();
    };
  }, [userId, refresh]);
  function reload() {
    setNow(new Date());
    setRefresh((r) => r + 1);
  }
  return (
    <Context.Provider value={{ userId, data, error, now, reload }}>
      {children}
    </Context.Provider>
  );
}
export function useMember() {
  const value = useContext(Context);
  if (!value) throw Error("Member provider missing");
  return value;
}
