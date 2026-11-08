import { JourneyProvider } from "../../lib/journey-provider";
import { JourneyGate } from "../../lib/journey-gate";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../lib/auth";
import { config } from "../../lib/supabase";
import { memberRouteAllowed } from "../../lib/navigation-access";
import { MemberDraftProvider } from "../../lib/member-draft-context";
import { MemberProvider } from "../../lib/member-session";
import { useLocale } from "../../lib/locale-context";
import { tokens as t } from "../../lib/tokens";
export default function MemberLayout() {
  const auth = useAuth(),
    { locale } = useLocale();
  if (
    !memberRouteAllowed(!!config, auth.loading, auth.error, auth.session) ||
    !auth.session
  )
    return <Redirect href="/" />;
  const names =
    locale === "hy"
      ? ["Գլխավոր", "Առաջընթաց", "Խնամքի պլան", "Ես"]
      : ["Home", "Progress", "Care plan", "Me"];
  return (
    <MemberDraftProvider key={auth.session.user.id}>
      <JourneyProvider key={auth.session.user.id} userId={auth.session.user.id}>
        <JourneyGate>
          <MemberProvider userId={auth.session.user.id}>
            <Tabs
              screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: t["text-strong"],
                tabBarInactiveTintColor: t["text-muted"],
                tabBarStyle: {
                  backgroundColor: t["surface-card"],
                  borderTopColor: t["border-default"],
                },
                tabBarLabelStyle: { fontFamily: "Inter_400Regular" },
                tabBarIconStyle: { display: "none" },
              }}
            >
              <Tabs.Screen
                name="index"
                options={{
                  title: names[0],
                  tabBarAccessibilityLabel: names[0],
                }}
              />
              <Tabs.Screen
                name="progress"
                options={{
                  title: names[1],
                  tabBarAccessibilityLabel: names[1],
                }}
              />
              <Tabs.Screen
                name="plan"
                options={{
                  title: names[2],
                  tabBarAccessibilityLabel: names[2],
                }}
              />
              <Tabs.Screen
                name="me"
                options={{
                  title: names[3],
                  tabBarAccessibilityLabel: names[3],
                }}
              />
            </Tabs>
          </MemberProvider>
        </JourneyGate>
      </JourneyProvider>
    </MemberDraftProvider>
  );
}
