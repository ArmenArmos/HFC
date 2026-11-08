interface ActionAuth {
  getSession(): Promise<{
    data: { session: { access_token: string } | null };
    error: unknown;
  }>;
  getUser(token: string): Promise<{
    data: { user: { id: string; phone_confirmed_at?: string | null } | null };
    error: unknown;
  }>;
}
/** Freeze the token before async verification so account switching cannot retarget a write. */
export async function verifiedActionClient<T>(
  expectedId: string,
  auth: ActionAuth,
  bind: (token: string) => T,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw Error("Cancelled");
  const session = await auth.getSession();
  if (signal?.aborted) throw Error("Cancelled");
  const token = session.data.session?.access_token;
  if (session.error || !token) throw Error("identity");
  const identity = await auth.getUser(token);
  if (signal?.aborted) throw Error("Cancelled");
  if (
    identity.error ||
    identity.data.user?.id !== expectedId ||
    !identity.data.user.phone_confirmed_at
  )
    throw Error("identity");
  return bind(token);
}
