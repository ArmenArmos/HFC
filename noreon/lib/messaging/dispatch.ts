import "server-only";
import { messageDispatchRuntime } from "./runtime";
import { messageWorkerStore, readMessageSpendPolicy } from "./store";
import { assertMessagePreflight } from "./spend";
import { runMessageWorker } from "./worker";
import { createTwilioTransport, submitPlanMessage, twilioAvailableChannels } from "./twilio";
export async function dispatchMessages() {
  if (
    process.env.NOREON_MESSAGE_DELIVERY_ENABLED !== "true" ||
    process.env.NOREON_MESSAGE_RECOVERY_READY !== "true"
  )
    throw Error("disabled");
  const runtime = messageDispatchRuntime();
  if (!runtime) throw Error("disabled");
  const db = runtime.db();
  const policy = await readMessageSpendPolicy(db);
  assertMessagePreflight(runtime.config, policy);
  // Pin this policy revision at the atomic reservation boundary.
  const transport = createTwilioTransport(runtime.config);
  return runMessageWorker(messageWorkerStore(db, policy.revision, twilioAvailableChannels(runtime.config)), (input) =>
    submitPlanMessage(runtime.config, input, transport),
  );
}
