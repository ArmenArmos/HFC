import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens as t } from "./tokens";
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary && styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Card({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {children}
    </View>
  );
}
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: t["surface-page"] },
  content: {
    padding: t["space-6"],
    gap: t["space-6"],
    paddingBottom: t["space-8"],
  },
  brand: {
    fontFamily: "Manrope_700Bold",
    fontSize: t["text-h2-size"],
    color: t["text-strong"],
  },
  title: {
    fontFamily: "Manrope_700Bold",
    fontSize: t["text-h1-size"],
    lineHeight: t["text-h1-line"],
    color: t["text-strong"],
  },
  heading: {
    fontFamily: "Manrope_700Bold",
    fontSize: t["text-h2-size"],
    lineHeight: t["text-h2-line"],
    color: t["text-strong"],
  },
  text: {
    fontFamily: "Inter_400Regular",
    fontSize: t["text-body1-size"],
    lineHeight: t["text-body1-line"],
    color: t["text-body"],
  },
  muted: {
    fontFamily: "Inter_400Regular",
    fontSize: t["text-body2-size"],
    lineHeight: t["text-body2-line"],
    color: t["text-muted"],
  },
  card: {
    backgroundColor: t["surface-card"],
    borderRadius: t["radius-md"],
    padding: t["space-6"],
    gap: t["space-3"],
  },
  button: {
    backgroundColor: t["action-primary-bg"],
    minHeight: t["control-height-lg"],
    borderRadius: t["radius-sm"],
    padding: t["space-4"],
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    fontFamily: "Inter_400Regular",
    fontSize: t["text-body1-size"],
    color: t["action-primary-fg"],
  },
  secondary: {
    backgroundColor: t["surface-card"],
    borderWidth: 1,
    borderColor: t["border-default"],
  },
  secondaryText: { color: t["text-strong"] },
  utilityActions: { gap: t["space-2"], alignItems: "flex-start" },
  utilityAction: {
    minHeight: t["control-height-lg"],
    paddingHorizontal: t["space-3"],
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
  input: {
    backgroundColor: t["surface-card"],
    borderWidth: 1,
    borderColor: t["border-default"],
    borderRadius: t["radius-sm"],
    minHeight: t["control-height-lg"],
    padding: t["space-4"],
    fontSize: t["text-body1-size"],
    color: t["text-body"],
  },
  error: {
    fontFamily: "Inter_400Regular",
    fontSize: t["text-body1-size"],
    color: t["status-danger-fg"],
  },
  row: {
    gap: t["space-2"],
    paddingVertical: t["space-3"],
    borderBottomWidth: 1,
    borderBottomColor: t["border-divider"],
  },
  languages: { flexDirection: "row", gap: t["space-3"], alignSelf: "flex-end" },
  center: {
    flex: 1,
    justifyContent: "center",
    padding: t["space-6"],
    gap: t["space-4"],
  },
});
