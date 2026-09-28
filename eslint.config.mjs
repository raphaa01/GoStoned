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
    ".next-stale-codex/**",
    "out/**",
    "build/**",
    "mobile-dist/**",
    ".mobile-assets/**",
    ".mobile-cache/**",
    "android/**/build/**",
    "android/app/src/main/assets/**",
    "ios/App/App/public/**",
    "native/gostone-katago/android/.gradle/**",
    "native/gostone-katago/android/build/**",
    "native/gostone-katago/.build/**",
    "next-env.d.ts",
    "public/bot-runtime/**",
  ]),
]);

export default eslintConfig;
