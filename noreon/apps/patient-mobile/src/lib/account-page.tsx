import { useJourney } from "./journey-provider";
import { journeyCopy } from "./journey-copy";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "./auth";
import { useMember } from "./member-session";
import { useLocale } from "./locale-context";
import { MemberScreen } from "./member-screen";
import { ReminderSettings } from "./reminder-settings";
import { Card, styles } from "./ui";
import { tokens as t } from "./tokens";
import { copy } from "./copy";
function AccountAction({
  title,
  onPress,
  expanded,
}: {
  title: string;
  onPress: () => void;
  expanded?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={accountStyles.action}
    >
      <Text style={[styles.text, accountStyles.actionText]}>{title}</Text>
      <Text accessible={false} style={styles.muted}>
        {expanded === undefined ? "›" : expanded ? "−" : "+"}
      </Text>
    </Pressable>
  );
}
export function AccountPage() {
  const { locale, setLocale, storageError } = useLocale(),
    auth = useAuth(),
    journey = useJourney(),
    { userId, error, reload } = useMember(),
    [remindersOpen, setRemindersOpen] = useState(false);
  return (
    <MemberScreen
      title={locale === "hy" ? "Ձեր հաշիվը" : "Your account"}
      beforeRecords={
        <>
          <Card title={journeyCopy[locale].profile}>
            <AccountAction
              title={journeyCopy[locale].editProfile}
              onPress={() => journey.open("profile")}
            />
            <AccountAction
              title={journeyCopy[locale].editQuestions}
              onPress={() => journey.open("questions")}
            />
            <AccountAction
              title={copy[locale].signout}
              onPress={() => {
                void auth.signOut();
              }}
            />
          </Card>
          <Card title={locale === "hy" ? "Լեզու" : "Language"}>
            <View style={accountStyles.languages}>
              {(["hy", "en"] as const).map((language) => (
                <Pressable
                  key={language}
                  accessibilityRole="button"
                  accessibilityState={{ selected: locale === language }}
                  onPress={() => setLocale(language)}
                  style={[
                    styles.button,
                    accountStyles.language,
                    locale !== language && styles.secondary,
                  ]}
                >
                  <Text style={[
                    styles.buttonText,
                    locale !== language && styles.secondaryText,
                  ]}>
                    {language === "hy" ? "Հայ" : "EN"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {storageError && (
              <Text accessibilityRole="alert" style={styles.muted}>
                {storageError === "save"
                  ? locale === "hy"
                    ? "Լեզուն չպահպանվեց։ Կրկին ընտրեք այն։"
                    : "Language could not be saved. Choose it again."
                  : locale === "hy"
                    ? "Պահպանված լեզուն չհաջողվեց վերականգնել։"
                    : "Your saved language could not be restored."}
              </Text>
            )}
          </Card>
        </>
      }
    >
      {(data) => (
        <View style={accountStyles.reminders}>
          <AccountAction
            title={locale === "hy" ? "Հիշեցումներ" : "Reminders"}
            expanded={remindersOpen}
            onPress={() => setRemindersOpen((open) => !open)}
          />
          <View
            style={!remindersOpen && accountStyles.hidden}
            accessibilityElementsHidden={!remindersOpen}
            importantForAccessibility={
              remindersOpen ? "auto" : "no-hide-descendants"
            }
          >
            <ReminderSettings
              saved={data.reminders}
              userId={userId}
              locale={locale}
              unavailable={error}
              onSaved={reload}
            />
          </View>
        </View>
      )}
    </MemberScreen>
  );
}
const accountStyles = StyleSheet.create({
  action: {
    minHeight: t["control-height-lg"],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t["space-3"],
    paddingVertical: t["space-3"],
  },
  actionText: { flex: 1 },
  languages: { flexDirection: "row", gap: t["space-3"] },
  language: { flex: 1 },
  reminders: {
    backgroundColor: t["surface-card"],
    borderRadius: t["radius-md"],
    padding: t["space-4"],
  },
  hidden: { display: "none" },
});
