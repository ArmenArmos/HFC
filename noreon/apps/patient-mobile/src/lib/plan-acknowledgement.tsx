import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { acknowledgeNativePlan } from "./actions";
import { copy, type Locale } from "./copy";
import { Button, styles } from "./ui";
export function PlanAcknowledgement({
  userId,
  planId,
  acknowledged,
  locale,
  onSaved,
}: {
  userId: string;
  planId: string;
  acknowledged: boolean;
  locale: Locale;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    active = useRef(true),
    sending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (acknowledged)
    return (
      <Text style={styles.muted}>
        {locale === "hy"
          ? "Դուք հաստատել եք պլանի ստացումը։"
          : "You have acknowledged this plan."}
      </Text>
    );
  async function acknowledge() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(false);
    const ok = await acknowledgeNativePlan(userId, planId);
    sending.current = false;
    if (!active.current) return;
    setBusy(false);
    if (ok) onSaved();
    else setError(true);
  }
  return (
    <>
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {copy[locale].error}
        </Text>
      )}
      <Button
        title={
          locale === "hy" ? "Հաստատել պլանի ստացումը" : "Acknowledge your plan"
        }
        disabled={busy}
        onPress={() => {
          void acknowledge();
        }}
      />
    </>
  );
}
