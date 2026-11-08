/** QA 178: the Tests page's questionnaire suggestions leave out tests that are already ordered,
 * requested, booked or done for the current programme: a home-visit request, a clinic visit or a
 * care-team order (Astra #404 F2). What still counts:
 *  - a request that is not cancelled and belongs to the current questionnaire context (not contextStale);
 *  - a visit of the current programme (or one still open; the countsForProgramme rule) that is
 *    confirmed or waiting for its notice: its programme tests;
 *  - any other visit of the current programme (failed, unknown, reconciliation) only for the tests of
 *    the arrangement it still holds. A failed first booking holds none; a failed change keeps the
 *    accepted visit.
 * A cancelled request or visit, and anything from an earlier programme, no longer covers its tests. */
export function arrangedTestIds(input: {
  requests?: { status: string; contextStale?: boolean; requirements: { id: string }[] }[] | null;
  appointments?: { status: string; program: { id: string }[]; currentProgram?: { id: string }[]; current?: { coveredTestIds: string[] } | null; proposed?: { coveredTestIds: string[] }; programme?: { currentProgramme: boolean; open: boolean } }[] | null;
}): Set<string> {
  const ids = new Set<string>();
  for (const r of input.requests ?? []) if (r.status !== "cancelled" && r.contextStale !== true) for (const t of r.requirements) ids.add(t.id);
  for (const a of input.appointments ?? []) {
    if (a.status === "cancelled" || (a.programme && !a.programme.currentProgramme && !a.programme.open)) continue;
    for (const id of a.current?.coveredTestIds ?? []) ids.add(id);
    if (a.status !== "confirmed" && a.status !== "notification-pending") continue;
    for (const t of a.currentProgram ?? a.program) ids.add(t.id);
    for (const id of a.proposed?.coveredTestIds ?? []) ids.add(id);
  }
  return ids;
}
/** Care-team orders are matched by name: their ids are order rows, not catalogue ids. */
export function withoutArrangedTests<T extends { id: string; name: { hy: string; en?: string; ru?: string } }>(
  suggestions: T[],
  arranged: Set<string>,
  orders: { title: string; status: string }[] = [],
): T[] {
  const ordered = new Set(orders.filter((o) => o.status !== "cancelled").map((o) => o.title.trim().toLowerCase()));
  const names = (t: T) => [t.name.en, t.name.hy, t.name.ru].filter((n): n is string => !!n).map((n) => n.trim().toLowerCase());
  return suggestions.filter((t) => !arranged.has(t.id) && !names(t).some((n) => ordered.has(n)));
}
