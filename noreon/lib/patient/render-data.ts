import "server-only";
import { requireRegistered } from "./repository";

// RSC presentation only. Never use this reader for actions, routes, writes or
// authorization at a mutation boundary. Those must keep using the fresh readers.
export async function requireRegisteredForRender() {
  return requireRegistered();
}
