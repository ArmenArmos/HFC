import { useMemberDraft } from "./member-draft-context";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { DueDose } from "../../../../lib/patient-care/types";
import type { Records } from "./records";
import {
  doseSnapshotUsable,
  nativeDoses,
  type DoseDraft,
  type DoseOutcome,
} from "./doses";
import { reportNativeDose } from "./actions";
import { Button, Card, styles } from "./ui";
import type { Locale } from "./copy";
const words = {
  en: {
    title: "Your medicine check-ins",
    zone: "Schedule times are shown in Armenia time (UTC+4). Follow your care-plan instructions.",
    none: "No doses are scheduled for today.",
    taken: "Record as taken",
    skipped: "Record as skipped",
    takenStatus: "You reported taken",
    skippedStatus: "You reported skipped",
    due: "Ready for your report",
    upcoming: "Scheduled later",
    saving: "Saving your report",
    saved: "Your report is saved.",
    uncertain:
      "We could not confirm the save. Retry the same report or refresh to check its status. If you close the app, check the latest status before reporting again.",
    conflict: "This dose changed. Refresh to see the latest report.",
    invalid: "This dose cannot be reported now. Refresh your schedule.",
    retry: "Retry the same report",
    refresh: "Refresh your schedule",
    stale: "Refresh your schedule before recording a dose.",
  },
  hy: {
    title: "Դեղերի ընդունման գրառումները",
    zone: "Ժամերը նշված են Հայաստանի ժամանակով (UTC+4)։ Հետևեք ձեր խնամքի պլանի ցուցումներին։",
    none: "Այսօրվա համար դեղի ընդունում նախատեսված չէ։",
    taken: "Գրանցել որպես ընդունված",
    skipped: "Գրանցել որպես բաց թողնված",
    takenStatus: "Գրանցել եք՝ ընդունված է",
    skippedStatus: "Գրանցել եք՝ բաց է թողնված",
    due: "Կարող եք գրանցել ընդունումը",
    upcoming: "Նախատեսված է ավելի ուշ",
    saving: "Պահպանում ենք գրառումը",
    saved: "Ձեր գրառումը պահպանված է։",
    uncertain:
      "Չհաջողվեց հաստատել պահպանումը։ Կրկնեք նույն գրառումը կամ թարմացրեք՝ կարգավիճակը ստուգելու համար։ Եթե փակեք հավելվածը, նոր գրառումից առաջ ստուգեք վերջին կարգավիճակը։",
    conflict:
      "Այս ընդունման գրառումը փոխվել է։ Թարմացրեք՝ վերջին գրառումը տեսնելու համար։",
    invalid:
      "Այժմ հնարավոր չէ գրանցել այս ընդունումը։ Թարմացրեք ժամանակացույցը։",
    retry: "Կրկնել նույն գրառումը",
    refresh: "Թարմացնել ժամանակացույցը",
    stale: "Թարմացրեք ժամանակացույցը՝ ընդունումը գրանցելուց առաջ։",
  },
};
function DoseRow({
  dose,
  canReport,
  userId,
  locale,
  readAt,
  onRefresh,
}: {
  dose: DueDose;
  canReport: boolean;
  userId: string;
  locale: Locale;
  readAt: string;
  onRefresh: () => void;
}) {
  const c = words[locale],
    sending = useRef(false),
    active = useRef(true);
  const draftKey = `dose:${dose.medication.id}:${dose.dueAt}:${dose.revision}`;
  const [pending, setPending] = useMemberDraft<DoseDraft | null>(
      `${draftKey}:pending`,
      null,
    ),
    [busy, setBusy] = useState(false),
    [result, setResult] = useMemberDraft<{
      outcome: DoseOutcome;
      readAt: string;
    } | null>(`${draftKey}:result`, null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const failed =
    result?.readAt === readAt &&
    (result.outcome === "invalid" || result.outcome === "conflict");
  async function save(status: "taken" | "skipped") {
    if (sending.current || (!pending && !canReport) || failed) return;
    const draft = pending ?? {
      medicationId: dose.medication.id,
      dueAt: dose.dueAt,
      status,
      revision: dose.revision ?? 0,
    };
    sending.current = true;
    setBusy(true);
    setPending(draft);
    try {
      const outcome = await reportNativeDose(userId, draft);
      if (!active.current) return;
      setResult({ outcome, readAt });
      if (outcome === "saved") onRefresh();
      if (outcome === "conflict" || outcome === "invalid") setPending(null);
    } finally {
      sending.current = false;
      if (active.current) setBusy(false);
    }
  }
  const status =
    dose.status === "taken"
      ? c.takenStatus
      : dose.status === "skipped"
        ? c.skippedStatus
        : dose.status === "upcoming"
          ? c.upcoming
          : c.due;
  return (
    <View style={styles.row}>
      <Text style={styles.heading}>
        {dose.medication.name} · {dose.medication.dose}
      </Text>
      <Text style={styles.text}>
        {new Date(dose.dueAt).toLocaleString(
          locale === "hy" ? "hy-AM" : "en-GB",
          {
            timeZone: "Asia/Yerevan",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          },
        )}
      </Text>
      <Text style={styles.text}>{dose.medication.instructions}</Text>
      <Text style={styles.muted}>{status}</Text>
      {busy ? (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {c.saving}
        </Text>
      ) : result?.outcome === "saved" ? (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {c.saved}
        </Text>
      ) : pending ? (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {c.uncertain}
          </Text>
          <Button title={c.retry} onPress={() => void save(pending.status)} />
        </>
      ) : failed ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {result?.outcome === "conflict" ? c.conflict : c.invalid}
        </Text>
      ) : null}
      {!pending && !failed && (
        <>
          <Button
            title={c.taken}
            disabled={busy || !canReport || dose.status === "taken"}
            onPress={() => void save("taken")}
          />
          <Button
            title={c.skipped}
            secondary
            disabled={busy || !canReport || dose.status === "skipped"}
            onPress={() => void save("skipped")}
          />
        </>
      )}
      {result && result.outcome !== "saved" && (
        <Button
          title={c.refresh}
          secondary
          disabled={busy}
          onPress={onRefresh}
        />
      )}
    </View>
  );
}
export function DoseSchedule({
  data,
  now,
  unavailable,
  userId,
  locale,
  onRefresh,
}: {
  data: Records;
  now: Date;
  unavailable: boolean;
  userId: string;
  locale: Locale;
  onRefresh: () => void;
}) {
  const c = words[locale],
    rows = nativeDoses(data.care, now, data.reminderOffset);
  const fresh = doseSnapshotUsable(data.readAt, now, unavailable);
  return (
    <Card title={c.title}>
      <Text style={styles.muted}>{c.zone}</Text>
      {!fresh && (
        <>
          <Text style={styles.error}>{c.stale}</Text>
          <Button title={c.refresh} onPress={onRefresh} />
        </>
      )}
      {rows.length === 0 ? (
        <Text style={styles.muted}>{c.none}</Text>
      ) : (
        rows.map(({ dose, canReport }) => (
          <DoseRow
            key={`${dose.medication.id}:${dose.dueAt}:${dose.revision}`}
            dose={dose}
            canReport={fresh && canReport}
            userId={userId}
            locale={locale}
            readAt={data.readAt}
            onRefresh={onRefresh}
          />
        ))
      )}
    </Card>
  );
}
