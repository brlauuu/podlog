const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

const config = createJestConfig({
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/tests/unit/**/*.test.{ts,tsx}"],
});

module.exports = config;
