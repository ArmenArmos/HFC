import { useState } from "react";
import { firesEmergency, ruleById } from "../../../../lib/clinical/rules/rules";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useJourney, journeyComplete } from "./journey-provider";
import { useLocale } from "./locale-context";
import { useAuth } from "./auth";
import { JourneyProfile } from "./journey-profile";
import { JourneyQuestions } from "./journey-questions";
import { journeyCopy } from "./journey-copy";
import { Button, styles } from "./ui";
export function JourneyScreen() {
  const [utilitiesExpanded, setUtilitiesExpanded] = useState(false);
  const [draftReset, setDraftReset] = useState(0);
  const { state, controller, mode, open } = useJourney(),
    { locale, setLocale } = useLocale(),
    auth = useAuth(),
    c = journeyCopy[locale],
    data = state.data;
  const busy = state.phase === "saving" || state.phase === "loading",
    disabled = busy || state.phase === "blocked";
  const profile =
    mode === "profile" || !data?.state.profile || !data.state.consentAccepted;
  const latest = state.latest?.state.assessment;
  const urgentAssessment = latest ?? (profile ? data?.state.assessment : null);
  const remoteUrgent = urgentAssessment
    ? (firesEmergency({
        answers: urgentAssessment.answers,
        observations: [],
      }) ??
      (urgentAssessment.urgentRule
        ? ruleById(urgentAssessment.urgentRule)
        : undefined))
    : undefined;
  return (
    <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.brand}>Noreon</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {profile ? c.title : c.questions}
          </Text>
          <View style={styles.languages}>
            <Button title="Հայ" secondary onPress={() => setLocale("hy")} />
            <Button title="EN" secondary onPress={() => setLocale("en")} />
          </View>
          {busy && (
            <>
              <ActivityIndicator />
              <Text style={styles.muted}>
                {state.phase === "saving" ? c.saving : c.loading}
              </Text>
            </>
          )}
          {state.phase === "blocked" && (
            <>
              <Text accessibilityRole="alert" style={styles.error}>
                {data ? c.blocked : c.unavailable}
              </Text>
              <Button
                title={c.reload}
                onPress={() => {
                  void controller.load().then((saved) => {
                    if (saved) setDraftReset((value) => value + 1);
                  });
                }}
              />
            </>
          )}
          {remoteUrgent && (
            <View style={styles.card}>
              <Text accessibilityRole="alert" style={styles.error}>
                {c.urgent}
              </Text>
              <Text style={styles.text}>
                {locale === "hy"
                  ? remoteUrgent.reason.hy
                  : (remoteUrgent.reason.en ?? remoteUrgent.reason.hy)}
              </Text>
              {remoteUrgent.nextStep && (
                <Text style={styles.text}>
                  {locale === "hy"
                    ? remoteUrgent.nextStep.hy
                    : (remoteUrgent.nextStep.en ?? remoteUrgent.nextStep.hy)}
                </Text>
              )}
            </View>
          )}
          {state.phase === "invalid" && (
            <Text accessibilityRole="alert" style={styles.error}>
              {c.invalid}
            </Text>
          )}
          {data &&
            (profile ? (
              <JourneyProfile
                key={"profile:" + state.reset}
                data={data}
                locale={locale}
                disabled={disabled}
                onSave={(command) => {
                  open("profile");
                  void controller.save(command).then((saved) => {
                    if (saved)
                      open(journeyComplete(saved) ? "app" : "questions");
                  });
                }}
                onClose={journeyComplete(data) ? () => open("app") : undefined}
              />
            ) : (
              <JourneyQuestions
                key={draftReset}
                data={data}
                reset={state.reset}
                locale={locale}
                disabled={disabled}
                onSave={(command) => {
                  open("questions");
                  return controller.save(command);
                }}
                onClose={() => {
                  if (journeyComplete(controller.snapshot().data)) open("app");
                }}
              />
            ))}
          <View style={styles.utilityActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: utilitiesExpanded }}
              onPress={() => setUtilitiesExpanded((expanded) => !expanded)}
              style={styles.utilityAction}
            >
              <Text style={styles.muted}>{c.moreOptions}</Text>
            </Pressable>
            {utilitiesExpanded && (
              <>
                <Pressable
                  accessibilityRole="button"
                  style={styles.utilityAction}
                  onPress={() => {
                    void Linking.openURL(`https://app.noreon.health/patient?locale=${locale}`);
                  }}
                >
                  <Text style={styles.muted}>{c.web}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={styles.utilityAction}
                  onPress={() => {
                    void auth.signOut();
                  }}
                >
                  <Text style={styles.muted}>{c.signout}</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
