/** Pipeline API base URL — used by Next.js API routes that proxy to FastAPI. */
export const PIPELINE_API =
  process.env.PIPELINE_API_URL ?? "http://pipeline:8000";
