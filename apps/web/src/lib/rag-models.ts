export interface RagModel {
  value: string;
  label: string;
  description: string;
  speedHint: string;
  maxContext: number;
  usedContext: number;
}

export const RAG_MODELS: RagModel[] = [
  {
    value: "qwen2.5:3b",
    label: "Qwen2.5 3B",
    description: "Default",
    speedHint: "3-4 tok/s",
    maxContext: 32768,
    usedContext: 8192,
  },
  {
    value: "phi3:mini",
    label: "Phi-3 mini 3.8B",
    description: "Quality",
    speedHint: "2-3 tok/s",
    maxContext: 131072,
    usedContext: 16384,
  },
  {
    value: "gemma3n:e4b",
    label: "Gemma 3n E4B",
    description: "Modern",
    speedHint: "new — untested on CPU",
    maxContext: 131072,
    usedContext: 16384,
  },
];

export const DEFAULT_RAG_MODEL = "qwen2.5:3b";

// Issue #608: curated Fireworks chat models exposed when rag_provider=fireworks.
// Picked from currently-deployed Fireworks chat models with stable instruct
// variants — one cheap/fast, one mid-tier balanced, one high-quality. Update
// this list (and only this list) if a model is deprecated.
//
// Issue #636: Fireworks deprecates serverless models on a regular cadence.
// The previous defaults (qwen2p5-*, llama-v3p1-70b) 404'd; the next round
// (qwen3-8b, llama-v3p3-70b, deepseek-v3p1) was announced as obsolete in a
// May 2026 deprecation notice. Current picks follow Fireworks's stated
// migration targets:
//   qwen3-8b              → gpt-oss-20b
//   llama-v3p3-70b        → gpt-oss-120b
//   deepseek-v3p1 / glm-* → glm-5p1
// All three are confirmed "Available Serverless" on fireworks.ai/models.
export const FIREWORKS_CHAT_MODELS: RagModel[] = [
  {
    value: "accounts/fireworks/models/gpt-oss-20b",
    label: "OpenAI gpt-oss 20B",
    description: "Fast",
    speedHint: "$0.07/$0.30 per M tokens",
    maxContext: 131072,
    usedContext: 16384,
  },
  {
    value: "accounts/fireworks/models/gpt-oss-120b",
    label: "OpenAI gpt-oss 120B",
    description: "Balanced",
    speedHint: "$0.15/$0.60 per M tokens",
    maxContext: 131072,
    usedContext: 16384,
  },
  {
    value: "accounts/fireworks/models/glm-5p1",
    label: "GLM 5.1",
    description: "Quality",
    speedHint: "$1.40/$4.40 per M tokens",
    maxContext: 202752,
    usedContext: 16384,
  },
];

export const DEFAULT_FIREWORKS_CHAT_MODEL = FIREWORKS_CHAT_MODELS[0].value;

function formatContext(tokens: number): string {
  if (tokens >= 1024) {
    const k = tokens / 1024;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return `${tokens}`;
}

export function formatModelOption(m: RagModel): string {
  const ctx = `${formatContext(m.usedContext)} used / ${formatContext(m.maxContext)} max`;
  return `${m.label} — ${m.description} · ${ctx}`;
}
