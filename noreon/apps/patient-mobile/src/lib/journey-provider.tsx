import { assessmentProgress } from "../../../../lib/patient/questionnaire";
import { firesEmergency } from "../../../../lib/clinical/rules/rules";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import { createJourneyController } from "./journey-controller";
import { nativeJourneyTransport } from "./journey-api";
import type { JourneyTransport } from "./journey-protocol";
type Mode = "app" | "profile" | "questions";
function useJourneyState(userId: string, transport?: JourneyTransport) {
  const [controller] = useState(() =>
    createJourneyController(transport ?? nativeJourneyTransport(userId)),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  const [mode, setMode] = useState<Mode>("app");
  useEffect(() => {
    void controller.start();
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active") void controller.load(false);
    });
    return () => {
      listener.remove();
      controller.stop();
    };
  }, [controller]);
  return { state, controller, mode, open: setMode };
}
const Context = createContext<ReturnType<typeof useJourneyState> | null>(null);
function OwnedJourneyProvider({
  userId,
  transport,
  children,
}: PropsWithChildren<{ userId: string; transport?: JourneyTransport }>) {
  const value = useJourneyState(userId, transport);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useJourney() {
  const value = useContext(Context);
  if (!value) throw Error("Journey provider missing");
  return value;
}
export function journeyComplete(
  data: ReturnType<typeof useJourney>["state"]["data"],
) {
  return !!(
    data?.state.profile &&
    data.state.consentAccepted &&
    data.state.assessment?.completedAt &&
    !data.state.assessment.urgentRule &&
    assessmentProgress(data.state.assessment.answers).complete &&
    !firesEmergency({
      answers: data.state.assessment.answers,
      observations: [],
    })
  );
}

export function JourneyProvider(
  props: PropsWithChildren<{ userId: string; transport?: JourneyTransport }>,
) {
  return <OwnedJourneyProvider key={props.userId} {...props} />;
}
