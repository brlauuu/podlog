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
    value: "gemma4:e4b",
    label: "Gemma 4 e4b",
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
// Issue #636: the previous defaults (qwen2p5-7b-instruct,
// llama-v3p1-70b-instruct, qwen2p5-72b-instruct) all returned 404 from
// Fireworks's serverless endpoint. Replaced with the current
// docs.fireworks.ai/guides/recommended-models picks that are confirmed
// "Available Serverless" on fireworks.ai/models.
export const FIREWORKS_CHAT_MODELS: RagModel[] = [
  {
    value: "accounts/fireworks/models/qwen3-8b",
    label: "Qwen3 8B",
    description: "Fast",
    speedHint: "$0.20/M tokens",
    maxContext: 40960,
    usedContext: 16384,
  },
  {
    value: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    label: "Llama 3.3 70B Instruct",
    description: "Balanced",
    speedHint: "$0.9/M tokens",
    maxContext: 131072,
    usedContext: 16384,
  },
  {
    value: "accounts/fireworks/models/deepseek-v3p1",
    label: "DeepSeek V3.1",
    description: "Quality",
    speedHint: "$0.56/$1.68 per M tokens",
    maxContext: 163840,
    usedContext: 16384,
  },
];

export const DEFAULT_FIREWORKS_CHAT_MODEL = FIREWORKS_CHAT_MODELS[0].value;

export function formatContext(tokens: number): string {
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
