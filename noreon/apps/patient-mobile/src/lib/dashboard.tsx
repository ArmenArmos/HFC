import { useRouter } from "expo-router";
import { Text } from "react-native";
import { MemberScreen } from "./member-screen";
import { useMember } from "./member-session";
import { useLocale } from "./locale-context";
import { DoseSchedule } from "./dose-schedule";
import { MeasurementForm } from "./measurement-form";
import { styles } from "./ui";
import { copy } from "./copy";
export function Dashboard() {
  const { userId, error, now, reload } = useMember(),
    { locale } = useLocale(),
    router = useRouter();
  return (
    <MemberScreen title={copy[locale].hello}>
      {(data) => (
        <>
          <Text style={styles.heading}>{data.profile?.display_name}</Text>
          {data.plan && (
            <DoseSchedule
              data={data}
              now={now}
              unavailable={error}
              userId={userId}
              locale={locale}
              onRefresh={reload}
            />
          )}
          <MeasurementForm
            userId={userId}
            locale={locale}
            onSaved={reload}
            onViewHistory={() => {
              reload();
              router.navigate("/member/progress");
            }}
          />
        </>
      )}
    </MemberScreen>
  );
}
