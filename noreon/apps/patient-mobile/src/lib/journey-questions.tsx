import { useState } from "react";
import { Text, View } from "react-native";
import {
  activeFields,
  assessmentProgress,
  mergeAnswers,
  fieldComplete,
} from "../../../../lib/patient/questionnaire";
import { firesEmergency, ruleById } from "../../../../lib/clinical/rules/rules";
import type { AssessmentField, Answers } from "../../../../lib/clinical/types";
import type { JourneySnapshot, JourneyCommand } from "./journey-protocol";
import type { Locale } from "./copy";
import {
  JourneyField,
  fieldRaw,
  fieldEntries,
  fieldKeys,
  type RawAnswers,
} from "./journey-field";
import { Button, styles } from "./ui";
import { journeyCopy } from "./journey-copy";
export function JourneyQuestions({
  data,
  reset,
  locale,
  disabled,
  onSave,
  onClose,
}: {
  data: JourneySnapshot;
  reset: number;
  locale: Locale;
  disabled: boolean;
  onSave: (c: JourneyCommand) => Promise<JourneySnapshot | null>;
  onClose: () => void;
}) {
  const answers = data.state.assessment?.answers ?? {},
    fields = activeFields(answers).filter((f) => f.topic.id !== "q1"),
    first = fields.find((f) => !fieldComplete(f, answers)) ?? fields[0];
  const savedUrgent =
    firesEmergency({ answers, observations: [] }) ??
    (data.state.assessment?.urgentRule
      ? ruleById(data.state.assessment.urgentRule)
      : undefined);
  const trigger = savedUrgent?.evaluate({
    answers,
    observations: [],
  })?.triggeredBy;
  const [selected, setSelected] = useState(first?.id ?? "summary");
  const [drafts, setDrafts] = useState<Record<string, RawAnswers>>({});
  const forgetDraft = (id: string) => setDrafts((current) => {
    const next = { ...current };
    delete next[id];
    return next;
  });
  const field =
      savedUrgent || data.state.assessment?.urgentRule
        ? (fields.find(
            (f) => trigger === f.id || trigger?.startsWith(f.id + "."),
          ) ?? first)
        : (fields.find((f) => f.id === selected) ??
          (selected === "summary" ? undefined : first)),
    c = journeyCopy[locale],
    progress = assessmentProgress(answers);
  const complete = async () => {
    const saved = await onSave({
      type: "complete",
      expectedRevision: data.state.assessment?.revision ?? -1,
    });
    if (
      saved?.state.assessment?.completedAt &&
      !saved.state.assessment.urgentRule
    )
      onClose();
  };
  return (
    <View style={styles.content}>
      <Text style={styles.muted}>
        {c.progress}: {progress.completedTopics}/{progress.totalTopics}
      </Text>
      {field ? (
        <QuestionEditor
          key={field.id + ":" + reset}
          field={field}
          answers={answers}
          draft={drafts[field.id]}
          onDraft={(raw) => setDrafts((current) => ({ ...current, [field.id]: raw }))}
          data={data}
          disabled={disabled}
          canGoBack={fields.findIndex((f) => f.id === field.id) > 0}
          locale={locale}
          onSave={async (command) => {
            const saved = await onSave(command);
            if (saved) forgetDraft(field.id);
            return saved;
          }}
          move={(direction, saved) => {
            const nextFields = activeFields(
                saved.state.assessment?.answers ?? {},
              ).filter((f) => f.topic.id !== "q1"),
              index = nextFields.findIndex((f) => f.id === field.id);
            setSelected(
              nextFields[Math.max(0, index + direction)]?.id ?? "summary",
            );
          }}
          onClose={onClose}
        />
      ) : (
        <>
          <Text style={styles.text}>{c.ready}</Text>
          <Button
            title={c.review}
            secondary
            disabled={disabled}
            onPress={() => setSelected(fields[0]?.id ?? "summary")}
          />
          {progress.complete && !data.state.assessment?.urgentRule && (
            <Button
              title={c.complete}
              disabled={disabled}
              onPress={() => {
                void complete();
              }}
            />
          )}
        </>
      )}
    </View>
  );
}
function QuestionEditor({
  field,
  answers,
  draft,
  onDraft,
  data,
  disabled,
  canGoBack,
  locale,
  onSave,
  move,
  onClose,
}: {
  field: AssessmentField;
  answers: Answers;
  draft?: RawAnswers;
  onDraft: (raw: RawAnswers) => void;
  data: JourneySnapshot;
  disabled: boolean;
  canGoBack: boolean;
  locale: Locale;
  onSave: (c: JourneyCommand) => Promise<JourneySnapshot | null>;
  move: (d: number, s: JourneySnapshot) => void;
  onClose: () => void;
}) {
  const raw = draft ?? fieldRaw(field, answers),
    [invalid, setInvalid] = useState(false),
    c = journeyCopy[locale];
  let pending = answers;
  let ready = false;
  try {
    pending = mergeAnswers(answers, fieldEntries(field, raw));
    ready = fieldComplete(field, pending);
  } catch {}
  const hasSavedAnswer = fieldKeys(field).some((id) => answers[id] !== undefined);
  const urgent =
    firesEmergency({ answers: pending, observations: [] }) ??
    (data.state.assessment?.urgentRule
      ? ruleById(data.state.assessment.urgentRule)
      : undefined);
  const dirty =
    JSON.stringify(raw) !== JSON.stringify(fieldRaw(field, answers));
  async function save(direction: number) {
    if (disabled) return;
    if (direction < 0 && !ready && !urgent && !data.state.assessment?.urgentRule) {
      // Unfinished values remain a local draft, never a clinical answer.
      onDraft(raw);
      move(direction, data);
      return;
    }
    try {
      const entries = fieldEntries(field, raw),
        merged = mergeAnswers(answers, entries);
      if (!fieldComplete(field, merged)) throw Error();
      setInvalid(false);
      const saved = await onSave({
        type: "answers",
        expectedRevision: data.state.assessment!.revision,
        entries,
      });
      if (saved && !saved.state.assessment?.urgentRule &&
          !firesEmergency({ answers: saved.state.assessment?.answers ?? {}, observations: [] }))
        move(direction, saved);
    } catch {
      setInvalid(true);
    }
  }
  const text = (v: { hy: string; en?: string }) =>
    locale === "hy" ? v.hy : (v.en ?? v.hy);
  return (
    <>
      {(urgent || data.state.assessment?.urgentRule) && (
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.error}>
            {c.urgent}
          </Text>
          {urgent && (
            <>
              <Text style={styles.text}>{text(urgent.reason)}</Text>
              {urgent.nextStep && (
                <Text style={styles.text}>{text(urgent.nextStep)}</Text>
              )}
            </>
          )}
          <Text style={styles.muted}>{c.correct}</Text>
        </View>
      )}
      <JourneyField
        field={field}
        raw={raw}
        onChange={onDraft}
        disabled={disabled}
        locale={locale}
      />
      {dirty && !ready && canGoBack && !urgent && (
        <Text style={styles.muted}>{c.draft}</Text>
      )}
      {invalid && (
        <Text accessibilityRole="alert" style={styles.error}>
          {c.invalid}
        </Text>
      )}
      <Button
        title={c.next}
        disabled={disabled || !ready}
        onPress={() => {
          void save(1);
        }}
      />
      {canGoBack && (
        <Button
          title={c.back}
          secondary
          disabled={disabled}
          onPress={() => {
            void save(-1);
          }}
        />
      )}
      {hasSavedAnswer && (
        <Button
          title={c.clear}
          secondary
          disabled={disabled}
          onPress={() => {
            void onSave({
              type: "answers",
              expectedRevision: data.state.assessment!.revision,
              entries: fieldKeys(field).map((fieldId) => ({
                fieldId,
                value: null,
              })),
            });
          }}
        />
      )}
      {!dirty &&
        !urgent &&
        data.state.assessment?.completedAt &&
        !data.state.assessment.urgentRule && (
          <Button
            title={c.close}
            secondary
            disabled={disabled}
            onPress={onClose}
          />
        )}
    </>
  );
}
