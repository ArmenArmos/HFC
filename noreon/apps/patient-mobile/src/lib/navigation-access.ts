export function memberRouteAllowed(
  enabled: boolean,
  loading: boolean,
  error: boolean,
  session: { user: { id: string; phone_confirmed_at?: string | null } } | null,
) {
  return (
    enabled &&
    !loading &&
    !error &&
    !!session?.user.id &&
    !!session.user.phone_confirmed_at
  );
}
