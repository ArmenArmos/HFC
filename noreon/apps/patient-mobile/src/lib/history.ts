import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../lib/db/types";
export const HISTORY_PAGE_SIZE = 20;
export type HistoryCursor = { id: string; at: string };
export type HistoryPage<T> = { rows: T[]; next: HistoryCursor | null };
type TimeColumn = "measured_at" | "collected_at";
export function historyFilter(column: TimeColumn, cursor: HistoryCursor) {
  if (
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(cursor.id) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(
      cursor.at,
    ) ||
    !Number.isFinite(Date.parse(cursor.at))
  )
    throw Error("Invalid history cursor");
  return `${column}.lt.${cursor.at},and(${column}.eq.${cursor.at},id.lt.${cursor.id})`;
}
export function historyPage<
  K extends TimeColumn,
  T extends { id: string } & Record<K, string>,
>(data: T[], column: K): HistoryPage<T> {
  const rows = data.slice(0, HISTORY_PAGE_SIZE),
    last = rows.at(-1);
  return {
    rows,
    next:
      data.length > HISTORY_PAGE_SIZE && last
        ? { id: last.id, at: last[column] }
        : null,
  };
}
export async function readMeasurementHistory(
  client: SupabaseClient<Database>,
  signal: AbortSignal,
  cursor: HistoryCursor | null = null,
) {
  let query = client
    .from("patient_measurements")
    .select("id,systolic,diastolic,pulse,measured_at")
    .order("measured_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_PAGE_SIZE + 1)
    .abortSignal(signal);
  if (cursor) query = query.or(historyFilter("measured_at", cursor));
  const result = await query;
  if (result.error) throw Error("Records unavailable");
  return historyPage(result.data, "measured_at");
}
export async function readResultHistory(
  client: SupabaseClient<Database>,
  signal: AbortSignal,
  cursor: HistoryCursor | null = null,
) {
  let query = client
    .from("patient_care_results")
    .select("id,marker,value,unit,collected_at")
    .not("reviewed_at", "is", null)
    .not("reviewed_by", "is", null)
    .order("collected_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_PAGE_SIZE + 1)
    .abortSignal(signal);
  if (cursor) query = query.or(historyFilter("collected_at", cursor));
  const result = await query;
  if (result.error) throw Error("Records unavailable");
  return historyPage(result.data, "collected_at");
}

export { abortableRequest as abortableHistory } from "./request.ts";
