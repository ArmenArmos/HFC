import { AsyncLocalStorage } from "node:async_hooks";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

import type { ActorKind } from "./redact";
import { REQUEST_ID_HEADER, validRequestId } from "./request-id";

/** What every log line inside one request inherits. Ids only; see redact.ts. */
export type LogContext = {
  request_id?: string;
  route?: string;
  method?: string;
  route_type?: string;
  actor_kind?: ActorKind;
  actor_id?: string;
  member_id?: string;
};

// instrumentation.ts (which installs the Supabase fetch hook) and the app are separate bundles,
// each with its own copy of this module, so the stores are shared through globalThis.
type Stores = { own: AsyncLocalStorage<LogContext>; perNextRequest: WeakMap<object, LogContext> };
const shared = globalThis as typeof globalThis & { [key: symbol]: Stores | undefined };
const STORES = Symbol.for("noreon.observability.context");
const stores: Stores = (shared[STORES] ??= { own: new AsyncLocalStorage<LogContext>(), perNextRequest: new WeakMap() });
const own = stores.own;
const perNextRequest = stores.perNextRequest;

/** Route handlers, server actions and sweeps run inside their own context. */
export function runWithLogContext<T>(context: LogContext, run: () => T): T {
  return own.run(context, run);
}

type NextRequestStore = { type: string; headers?: Pick<Headers, "get">; url?: { pathname?: string } };

/**
 * Server components have no wrapper of ours, so their context hangs off Next's own
 * per-request store (read directly, which does not opt a page into dynamic rendering the
 * way `headers()` would). If a Next upgrade moves that store this returns nothing and log
 * lines simply lose the request id; scripts/check-log-redaction.ts checks the import.
 */
function nextRequestStore(): NextRequestStore | undefined {
  try {
    const store = workUnitAsyncStorage.getStore() as NextRequestStore | undefined;
    return store && store.type === "request" ? store : undefined;
  } catch {
    return undefined;
  }
}

/** One header of the current Next request, read without `headers()`. */
export function nextRequestHeader(name: string): string | undefined {
  try {
    return nextRequestStore()?.headers?.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

export function currentLogContext(): LogContext | undefined {
  const mine = own.getStore();
  if (mine) return mine;
  const store = nextRequestStore();
  if (!store) return undefined;
  let context = perNextRequest.get(store);
  if (!context) {
    let requestId: string | null | undefined;
    try {
      requestId = store.headers?.get(REQUEST_ID_HEADER);
    } catch {
      requestId = undefined;
    }
    context = { request_id: validRequestId(requestId) ? requestId : undefined, route: store.url?.pathname, route_type: "page" };
    perNextRequest.set(store, context);
  }
  return context;
}

/** Called by the sign-in helpers once they know who is acting. Ids that are not uuids are ignored by redaction. */
export function noteActor(kind: ActorKind, id?: string | null): void {
  const context = currentLogContext();
  if (!context) return;
  context.actor_kind = kind;
  context.actor_id = id ?? undefined;
}

export function noteMember(id: string | null | undefined): void {
  const context = currentLogContext();
  if (context && id) context.member_id = id;
}
