import { LocaleProvider } from "../lib/locale-context";
import { memberRouteAllowed } from "../lib/navigation-access";
import { config } from "../lib/supabase";
import { Stack } from "expo-router";
import { useFonts, Inter_400Regular } from "@expo-google-fonts/inter";
import { Manrope_700Bold } from "@expo-google-fonts/manrope";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "../lib/auth";
import { styles } from "../lib/ui";
export default function Layout() {
  const [fonts, error] = useFonts({ Inter_400Regular, Manrope_700Bold });
  if (!fonts && !error)
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  return (
    <LocaleProvider>
      <AuthProvider>
        <Routes />
      </AuthProvider>
    </LocaleProvider>
  );
}

function Routes() {
  const auth = useAuth(),
    allowed = memberRouteAllowed(
      !!config,
      auth.loading,
      auth.error,
      auth.session,
    );
  return (
    <Stack
      key={auth.session?.user.id ?? "signed-out"}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="index" />
      <Stack.Protected guard={allowed}>
        <Stack.Screen name="member" />
      </Stack.Protected>
    </Stack>
  );
}
