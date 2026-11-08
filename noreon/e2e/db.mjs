// Direct access to the suite's own local database, for seeding and for checking what was stored.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const fixtureId = (n) => `e2e00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = () => JSON.parse(readFileSync(process.env.NOREON_E2E_ENV, "utf8"));
export function sql(input) {
  const { container, socket } = env();
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", env: { ...process.env, DOCKER_HOST: `unix://${socket}` } });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
