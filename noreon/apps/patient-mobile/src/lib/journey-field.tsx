import { Text, TextInput, Pressable, View } from "react-native";
import type {
  AssessmentField,
  Answers,
  FieldValue,
} from "../../../../lib/clinical/types";
import { UNKNOWN, NONE } from "../../../../lib/clinical/types";
import type { Locale } from "./copy";
import { Button, styles } from "./ui";
import { journeyCopy } from "./journey-copy";
export type RawAnswers = Record<string, string | string[]>;
export function fieldKeys(field: AssessmentField) {
  return field.kind === "blood-pressure"
    ? [field.id + ".systolic", field.id + ".diastolic"]
    : [field.id];
}
export function fieldRaw(field: AssessmentField, answers: Answers): RawAnswers {
  return Object.fromEntries(
    fieldKeys(field).map((id) => {
      const value = answers[id]?.value;
      return [
        id,
        Array.isArray(value) ? value : value === undefined ? "" : String(value),
      ];
    }),
  );
}
export function fieldEntries(field: AssessmentField, raw: RawAnswers) {
  return fieldKeys(field).map((fieldId) => {
    const value = raw[fieldId] ?? "";
    if (
      field.kind === "number" ||
      field.kind === "scale" ||
      field.kind === "blood-pressure"
    ) {
      if (value === UNKNOWN) return { fieldId, value: UNKNOWN };
      if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value.trim()))
        throw Error("Invalid answer");
      return { fieldId, value: Number(value) };
    }
    return { fieldId, value: value as FieldValue };
  });
}
export function JourneyField({
  field,
  raw,
  onChange,
  disabled,
  locale,
}: {
  field: AssessmentField;
  raw: RawAnswers;
  onChange: (r: RawAnswers) => void;
  disabled: boolean;
  locale: Locale;
}) {
  const text = (v: { hy: string; en?: string }) =>
    locale === "hy" ? v.hy : (v.en ?? v.hy);
  const numeric = ["number", "scale", "blood-pressure"].includes(field.kind);
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        {text(field.label)}
      </Text>
      {field.help && <Text style={styles.muted}>{text(field.help)}</Text>}
      {numeric
        ? fieldKeys(field).map((id) => {
            const part = id.split(".").at(-1)!,
              bounds =
                field.kind === "blood-pressure" ? field.parts?.[part] : field,
              label =
                field.kind === "blood-pressure"
                  ? part === "systolic"
                    ? locale === "hy"
                      ? "Սիստոլիկ"
                      : "Systolic"
                    : locale === "hy"
                      ? "Դիաստոլիկ"
                      : "Diastolic"
                  : text(field.label);
            return (
              <View key={id}>
                <Text style={styles.text}>
                  {label}
                  {field.unit ? " (" + text(field.unit) + ")" : ""}
                </Text>
                <Text style={styles.muted}>
                  {bounds?.min}–{bounds?.max}
                </Text>
                <TextInput
                  style={styles.input}
                  accessibilityLabel={label}
                  editable={!disabled}
                  keyboardType="decimal-pad"
                  maxLength={12}
                  value={
                    raw[id] === UNKNOWN
                      ? ""
                      : typeof raw[id] === "string"
                        ? raw[id]
                        : ""
                  }
                  placeholder={
                    raw[id] === UNKNOWN
                      ? journeyCopy[locale].unknown
                      : undefined
                  }
                  onChangeText={(v) => onChange({ ...raw, [id]: v })}
                />
              </View>
            );
          })
        : field.options?.map((option) => {
            const current = raw[field.id],
              multi = field.kind === "multi",
              selected = multi
                ? Array.isArray(current) && current.includes(option.value)
                : current === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole={multi ? "checkbox" : "radio"}
                accessibilityLabel={text(option.label)}
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                style={[styles.button, !selected && styles.secondary]}
                onPress={() => {
                  let value: string | string[] = option.value;
                  if (multi) {
                    const values = Array.isArray(current) ? current : [],
                      exclusive = field.exclusiveValue ?? NONE;
                    value = selected
                      ? values.filter((v) => v !== option.value)
                      : option.value === exclusive
                        ? [exclusive]
                        : [
                            ...values.filter((v) => v !== exclusive),
                            option.value,
                          ];
                  }
                  onChange({ ...raw, [field.id]: value });
                }}
              >
                <Text
                  style={[styles.buttonText, !selected && styles.secondaryText]}
                >
                  {text(option.label)}
                </Text>
              </Pressable>
            );
          })}
      {(field.skippable || field.kind === "blood-pressure") && (
        <Button
          title={
            field.skipLabel
              ? text(field.skipLabel)
              : journeyCopy[locale].unknown
          }
          secondary
          disabled={disabled}
          onPress={() =>
            onChange(
              Object.fromEntries(fieldKeys(field).map((id) => [id, UNKNOWN])),
            )
          }
        />
      )}
      {field.scaleLabels && (
        <Text style={styles.muted}>
          {text(field.scaleLabels.low)} · {text(field.scaleLabels.high)}
        </Text>
      )}
    </View>
  );
}
