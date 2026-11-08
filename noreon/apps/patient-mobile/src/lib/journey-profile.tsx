import { useState } from "react";
import { Text, TextInput, Pressable, View } from "react-native";
import {
  parseBirthDate,
  validProfile,
} from "../../../../lib/patient/validation";
import type { JourneySnapshot, JourneyCommand } from "./journey-protocol";
import type { Locale } from "./copy";
import { journeyCopy } from "./journey-copy";
import { Button, styles } from "./ui";
export function JourneyProfile({
  data,
  locale,
  disabled,
  onSave,
  onClose,
}: {
  data: JourneySnapshot;
  locale: Locale;
  disabled: boolean;
  onSave: (c: JourneyCommand) => void;
  onClose?: () => void;
}) {
  const p = data.state.profile,
    c = journeyCopy[locale];
  const [name, setName] = useState(p?.name ?? ""),
    [birth, setBirth] = useState(p?.birthDate ?? ""),
    [sex, setSex] = useState(p?.biologicalSex ?? ""),
    [consent, setConsent] = useState(data.state.consentAccepted),
    [invalid, setInvalid] = useState(false);
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{c.profile}</Text>
      <Text style={styles.text}>{c.name}</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel={c.name}
        value={name}
        onChangeText={setName}
        maxLength={100}
        editable={!disabled}
      />
      <Text style={styles.text}>{c.birth}</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel={c.birth}
        value={birth}
        onChangeText={setBirth}
        maxLength={10}
        keyboardType="numbers-and-punctuation"
        editable={!disabled}
      />
      <Text style={styles.text}>{c.sex}</Text>
      <Button
        title={c.male}
        secondary={sex !== "male"}
        disabled={disabled}
        onPress={() => setSex("male")}
      />
      <Button
        title={c.female}
        secondary={sex !== "female"}
        disabled={disabled}
        onPress={() => setSex("female")}
      />
      <Text style={styles.text}>{c.disclosure}</Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={c.consent}
        accessibilityState={{ checked: consent, disabled }}
        disabled={disabled}
        style={[styles.button, !consent && styles.secondary]}
        onPress={() => setConsent(!consent)}
      >
        <Text style={[styles.buttonText, !consent && styles.secondaryText]}>
          {c.consent}
        </Text>
      </Pressable>
      {invalid && (
        <Text accessibilityRole="alert" style={styles.error}>
          {c.profileInvalid}
        </Text>
      )}
      <Button
        title={c.save}
        disabled={disabled}
        onPress={() => {
          const birthDate = parseBirthDate(birth),
            profile = {
              name,
              birthDate: birthDate ?? "",
              biologicalSex: sex,
              locale,
            };
          if (!consent || !validProfile(profile)) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          onSave({
            type: "profile",
            profile,
            consent: true,
            consentVersion: data.consentVersion,
            expectedRevision: data.state.assessment?.revision ?? -1,
          });
        }}
      />
      {onClose && (
        <Button
          title={c.discard}
          secondary
          disabled={disabled}
          onPress={onClose}
        />
      )}
    </View>
  );
}
