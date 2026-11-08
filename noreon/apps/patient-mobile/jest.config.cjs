const jestExpo = require("jest-expo/jest-preset");

// The shared staff-name helper (lib/member-staff-name.mjs) is plain ESM so native Node checks can load it; Jest must transform it like the TypeScript files.
module.exports = {
  preset: "jest-expo",
  transform: { "\\.mjs$": jestExpo.transform["\\.[jt]sx?$"] },
  testMatch: ["<rootDir>/tests/**/*.test.tsx"],
  resolver: "<rootDir>/scripts/jest-resolver.cjs",
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/../../$1" },
  transformIgnorePatterns: [
    "node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-screens|react-native-safe-area-context|decode-uri-component|standard-navigation))",
  ],
};
