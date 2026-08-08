import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "node:util";

// jsdom does not expose TextEncoder/TextDecoder as globals, but any code that
// reads a streamed fetch body (e.g. EpisodeChat's SSE reader loop) constructs
// them. Without this the ReferenceError is swallowed by the component's own
// try/catch and surfaces as a misleading "connection failed" state.
Object.assign(globalThis, {
  TextEncoder: globalThis.TextEncoder ?? TextEncoder,
  TextDecoder: globalThis.TextDecoder ?? TextDecoder,
});
