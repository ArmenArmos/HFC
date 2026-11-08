import { useMemberDraft } from "./member-draft-context";
import { useEffect, useRef, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import {
  parseReminderPreferences,
  type ReminderPreferences,
  type SavedReminderPreferences,
} from "../../../../lib/patient-care/reminder-preferences";
import { readNativeReminders, saveNativeReminders } from "./reminder-actions";
import { Button, Card, styles } from "./ui";
import type { Locale } from "./copy";
const labels = {
  en: {
    title: "Your reminder settings",
    detail:
      "Choose reminder times in Armenia time (UTC+4). These settings do not change your medicine, dose or prescribed schedule.",
    medicine: "Medicine reminders",
    bp: "Blood-pressure reminders",
    times: "Blood-pressure times (HH:mm, separated by commas)",
    start: "Quiet hours from (HH:mm)",
    end: "Quiet hours until (HH:mm)",
    delivery:
      "Phone, SMS, WhatsApp and push delivery are not enabled. Quiet hours do not hide in-app tasks or urgent guidance.",
    offsets: [
      "15 minutes before",
      "At the recorded dose time",
      "15 minutes after",
    ],
    save: "Save reminder settings",
    retry: "Retry the same settings",
    reload: "Load latest settings and replace this draft",
    saved: "Reminder settings saved.",
    invalid: "Use one to four distinct times in HH:mm format.",
    unavailable:
      "We could not confirm the save. Retry the same settings or load the latest saved settings.",
    conflict:
      "The saved settings have changed. Load the latest settings before editing again.",
    loading: "Updating settings",
    readError: "We could not load your settings. Try again.",
  },
  hy: {
    title: "Ձեր հիշեցումների կարգավորումները",
    detail:
      "Ընտրեք ժամերը Հայաստանի ժամանակով (UTC+4)։ Սա չի փոխում դեղը, դեղաչափը կամ նշանակված ժամանակացույցը։",
    medicine: "Դեղերի հիշեցումներ",
    bp: "Ճնշման չափման հիշեցումներ",
    times: "Ճնշման չափման ժամերը (HH:mm, բաժանված ստորակետերով)",
    start: "Լուռ ժամերի սկիզբը (HH:mm)",
    end: "Լուռ ժամերի ավարտը (HH:mm)",
    delivery:
      "Հեռախոսի, SMS, WhatsApp և push առաքումները միացված չեն։ Լուռ ժամերը չեն թաքցնում հավելվածի առաջադրանքները կամ շտապ ցուցումները։",
    offsets: ["15 րոպե առաջ", "Գրանցված ընդունման ժամին", "15 րոպե հետո"],
    save: "Պահպանել հիշեցումները",
    retry: "Կրկնել նույն կարգավորումների պահպանումը",
    reload: "Բեռնել վերջին կարգավորումները և փոխարինել այս սևագիրը",
    saved: "Հիշեցումների կարգավորումները պահպանված են։",
    invalid: "Օգտագործեք մեկից չորս տարբեր ժամ՝ HH:mm ձևաչափով։",
    unavailable:
      "Չհաջողվեց հաստատել պահպանումը։ Կրկնեք նույն կարգավորումների պահպանումը կամ բեռնեք վերջին պահպանված կարգավորումները։",
    conflict:
      "Պահպանված կարգավորումները փոխվել են։ Փոփոխելուց առաջ բեռնեք վերջին կարգավորումները։",
    loading: "Կարգավորումները թարմացվում են",
    readError: "Չհաջողվեց բեռնել կարգավորումները։ Կրկին փորձեք։",
  },
};
export function ReminderSettings({
  saved,
  userId,
  locale,
  unavailable,
  onSaved,
}: {
  saved: SavedReminderPreferences;
  userId: string;
  locale: Locale;
  unavailable: boolean;
  onSaved: () => void;
}) {
  const c = labels[locale],
    [preferences, setPreferences] = useMemberDraft("reminder.preferences", () =>
      parseReminderPreferences(saved.preferences),
    ),
    [revision, setRevision] = useMemberDraft(
      "reminder.revision",
      saved.revision,
    ),
    [pending, setPending] = useMemberDraft<{
      preferences: ReminderPreferences;
      revision: number;
    } | null>("reminder.pending", null),
    [status, setStatus] = useMemberDraft("reminder.status", ""),
    [busy, setBusy] = useState(false);
  const active = useRef(true),
    request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  const conflict = status === "conflict" || saved.revision > revision,
    locked = busy || !!pending || conflict || unavailable;
  function change<K extends keyof ReminderPreferences>(
    key: K,
    value: ReminderPreferences[K],
  ) {
    if (locked) return;
    setPreferences((p) => ({ ...p, [key]: value }));
    setStatus("");
  }
  async function run(reload: boolean) {
    if (request.current || unavailable || (!reload && conflict)) return;
    let attempt = pending;
    if (!reload && !attempt) {
      try {
        attempt = {
          preferences: parseReminderPreferences(preferences),
          revision,
        };
      } catch {
        setStatus("invalid");
        return;
      }
      setPending(attempt);
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setStatus("");
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (reload) {
        const latest = await readNativeReminders(userId, controller.signal);
        if (active.current && !controller.signal.aborted) {
          setPreferences(latest.preferences);
          setRevision(latest.revision);
          setPending(null);
          onSaved();
        }
      } else if (attempt) {
        const result = await saveNativeReminders(
          userId,
          attempt.preferences,
          attempt.revision,
          controller.signal,
        );
        if (active.current) {
          setStatus(result.status);
          if (result.status === "saved") {
            setRevision(result.revision);
            setPreferences(attempt.preferences);
            setPending(null);
            onSaved();
          } else if (result.status === "invalid") {
            setPending(null);
          }
        }
      }
    } catch {
      if (active.current) setStatus(reload ? "readError" : "unavailable");
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        if (active.current) setBusy(false);
      }
    }
  }
  const field = (
    label: string,
    value: string,
    onChangeText: (s: string) => void,
    maxLength = 5,
  ) => (
    <View style={styles.row} key={label}>
      <Text style={styles.text}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        editable={!locked}
        maxLength={maxLength}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
  return (
    <Card title={c.title}>
      <Text style={styles.muted}>{c.detail}</Text>
      <View style={styles.row}>
        <Text style={styles.text}>{c.medicine}</Text>
        <Switch
          accessibilityLabel={c.medicine}
          value={preferences.medicationEnabled}
          disabled={locked}
          onValueChange={(v) => change("medicationEnabled", v)}
        />
      </View>
      {([-15, 0, 15] as const).map((offset, i) => (
        <Pressable
          key={offset}
          accessibilityRole="radio"
          accessibilityLabel={c.offsets[i]}
          accessibilityState={{
            checked: preferences.medicationOffsetMinutes === offset,
            disabled: locked,
          }}
          disabled={locked}
          onPress={() => change("medicationOffsetMinutes", offset)}
          style={[
            styles.button,
            preferences.medicationOffsetMinutes !== offset && styles.secondary,
            locked && styles.disabled,
          ]}
        >
          <Text
            style={[
              styles.buttonText,
              preferences.medicationOffsetMinutes !== offset &&
                styles.secondaryText,
            ]}
          >
            {c.offsets[i]}
          </Text>
        </Pressable>
      ))}
      <View style={styles.row}>
        <Text style={styles.text}>{c.bp}</Text>
        <Switch
          accessibilityLabel={c.bp}
          value={preferences.bpEnabled}
          disabled={locked}
          onValueChange={(v) => change("bpEnabled", v)}
        />
      </View>
      {field(
        c.times,
        preferences.bpTimes.join(", "),
        (v) =>
          change(
            "bpTimes",
            v.split(",").map((t) => t.trim()),
          ),
        40,
      )}
      {field(c.start, preferences.quietStart, (v) => change("quietStart", v))}
      {field(c.end, preferences.quietEnd, (v) => change("quietEnd", v))}
      <Text style={styles.muted}>{c.delivery}</Text>
      {conflict ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {c.conflict}
        </Text>
      ) : (
        status && (
          <Text
            accessibilityRole={status === "saved" ? "text" : "alert"}
            accessibilityLiveRegion="polite"
            style={status === "saved" ? styles.text : styles.error}
          >
            {c[status as "saved" | "invalid" | "unavailable" | "readError"]}
          </Text>
        )
      )}
      {busy && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {c.loading}
        </Text>
      )}
      <Button
        title={pending ? c.retry : c.save}
        disabled={busy || conflict || unavailable}
        onPress={() => void run(false)}
      />
      <Button
        title={c.reload}
        secondary
        disabled={busy || unavailable}
        onPress={() => void run(true)}
      />
    </Card>
  );
}
