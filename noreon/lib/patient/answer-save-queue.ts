import type { FieldValue } from "@/lib/clinical/types";
type Entry = { fieldId: string; value: FieldValue | null };
type Result = { ok: true; revision: number } | { ok: false; reason?: string } | null;

/** A failed request retains its batch and revision; later batches never overtake it. */
export class AnswerSaveQueue {
  revision: number;
  failure: Exclude<Result, { ok: true; revision: number }> | undefined;
  private batches: Array<{ entries: Entry[]; fingerprint?: string }> = [];
  private cancelled = false;
  private running: Promise<boolean> | undefined;
  private save: (revision: number, entries: Entry[], fingerprint?: string) => Promise<Result>;
  private changed: () => void;
  private retryDelaysMs: readonly number[];
  /** retryDelaysMs: a transient failure (no answer, or "unavailable") is retried quietly after each delay before it is shown. */
  constructor(revision: number, save: (revision: number, entries: Entry[], fingerprint?: string) => Promise<Result>, changed: () => void = () => {}, retryDelaysMs: readonly number[] = []) {
    this.revision = revision;
    this.save = save;
    this.changed = changed;
    this.retryDelaysMs = retryDelaysMs;
  }
  subscribe(changed: () => void) {
    this.changed = changed;
    return () => { if (this.changed === changed) this.changed = () => {}; };
  }
  cancel() {
    this.cancelled = true;
    this.batches = [];
    this.failure = undefined;
    this.changed = () => {};
  }
  get pending() { return this.batches.length > 0; }
  /** fingerprint: the answer set the caller holds once this batch is stored (answersFingerprint). */
  enqueue(entries: Entry[], fingerprint?: string) {
    if (this.cancelled) return;
    this.batches.push({ entries: entries.map(entry => ({ ...entry, value: Array.isArray(entry.value) ? [...entry.value] : entry.value })), fingerprint });
    this.changed();
    if (this.failure === undefined) void this.flush();
  }
  flush(): Promise<boolean> {
    if (this.cancelled) return Promise.resolve(false);
    if (this.running) return this.running;
    if (this.failure !== undefined) return Promise.resolve(false);
    if (!this.pending) return Promise.resolve(true);
    // Defer starting until `running` is assigned, even for synchronous transports.
    this.running = Promise.resolve().then(async () => {
      while (this.batches.length) {
        let result: Result = null;
        for (let attempt = 0; ; attempt++) {
          try { result = await this.save(this.revision, this.batches[0].entries, this.batches[0].fingerprint); } catch { result = null; }
          if (this.cancelled) return false;
          const transient = !result || (!result.ok && result.reason === "unavailable");
          if (!transient || attempt >= this.retryDelaysMs.length) break;
          await new Promise(resolve => setTimeout(resolve, this.retryDelaysMs[attempt]));
          if (this.cancelled) return false;
        }
        if (!result?.ok) { this.failure = result; this.changed(); return false; }
        this.revision = result.revision;
        this.batches.shift();
        this.changed();
      }
      return true;
    }).finally(() => { this.running = undefined; });
    return this.running;
  }
  retry(): Promise<boolean> {
    if (this.cancelled) return Promise.resolve(false);
    if (this.failure && this.failure.reason === "conflict") return Promise.resolve(false);
    this.failure = undefined;
    this.changed();
    return this.flush();
  }
}
