import nextConfig from "eslint-config-next/core-web-vitals";

export default [
  ...nextConfig,
  {
    rules: {
      // Downgrade to warning — existing patterns use setState in effects
      // for syncing with URL params, localStorage, and external state.
      // TODO: refactor these patterns and re-enable as error
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];
