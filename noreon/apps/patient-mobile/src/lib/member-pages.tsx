import { Text, View } from "react-native";
import { MemberScreen } from "./member-screen";
import { useMember } from "./member-session";
import { useLocale } from "./locale-context";
import { copy } from "./copy";
import { Card, styles } from "./ui";
import { PlanAcknowledgement } from "./plan-acknowledgement";
import { RecordHistory } from "./record-history";
import { readMeasurementHistory, readResultHistory } from "./history";
export function CarePlanPage() {
  const { userId, reload } = useMember(),
    { locale } = useLocale(),
    c = copy[locale];
  const date = (value: string) =>
    new Date(value).toLocaleString(locale === "hy" ? "hy-AM" : "en-GB");
  return (
    <MemberScreen title={c.plan}>
      {(data) => (
        <>
          <View style={styles.card}>
            <Text style={styles.text}>
              {data.plan?.instructions ?? c.noPlan}
            </Text>
            {data.plan && (
              <Text style={styles.muted}>
                {data.plan.clinician} · {date(data.plan.published_at)}
              </Text>
            )}
            {data.plan && (
              <PlanAcknowledgement
                key={data.plan.id}
                userId={userId}
                planId={data.plan.id}
                acknowledged={!!data.plan.acknowledged_at}
                locale={locale}
                onSaved={reload}
              />
            )}
          </View>
          {data.medications.length > 0 && (
            <Card title={c.medicines}>
              {data.medications.map((m) => (
                <View key={m.id} style={styles.row}>
                  <Text style={styles.text}>
                    {m.name} · {m.dose}
                  </Text>
                  <Text style={styles.text}>{m.instructions}</Text>
                  <Text style={styles.muted}>
                    {m.times.map((t) => t.slice(0, 5)).join(" · ")}
                  </Text>
                  <Text style={styles.muted}>
                    {c.starts} {m.start_date}
                    {m.end_date ? ` · ${c.ends} ${m.end_date}` : ""}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </MemberScreen>
  );
}
export function ProgressPage() {
  const { userId, error } = useMember(),
    { locale } = useLocale(),
    c = copy[locale];
  const date = (value: string) =>
    new Date(value).toLocaleString(locale === "hy" ? "hy-AM" : "en-GB");
  return (
    <MemberScreen title={locale === "hy" ? "Ձեր առաջընթացը" : "Your progress"}>
      {(data) => (
        <>
          <RecordHistory
            key={`measurements:${data.readAt}:${error}`}
            initial={data.measurements}
            read={readMeasurementHistory}
            title={c.measurements}
            userId={userId}
            locale={locale}
            unavailable={error}
            renderRow={(m) => (
              <View key={m.id} style={styles.row}>
                <Text style={styles.heading}>
                  {m.systolic}/{m.diastolic} mmHg
                </Text>
                <Text style={styles.muted}>{date(m.measured_at)}</Text>
              </View>
            )}
          />
          <RecordHistory
            key={`results:${data.readAt}:${error}`}
            initial={data.results}
            read={readResultHistory}
            title={c.results}
            userId={userId}
            locale={locale}
            unavailable={error}
            renderRow={(r) => (
              <View key={r.id} style={styles.row}>
                <Text style={styles.text}>
                  {r.marker}: {r.value} {r.unit}
                </Text>
                <Text style={styles.muted}>{date(r.collected_at)}</Text>
              </View>
            )}
          />
        </>
      )}
    </MemberScreen>
  );
}
