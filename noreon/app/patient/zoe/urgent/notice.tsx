"use client";
import { useEffect, useState } from "react";
import type { CareAlertZoeStatus } from "@/lib/care-alerts/member";
import { readZoeUrgentStatus } from "./actions";

const WAIT_MS = 3_000;
const WAIT_TRIES = 20;

/**
 * Says whether the care team was told, only once the database knows: the screen opens before the alert exists, so while
 * it is pending, or the status cannot be read, this says nothing and the screen's own 103 lines stand. It reads the status
 * directly rather than refreshing the route: a route refresh that gets a bad response falls back to a full page load,
 * which could replace the 103 screen with an error page.
 */
export function ZoeUrgentNotice({ request, initial, told, notTold, retryUnknown = false }: { request: string | null; initial: CareAlertZoeStatus | null; told: string; notTold: string; retryUnknown?: boolean }) {
  const [status, setStatus] = useState(initial);
  const waiting = status?.pending === true || (retryUnknown && status === null);
  useEffect(() => {
    if (!waiting || !request) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const read = async () => {
      const next = await readZoeUrgentStatus(request).catch(() => null);
      if (stopped) return;
      tries += 1;
      if (next && !next.pending) setStatus(next);
      else if (tries < WAIT_TRIES) timer = setTimeout(read, WAIT_MS);
    };
    timer = setTimeout(read, WAIT_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [waiting, request]);
  return (
    <div role="status" className="empty:hidden">
      {status && !status.pending && <p className="text-body2 text-muted-foreground">{status.alerted ? told : notTold}</p>}
    </div>
  );
}
