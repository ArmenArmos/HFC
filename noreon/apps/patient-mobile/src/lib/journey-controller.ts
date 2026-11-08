import type {
  JourneySnapshot,
  JourneyTransport,
  JourneyCommand,
} from "./journey-protocol";
export type JourneyState = {
  data: JourneySnapshot | null;
  latest: JourneySnapshot | null;
  phase: "loading" | "ready" | "saving" | "blocked" | "invalid";
  reset: number;
};
/** One member, one write at a time. Recovery reads never retransmit a write. */
export function createJourneyController(transport: JourneyTransport) {
  let state: JourneyState = {
      data: null,
      latest: null,
      phase: "loading",
      reset: 0,
    },
    alive = false,
    pending = false,
    generation = 0,
    minRevision = -1,
    controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: JourneyState) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  function begin() {
    pending = true;
    controller = new AbortController();
    return { signal: controller.signal, id: ++generation };
  }
  const current = (id: number) => alive && id === generation;
  function accept(data: JourneySnapshot) {
    if ((data.state.assessment?.revision ?? -1) < minRevision)
      throw Error("Stale journey");
    return data;
  }
  async function load(discard = true) {
    if (!alive || pending) return null;
    const op = begin();
    const previous = state.data,
      wasBlocked = state.phase === "blocked";
    publish({ ...state, phase: "loading" });
    try {
      const data = accept(await transport.read(op.signal));
      if (!current(op.id)) return null;
      minRevision = Math.max(
        minRevision,
        data.state.assessment?.revision ?? -1,
      );
      const changed =
        !!previous &&
        (previous.state.assessment?.revision ?? -1) !==
          (data.state.assessment?.revision ?? -1);
      publish({
        data: !discard && changed ? previous : data,
        latest: !discard && changed ? data : null,
        phase: !discard && (changed || wasBlocked) ? "blocked" : "ready",
        reset: state.reset + (discard ? 1 : 0),
      });
      return data;
    } catch {
      if (current(op.id)) publish({ ...state, phase: "blocked" });
      return null;
    } finally {
      if (current(op.id)) pending = false;
    }
  }
  async function save(command: JourneyCommand) {
    if (
      !alive ||
      pending ||
      !["ready", "invalid"].includes(state.phase) ||
      !state.data
    )
      return null;
    if (
      command.expectedRevision !== (state.data.state.assessment?.revision ?? -1)
    ) {
      publish({ ...state, phase: "blocked" });
      return null;
    }
    const op = begin();
    publish({ ...state, phase: "saving" });
    try {
      const result = await transport.write(command, op.signal);
      if (!current(op.id)) return null;
      if (!result.ok) {
        publish({
          ...state,
          phase: result.reason === "invalid" ? "invalid" : "blocked",
        });
        return null;
      }
      if (result.revision <= command.expectedRevision)
        throw Error("Invalid revision");
      minRevision = result.revision;
      const data = accept(await transport.read(op.signal));
      if (!current(op.id)) return null;
      minRevision = Math.max(
        minRevision,
        data.state.assessment?.revision ?? -1,
      );
      if ((data.state.assessment?.revision ?? -1) !== result.revision) {
        publish({ ...state, latest: data, phase: "blocked" });
        return null;
      }
      publish({ data, latest: null, phase: "ready", reset: state.reset + 1 });
      return data;
    } catch {
      if (current(op.id)) publish({ ...state, phase: "blocked" });
      return null;
    } finally {
      if (current(op.id)) pending = false;
    }
  }
  return {
    snapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    start() {
      alive = true;
      return load(false);
    },
    stop() {
      alive = false;
      generation++;
      pending = false;
      controller?.abort();
    },
    load,
    save,
  };
}
