/** Use stable ordering in the query. Supabase caps an unpaginated read. */
export async function readAllPages<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await read(from, from + 499);
    if (error || !data) throw new Error("Care history unavailable");
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
