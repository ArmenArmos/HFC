import { pathToFileURL } from "node:url";

/**
 * Resolves the `@/` alias for scripts run directly through Node.
 *
 * The check scripts import the app's own modules rather than a copy of them,
 * which is the only way a check can be evidence about the shipped code. Node
 * does not read tsconfig paths, so the alias is resolved here.
 */
const ROOT = pathToFileURL(process.cwd() + "/").href;

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    const file = (context.conditions.includes("react-server") || context.conditions.includes("noreon-server-test")) ? "empty" : "index";
    return next(`next/dist/compiled/server-only/${file}.js`, context);
  }
  if (specifier.startsWith("@/")) {
    const base = ROOT + specifier.slice(2);
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      try {
        return await next(base + ext, context);
      } catch {
        // Try the next extension.
      }
    }
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    for (const suffix of ["", ".ts", ".tsx", "/index.ts"]) {
      try { return await next(specifier + suffix, context); } catch { /* try extension */ }
    }
  }
  if (specifier.startsWith("next/") && !specifier.endsWith(".js")) return next(specifier + ".js", context);
  return next(specifier, context);
}

// Component checks import TSX transitively; Node's native TS stripping does not
// transform JSX. Keep the same alias resolution and transpile only those files.
export async function load(url, context, nextLoad) {
  // Styles do not affect markup assertions in Node component checks.
  if (url.endsWith(".css")) {
    return { format: "module", shortCircuit: true, source: "export {};" };
  }
  if (url.endsWith(".tsx")) {
    const [{ readFile }, { default: ts }] = await Promise.all([
      import("node:fs/promises"), import("typescript"),
    ]);
    const source = await readFile(new URL(url), "utf8");
    return { format: "module", shortCircuit: true, source: ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  }
  return nextLoad(url, context);
}
