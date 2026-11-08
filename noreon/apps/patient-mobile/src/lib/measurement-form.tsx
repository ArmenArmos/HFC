import { useMemberDraft } from "./member-draft-context";
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { saveNativeMeasurement } from "./actions";
import { localMeasurementTime, measurementDraft } from "./measurement-draft";
import { Button, Card, styles } from "./ui";
import type { Locale } from "./copy";
const labels = {
  en: {
    title: "Record your blood pressure",
    sys: "Systolic (mmHg)",
    dia: "Diastolic (mmHg)",
    pulse: "Pulse (optional)",
    time: "When you measured (YYYY-MM-DD HH:MM)",
    zone: "Use your device’s local time. Recording a reading does not notify a doctor or provide urgent monitoring.",
    save: "Save reading",
    retry: "Retry the same reading",
    invalid: "Check the numbers and date.",
    uncertain:
      "We could not confirm the save. Retry this same reading before entering another. If you close this screen, check your history before recording it again.",
    conflict:
      "This submission was already saved with different values. Check your history before recording another reading.",
    history: "Check your history",
    saving: "Saving your reading",
  },
  hy: {
    title: "Գրանցել զարկերակային ճնշումը",
    sys: "Սիստոլիկ (մմ սնդ․ սյուն)",
    dia: "Դիաստոլիկ (մմ սնդ․ սյուն)",
    pulse: "Պուլս (ոչ պարտադիր)",
    time: "Չափման ամսաթիվն ու ժամը (YYYY-MM-DD HH:MM)",
    zone: "Օգտագործեք սարքի տեղական ժամը։ Չափման գրանցումը չի ծանուցում բժշկին և շտապ հսկողություն չի ապահովում։",
    save: "Պահել չափումը",
    retry: "Կրկնել նույն չափման պահպանումը",
    invalid: "Ստուգեք թվերն ու ամսաթիվը։",
    uncertain:
      "Չհաջողվեց հաստատել պահպանումը։ Նախ կրկնեք նույն չափման պահպանումը։ Եթե փակեք այս էջը, նորից գրանցելուց առաջ ստուգեք ձեր պատմությունը։",
    conflict:
      "Այս գրառումն արդեն պահպանված է այլ արժեքներով։ Նոր չափում գրանցելուց առաջ ստուգեք ձեր պատմությունը։",
    history: "Ստուգել պատմությունը",
    saving: "Չափումը պահվում է",
  },
};
export function MeasurementForm({
  userId,
  locale,
  onSaved,
  onViewHistory,
}: {
  userId: string;
  locale: Locale;
  onSaved: () => void;
  onViewHistory?: () => void;
}) {
  const c = labels[locale],
    [id, setId] = useMemberDraft("bp.id", randomUUID),
    [sys, setSys] = useMemberDraft("bp.sys", ""),
    [dia, setDia] = useMemberDraft("bp.dia", ""),
    [pulse, setPulse] = useMemberDraft("bp.pulse", ""),
    [time, setTime] = useMemberDraft("bp.time", localMeasurementTime),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useMemberDraft("bp.status", "");
  const [pending, setPending] = useMemberDraft<
    ReturnType<typeof measurementDraft>
  >("bp.pending", null);
  const active = useRef(true),
    sending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function save() {
    if (sending.current) return;
    const input = pending ?? measurementDraft(id, sys, dia, pulse, time);
    if (!input) {
      setStatus("invalid");
      return;
    }
    setPending(input);
    sending.current = true;
    setBusy(true);
    setStatus("");
    const result = await saveNativeMeasurement(userId, input);
    sending.current = false;
    if (!active.current) return;
    setBusy(false);
    if (result === "saved") {
      setStatus("saved");
      onSaved();
      return;
    }
    if (result === "invalid") setPending(null);
    setStatus(result);
  }
  function newReading() {
    setId(randomUUID());
    setPending(null);
    setSys("");
    setDia("");
    setPulse("");
    setTime(localMeasurementTime());
    setStatus("");
  }
  const field = (
    label: string,
    value: string,
    change: (s: string) => void,
    numeric = true,
  ) => (
    <View style={styles.row} key={label}>
      <Text style={styles.text}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={value}
        onChangeText={change}
        editable={!busy && !pending}
        keyboardType={numeric ? "number-pad" : "default"}
        autoCorrect={false}
        maxLength={numeric ? 3 : 16}
      />
    </View>
  );
  return (
    <Card title={c.title}>
      {field(c.sys, sys, setSys)}
      {field(c.dia, dia, setDia)}
      {field(c.pulse, pulse, setPulse)}
      {field(c.time, time, setTime, false)}
      <Text style={styles.muted}>{c.zone}</Text>
      {status === "saved" && (
        <Text style={styles.text}>
          {locale === "hy" ? "Չափումը պահպանված է։" : "Your reading is saved."}
        </Text>
      )}
      {!!status && status !== "saved" && (
        <Text accessibilityRole="alert" style={styles.error}>
          {status === "invalid"
            ? c.invalid
            : status === "conflict"
              ? c.conflict
              : c.uncertain}
        </Text>
      )}
      {status === "saved" ? (
        <Button
          title={
            locale === "hy"
              ? "Գրանցել մեկ այլ չափում"
              : "Record another reading"
          }
          onPress={newReading}
        />
      ) : status === "conflict" ? (
        <>
          <Button title={c.history} onPress={onViewHistory ?? onSaved} />
          <Button
            secondary
            title={
              locale === "hy"
                ? "Սկսել այլ չափման գրանցում"
                : "Start a different reading"
            }
            onPress={newReading}
          />
        </>
      ) : (
        <Button
          title={busy ? c.saving : pending ? c.retry : c.save}
          disabled={busy}
          onPress={() => {
            void save();
          }}
        />
      )}
    </Card>
  );
}
