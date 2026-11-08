import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Text, TextInput, View } from "react-native";
import ConfirmHcaptcha from "@hcaptcha/react-native-hcaptcha";
import { config } from "./supabase";
import { useAuth } from "./auth";
import { requestExistingMemberCode } from "./phone-auth";
import { copy, type Locale } from "./copy";
import { Button, styles } from "./ui";
import { normalizePhone } from "../../../../lib/patient/validation";
export function Login({ locale }: { locale: Locale }) {
  const c = copy[locale],
    auth = useAuth(),
    captcha = useRef<ConfirmHcaptcha>(null),
    pendingPhone = useRef(""),
    generation = useRef(0),
    phase = useRef<"idle" | "captcha" | "request" | "verify">("idle");
  useEffect(
    () => () => {
      generation.current++;
      phase.current = "idle";
    },
    [],
  );
  const [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const onMessage: ComponentProps<typeof ConfirmHcaptcha>["onMessage"] = async (
    event,
  ) => {
    if (event.nativeEvent.data === "open") return;
    if (phase.current !== "captcha") return;
    if (!event.success) {
      if (event.nativeEvent.data === "challenge-expired") event.reset();
      else {
        phase.current = "idle";
        setBusy(false);
        setError(event.nativeEvent.data !== "cancel");
      }
      return;
    }
    const current = generation.current,
      number = pendingPhone.current;
    phase.current = "request";
    captcha.current?.hide("verified");
    event.markUsed?.();
    try {
      const ok = await auth.runAuthOperation((client) =>
        requestExistingMemberCode(client.auth, number, event.nativeEvent.data),
      );
      if (generation.current === current) {
        setSent(ok);
        setError(!ok);
      }
    } catch {
      if (generation.current === current) setError(true);
    } finally {
      if (generation.current === current) {
        phase.current = "idle";
        setBusy(false);
      }
    }
  };
  async function verify() {
    if (phase.current !== "idle" || !/^\d{6}$/.test(code)) return;
    phase.current = "verify";
    setBusy(true);
    setError(false);
    const current = ++generation.current;
    try {
      const result = await auth.runAuthOperation((client) =>
        client.auth.verifyOtp({
          phone: pendingPhone.current,
          token: code,
          type: "sms",
        }),
      );
      if (current === generation.current) setError(Boolean(result.error));
    } catch {
      if (current === generation.current) setError(true);
    } finally {
      if (current === generation.current) {
        phase.current = "idle";
        setBusy(false);
      }
    }
  }
  function change() {
    if (phase.current !== "idle") return;
    generation.current++;
    pendingPhone.current = "";
    setSent(false);
    setCode("");
    setBusy(false);
    setError(false);
  }
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        {c.signin}
      </Text>
      <Text style={styles.muted}>{sent ? c.awaiting : c.privacy}</Text>
      {!sent ? (
        <>
          <Text style={styles.text}>{c.phone}</Text>
          <TextInput
            accessibilityLabel={c.phone}
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            editable={!busy}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+374"
            maxLength={30}
          />
          <Button
            title={c.send}
            disabled={busy || !normalizePhone(phone)}
            onPress={() => {
              if (phase.current !== "idle") return;
              const value = normalizePhone(phone);
              if (!value) return;
              phase.current = "captcha";
              generation.current++;
              pendingPhone.current = value;
              setBusy(true);
              setError(false);
              captcha.current?.show();
            }}
          />
        </>
      ) : (
        <>
          <Text style={styles.text}>{c.code}</Text>
          <TextInput
            accessibilityLabel={c.code}
            style={styles.input}
            value={code}
            onChangeText={setCode}
            editable={!busy}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
          />
          <Button
            title={c.verify}
            disabled={busy || !/^\d{6}$/.test(code)}
            onPress={() => {
              void verify();
            }}
          />
          <Button title={c.change} secondary disabled={busy} onPress={change} />
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {c.error}
        </Text>
      )}
      {config && (
        <ConfirmHcaptcha
          size="invisible"
          ref={captcha}
          siteKey={config.captchaSiteKey}
          baseUrl={config.captchaOrigin}
          languageCode={locale}
          userJourney={false}
          onMessage={onMessage}
        />
      )}
    </View>
  );
}
