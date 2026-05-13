/**
 * Pipeline-step descriptors + shared display helpers for the Remote
 * Inference settings section (split out of RemoteInferenceSectionParts
 * in #663). Re-exported from RemoteInferenceSectionParts for back-compat.
 */
import type { Settings } from "./NotificationSettingsSections";
import { RAG_MODELS, FIREWORKS_CHAT_MODELS } from "@/lib/rag-models";

export interface HardwareInfo {
  hardware: {
    cpu: string;
    cores: number;
    ram_gb: number;
    gpu: string | null;
  } | null;
  profile: string | null;
  profile_label: string | null;
  estimates: {
    transcription_minutes_per_hour: number | null;
    embedding_seconds_per_hour: number | null;
    remote_transcription_minutes_per_hour: number;
    remote_embedding_seconds_per_hour: number;
    remote_cost_per_hour_usd: number;
  };
}

export interface PipelineStep {
  key: string;
  title: string;
  description: string;
  remoteAvailable: boolean;
  disabledReason?: string;
  providerField: keyof Settings | null;
  localModels: { value: string; label: string }[];
  remoteModels: { value: string; label: string }[];
  modelField: keyof Settings | null;
  remoteModelField: keyof Settings | null;
  // When non-default (Fireworks), specify which provider-enum value means
  // "remote" and which settings field holds the key. Optional so existing
  // Fireworks-backed steps keep their current behavior.
  remoteProviderValue?: string;
  localProviderValue?: string;
  apiKeyField?: keyof Settings;
  apiKeyLabel?: string; // shown in the "API key required" dialog
}

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    key: "transcription",
    title: "Transcription",
    description:
      "Converts audio to text using speech recognition. This is typically the most time-consuming step in the pipeline.",
    remoteAvailable: true,
    providerField: "inference_provider",
    localModels: [{ value: "large-v3-turbo", label: "WhisperX large-v3-turbo" }],
    remoteModels: [
      { value: "whisper-v3-turbo", label: "Fireworks whisper-v3-turbo" },
    ],
    modelField: null,
    remoteModelField: "fireworks_stt_model",
  },
  {
    key: "diarization",
    title: "Diarization",
    description:
      "Identifies and labels different speakers in the audio. Runs after transcription to assign speaker labels to each segment.",
    remoteAvailable: true,
    providerField: "diarization_provider",
    localModels: [
      {
        value: "pyannote/speaker-diarization-community-1",
        label: "pyannote speaker-diarization-community-1 (default, free)",
      },
      {
        value: "pyannote/speaker-diarization-3.1",
        label: "pyannote speaker-diarization-3.1 (legacy, free)",
      },
    ],
    remoteModels: [
      {
        value: "precision-2",
        label: "pyannote precision-2 (paid, hosted)",
      },
    ],
    modelField: "pyannote_model",
    remoteModelField: "pyannote_cloud_model",
    remoteProviderValue: "precision2",
    localProviderValue: "local",
    apiKeyField: "pyannote_api_key",
    apiKeyLabel: "pyannote cloud API key",
  },
  {
    key: "speaker-inference",
    title: "Speaker Inference",
    description:
      "Infers speaker names from transcript content using named entity recognition (NER).",
    remoteAvailable: false,
    disabledReason:
      "Speaker name inference is currently supported locally only.",
    providerField: null,
    localModels: [
      { value: "en_core_web_trf", label: "spaCy en_core_web_trf (default, ~500 MB)" },
      { value: "en_core_web_lg", label: "spaCy en_core_web_lg (~200 MB, low-memory)" },
    ],
    remoteModels: [],
    modelField: null,
    remoteModelField: null,
  },
  {
    key: "embedding",
    title: "Embedding",
    description:
      "Generates vector embeddings for transcript chunks, enabling semantic search and the Ask AI feature.",
    remoteAvailable: true,
    providerField: "embedding_provider",
    localModels: [{ value: "all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2" }],
    remoteModels: [
      {
        value: "BAAI/bge-small-en-v1.5",
        label: "Fireworks BGE small-en-v1.5",
      },
    ],
    modelField: "embedding_model",
    remoteModelField: "fireworks_embedding_model",
  },
  {
    // Issue #608: dedicated rag_provider toggle. Independent of
    // inference_provider so enabling Fireworks for transcription does not
    // implicitly send retrieved transcript chunks to Fireworks for answer
    // generation.
    key: "rag",
    title: "RAG / Ask",
    description:
      "Powers the Ask AI feature using retrieval-augmented generation. Local routes generation through Ollama; remote sends retrieved transcript chunks + your question to Fireworks for answer generation.",
    remoteAvailable: true,
    providerField: "rag_provider",
    localModels: RAG_MODELS.map((m) => ({ value: m.value, label: m.label })),
    remoteModels: FIREWORKS_CHAT_MODELS.map((m) => ({
      value: m.value,
      label: `${m.label} — ${m.description}`,
    })),
    // rag_local_model is the persistent default for local Ollama inference
    // (Issue #637). The Ask page prefers a per-session localStorage value but
    // falls back to this when none is set. The configured remote model lives
    // in fireworks_chat_model.
    modelField: "rag_local_model",
    remoteModelField: "fireworks_chat_model",
  },
];

export const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring";

export function isRemoteStep(settings: Settings, step: PipelineStep): boolean {
  if (!step.providerField) return false;
  const remoteValue = step.remoteProviderValue ?? "fireworks";
  return settings[step.providerField] === remoteValue;
}

export function getCurrentModel(settings: Settings, step: PipelineStep): string {
  if (isRemoteStep(settings, step) && step.remoteModelField) {
    return (
      (settings[step.remoteModelField] as string) ||
      step.remoteModels[0]?.value ||
      ""
    );
  }
  if (step.modelField) {
    return (
      (settings[step.modelField] as string) || step.localModels[0]?.value || ""
    );
  }
  return step.localModels[0]?.value || "";
}
