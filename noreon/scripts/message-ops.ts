import { open } from "node:fs/promises";
import { messageOperatorRuntime } from "@/lib/messaging/runtime";
import {
  parseMessageOperation,
  requireMessageOperations,
  runMessageOperation,
} from "@/lib/messaging/operations";
try {
  // Validate the command and explicit gate before constructing any privileged client.
  const command = parseMessageOperation(process.argv.slice(2));
  requireMessageOperations(process.env);
  let spendConfiguration: unknown;
  if (command[0] === "spend-configure") {
    const file = await open(command[3], "r");
    try {
      const buffer = Buffer.alloc(16_385);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 16_384) throw Error("invalid");
      spendConfiguration = JSON.parse(
        buffer.subarray(0, bytesRead).toString("utf8"),
      );
    } finally {
      await file.close();
    }
  }
  const runtime = messageOperatorRuntime(process.argv[2] === "reconcile");
  const result = await runMessageOperation(
    process.argv.slice(2),
    runtime.db(),
    runtime.config,
    spendConfiguration,
  );
  console.log(JSON.stringify(result, null, 2));
  if ("halted" in result && result.halted) process.exitCode = 1;
} catch {
  // Provider/DB errors can contain recipient identifiers. Never print raw exceptions.
  console.error(
    "Message operation unavailable. Check command, explicit operations flag, dedicated real-project credentials and database state.",
  );
  process.exitCode = 1;
}
