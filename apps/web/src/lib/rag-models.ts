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
