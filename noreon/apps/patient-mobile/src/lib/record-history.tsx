import { useEffect, useRef, useState, type ReactNode } from "react";
import { Text } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../lib/db/types";
import { clientFor } from "./actions";
import {
  abortableHistory,
  type HistoryCursor,
  type HistoryPage,
} from "./history";
import { copy, type Locale } from "./copy";
import { Button, Card, styles } from "./ui";
export function RecordHistory<T extends { id: string }>({
  initial,
  read,
  renderRow,
  title,
  userId,
  locale,
  unavailable,
}: {
  initial: HistoryPage<T>;
  read: (
    client: SupabaseClient<Database>,
    signal: AbortSignal,
    cursor: HistoryCursor | null,
  ) => Promise<HistoryPage<T>>;
  renderRow: (row: T) => ReactNode;
  title: string;
  userId: string;
  locale: Locale;
  unavailable: boolean;
}) {
  const c = copy[locale],
    [page, setPage] = useState(initial),
    [cursors, setCursors] = useState<(HistoryCursor | null)[]>([null]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  async function go(next: (HistoryCursor | null)[]) {
    if (pending.current || unavailable) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(false);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await abortableHistory(async () => {
        const client = await clientFor(userId, controller.signal);
        if (controller.signal.aborted) throw Error("Cancelled");
        return read(client, controller.signal, next.at(-1) ?? null);
      }, controller.signal);
      if (alive.current && !controller.signal.aborted) {
        setPage(result);
        setCursors(next);
      }
    } catch {
      if (alive.current) setError(true);
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) {
        pending.current = null;
        if (alive.current) setLoading(false);
      }
    }
  }
  return (
    <Card title={title}>
      {page.rows.length === 0 ? (
        <Text style={styles.muted}>{c.none}</Text>
      ) : (
        page.rows.map(renderRow)
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {c.error}
        </Text>
      )}
      {loading && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {c.loading}
        </Text>
      )}
      {cursors.length > 1 && (
        <Button
          title={c.newer}
          secondary
          disabled={loading || unavailable}
          onPress={() => void go(cursors.slice(0, -1))}
        />
      )}
      {page.next ? (
        <Button
          title={c.older}
          secondary
          disabled={loading || unavailable}
          onPress={() => void go([...cursors, page.next])}
        />
      ) : (
        page.rows.length > 0 && <Text style={styles.muted}>{c.historyEnd}</Text>
      )}
    </Card>
  );
}
