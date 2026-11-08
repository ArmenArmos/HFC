import type { PropsWithChildren } from "react";
import { Text, View } from "react-native";
import { useJourney, journeyComplete } from "./journey-provider";
import { JourneyScreen } from "./journey-screen";
import { useLocale } from "./locale-context";
import { journeyCopy } from "./journey-copy";
import { Button, styles } from "./ui";
export function JourneyGate({ children }: PropsWithChildren) {
  const { state, mode, controller } = useJourney();
  const { locale } = useLocale(),
    c = journeyCopy[locale];
  // Keep member operations mounted during a read-only foreground check.
  // New authoritative incomplete/urgent state still closes access immediately.
  const allowed =
    mode === "app" &&
    journeyComplete(state.data) &&
    (!state.latest || journeyComplete(state.latest));
  if (!allowed) return <JourneyScreen />;
  return (
    <View style={styles.page}>
      {state.phase !== "ready" && (
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.muted}>
            {state.phase === "loading" ? c.loading : c.refreshFailed}
          </Text>
          {state.phase !== "loading" && (
            <Button
              title={c.refresh}
              secondary
              onPress={() => {
                void controller.load();
              }}
            />
          )}
        </View>
      )}
      <View style={styles.page}>{children}</View>
    </View>
  );
}
