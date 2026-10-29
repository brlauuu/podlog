/**
 * Pipeline-step descriptors + display helpers for the Inference settings tab.
 * Every step runs locally (#1092); this replaced RemoteInferencePipelineSteps.
 */
import type { Settings } from "./NotificationSettingsSections";
import { RAG_MODELS } from "@/lib/rag-models";

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
  };
}

export interface PipelineStep {
  key: string;
  title: string;
  description: string;
  models: { value: string; label: string }[];
  // The settings field the picker writes. null: the model is fixed in
  // config, so the picker only shows it.
  modelField: keyof Settings | null;
}

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    key: "transcription",
    title: "Transcription",
    description:
      "Converts audio to text using speech recognition. This is typically the most time-consuming step in the pipeline.",
    models: [{ value: "large-v3-turbo", label: "WhisperX large-v3-turbo" }],
    modelField: null,
  },
  {
    key: "diarization",
    title: "Diarization",
    description:
      "Identifies and labels different speakers in the audio. Runs after transcription to assign speaker labels to each segment.",
    models: [
      {
        value: "pyannote/speaker-diarization-community-1",
        label: "pyannote speaker-diarization-community-1 (default)",
      },
      {
        value: "pyannote/speaker-diarization-3.1",
        label: "pyannote speaker-diarization-3.1 (legacy)",
      },
    ],
    modelField: "pyannote_model",
  },
  {
    key: "speaker-inference",
    title: "Speaker Inference",
    description:
      "Infers speaker names from transcript content using named entity recognition (NER).",
    models: [
      { value: "en_core_web_trf", label: "spaCy en_core_web_trf (default, ~500 MB)" },
      { value: "en_core_web_lg", label: "spaCy en_core_web_lg (~200 MB, low-memory)" },
    ],
    modelField: null,
  },
  {
    key: "embedding",
    title: "Embedding",
    description:
      "Generates vector embeddings for transcript chunks, enabling semantic search and the Ask AI feature.",
    models: [
      { value: "all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2 (default)" },
      // Installs that embedded through Fireworks before #1092 have a
      // bge-small corpus. Running the same model locally reproduces those
      // vectors exactly, so no re-embedding is needed -- but picking the
      // wrong one silently corrupts the vector space, since both are
      // 384-dimensional (#945).
      {
        value: "BAAI/bge-small-en-v1.5",
        label: "BAAI/bge-small-en-v1.5 (match an older corpus embedded with it)",
      },
    ],
    modelField: "embedding_model",
  },
  {
    // rag_local_model is the persistent default for Ask (Issue #637). The
    // Ask page prefers a per-session localStorage value but falls back to
    // this when none is set.
    key: "rag",
    title: "RAG / Ask",
    description:
      "Powers the Ask AI feature using retrieval-augmented generation, through Ollama on this machine.",
    models: RAG_MODELS.map((m) => ({ value: m.value, label: m.label })),
    modelField: "rag_local_model",
  },
];

export function getCurrentModel(settings: Settings, step: PipelineStep): string {
  if (step.modelField) {
    return (settings[step.modelField] as string) || step.models[0]?.value || "";
  }
  return step.models[0]?.value || "";
}

/**
 * True when the configured model is not one of the options offered (#1005).
 *
 * The lists are a curated selection, not the set of models that work: a
 * model pulled in Ollama that Podlog never listed (`gemma4:e4b` works fine
 * and is not in RAG_MODELS) renders as an empty Radix trigger, which reads
 * as "nothing selected" rather than "something unrecognised".
 */
export function isUnlistedModel(settings: Settings, step: PipelineStep): boolean {
  const current = getCurrentModel(settings, step);
  if (!current) return false;
  return !step.models.some((m) => m.value === current);
}
