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
    // Issue #944: Fireworks retired serverless embeddings — every model on
    // /inference/v1/embeddings returns 503 "no healthy upstream". The only
    // model it still serves is 4096-dimensional against our vector(384)
    // column, so remote embedding has no working option to offer.
    remoteAvailable: false,
    disabledReason:
      "Remote embedding is unavailable: Fireworks retired its serverless embeddings API. " +
      "Embeddings run locally — the model is small and CPU-only, so this costs little even in remote mode.",
    providerField: "embedding_provider",
    localModels: [
      { value: "all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2 (default)" },
      // Kept selectable because installs that previously ran embeddings
      // through Fireworks have a bge-small corpus. Running the same model
      // locally reproduces those vectors exactly, so no re-embedding is
      // needed — but picking the wrong one silently corrupts the vector
      // space, since both are 384-dimensional (#945).
      {
        value: "BAAI/bge-small-en-v1.5",
        label: "BAAI/bge-small-en-v1.5 (match a corpus embedded via Fireworks)",
      },
    ],
    remoteModels: [],
    modelField: "embedding_model",
    remoteModelField: null,
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

/**
 * True when the configured model is not one of the options offered for the
 * step's current provider (#1005).
 *
 * The lists in rag-models.ts are a curated selection, not the set of models
 * that work. A stored value can leave them two ways: a remote model retired
 * upstream (this is how `qwen2p5-72b-instruct` started failing every
 * Fireworks request), or a local model pulled in Ollama that Podlog never
 * listed (`gemma4:e4b` works fine and is not in RAG_MODELS).
 *
 * Both render as an empty Radix trigger, which reads as "nothing selected"
 * rather than "something unrecognised" -- so a broken setting and a working
 * one look identical, and neither looks configured.
 */
export function isUnlistedModel(settings: Settings, step: PipelineStep): boolean {
  const current = getCurrentModel(settings, step);
  if (!current) return false;
  // Compare against the list getCurrentModel actually read from. The two can
  // disagree: the embedding step is remote-provider-aware but has
  // `remoteModels: []` and `remoteModelField: null`, so on a remote provider
  // getCurrentModel falls back to the LOCAL model. Comparing that against an
  // empty remote list flags every model as unlisted -- a warning about a
  // setting this card does not even own.
  const usesRemoteModel = isRemoteStep(settings, step) && !!step.remoteModelField;
  const models = usesRemoteModel ? step.remoteModels : step.localModels;
  return !models.some((m) => m.value === current);
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
