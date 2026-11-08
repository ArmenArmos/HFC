import { Redirect } from "expo-router";
import { useLocale } from "../lib/locale-context";
import { memberRouteAllowed } from "../lib/navigation-access";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../lib/auth";
import { config } from "../lib/supabase";
import { copy } from "../lib/copy";
import { Button, styles } from "../lib/ui";
import { Login } from "../lib/login";
export default function Home() {
  const { locale, setLocale } = useLocale(),
    c = copy[locale],
    auth = useAuth();
  if (memberRouteAllowed(!!config, auth.loading, auth.error, auth.session))
    return <Redirect href="/member" />;
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.languages}>
            <Button title="Հայ" secondary onPress={() => setLocale("hy")} />
            <Button title="EN" secondary onPress={() => setLocale("en")} />
          </View>
          <Text style={styles.brand}>Noreon</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {c.title}
          </Text>
          <Text style={styles.text}>{c.intro}</Text>
          {!config ? (
            <>
              <Text style={styles.muted}>{c.unavailable}</Text>
              <Button
                title={c.web}
                onPress={() => {
                  void Linking.openURL(`https://app.noreon.health/patient?locale=${locale}`);
                }}
              />
            </>
          ) : auth.loading ? (
            <ActivityIndicator />
          ) : auth.error ? (
            <>
              <Text accessibilityRole="alert" style={styles.error}>
                {c.error}
              </Text>
              <Button
                title={c.retry}
                onPress={() => {
                  void auth.signOut();
                }}
              />
            </>
          ) : auth.session ? (
            <>
              <Text style={styles.error}>{c.missing}</Text>
              <Button
                title={c.signout}
                secondary
                onPress={() => {
                  void auth.signOut();
                }}
              />
            </>
          ) : (
            <Login locale={locale} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
