import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMember } from "./member-session";
import { useLocale } from "./locale-context";
import { copy } from "./copy";
import { Button, styles } from "./ui";
import type { Records } from "./records";
export function MemberScreen({
  title,
  children,
  beforeRecords,
}: {
  title: string;
  children: (data: Records) => ReactNode;
  beforeRecords?: ReactNode;
}) {
  const { data, error, reload } = useMember(),
    { locale } = useLocale(),
    c = copy[locale];
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
            {title}
          </Text>
          {beforeRecords}
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {locale === "hy"
                ? "Չհաջողվեց թարմացնել տվյալները։ Ցուցադրված տվյալները կարող են հնացած լինել։"
                : "We could not refresh your records. Displayed information may be out of date."}
            </Text>
          )}
          {data ? (
            <>
              <Text style={styles.muted}>
                {locale === "hy" ? "Վերջին բեռնումը՝ " : "Last loaded: "}
                {new Date(data.readAt).toLocaleString(
                  locale === "hy" ? "hy-AM" : "en-GB",
                )}
              </Text>
              {data.registered ? (
                children(data)
              ) : (
                <>
                  <Text style={styles.text}>{c.notRegistered}</Text>
                  <Button
                    title={c.web}
                    onPress={() => {
                      void Linking.openURL(`https://app.noreon.health/patient?locale=${locale}`);
                    }}
                  />
                </>
              )}
            </>
          ) : !error ? (
            <>
              <ActivityIndicator />
              <Text style={styles.muted}>{c.loading}</Text>
            </>
          ) : null}
          <Button title={c.updated} secondary onPress={reload} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
