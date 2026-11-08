/** Next dev may construct request.url with localhost while the browser uses 127.0.0.1. */
export function sameWorkspaceOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === new URL(request.url).origin) return true;
  if (process.env.NODE_ENV === "production") return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname)
      && parsed.host === request.headers.get("host");
  } catch { return false; }
}
