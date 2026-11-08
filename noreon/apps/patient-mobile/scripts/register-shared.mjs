import { registerHooks } from 'node:module';
const sharedRoot = new URL('../../../lib/', import.meta.url).href;
const nativeZod = import.meta.resolve('zod');
// Match Metro's shared-validator resolution in mobile-only Node test installs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'zod' && context.parentURL?.startsWith(sharedRoot)) {
      return { url: nativeZod, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
