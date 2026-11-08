export default function WorkspaceLoading() {
  return <div role="status" aria-live="polite" className="space-y-5" aria-busy="true">
    <p className="text-body2 text-muted-foreground">Opening your workspace…</p>
    <div className="h-8 w-48 rounded-md bg-muted" aria-hidden="true" />
    <div className="h-40 rounded-xl bg-muted" aria-hidden="true" />
  </div>;
}
