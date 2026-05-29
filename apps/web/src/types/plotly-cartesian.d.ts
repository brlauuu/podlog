// Issue #746: react-plotly.js's factory is fed a Plotly module reference
// at runtime. We don't consume the module's API directly in TS, so we
// only need a minimal `declare module` shim — the @types/plotly.js types
// still cover Data/Layout/Config that the charts use.
declare module "plotly.js-cartesian-dist-min";
declare module "react-plotly.js/factory";
