import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "apps/patient-mobile/**", // Independently checked with Expo tooling.
    // Local generated test artifacts are not product source.
    ".superpowers/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, and must stay byte for byte identical to its source so an
    // update is a copy. Linting it only produces findings we are not allowed
    // to act on. See styles/noreon/README.md.
    "styles/noreon/validate-palette.mjs",
  ]),
]);

export default eslintConfig;
