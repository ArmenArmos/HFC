import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./alias-hook.mjs", import.meta.url).href, pathToFileURL("./"));
