const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

const config = createJestConfig({
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
    "!src/**/__mocks__/**",
  ],
  coverageThreshold: {
    global: {
      statements: 45,
      branches: 35,
      functions: 38,
      lines: 45,
    },
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/tests/unit/**/*.test.{ts,tsx}"],
  // Issue #750: a local `npm run build` populates apps/web/.next/standalone/
  // with copies of __mocks__/ and node_modules/, which trip jest-haste-map
  // ("duplicate manual mock found: react-markdown") and fail 6 suites at
  // collection. Keep haste-map and watcher out of build artifacts.
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  watchPathIgnorePatterns: ["<rootDir>/.next/"],
});

module.exports = config;
