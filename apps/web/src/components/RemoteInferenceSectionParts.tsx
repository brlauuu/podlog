"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
        value: "speaker-diarization-community-1",
        label: "pyannote speaker-diarization-community-1 (free, local)",
      },
    ],
    remoteModels: [
      {
        value: "precision-2",
        label: "pyannote precision-2 (paid, hosted)",
      },
    ],
    modelField: null,
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

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring";

function StepHelpContent({
  step,
  hwInfo,
}: {
  step: PipelineStep;
  hwInfo: HardwareInfo | null;
}) {
  const estimates = hwInfo?.estimates;
  const hw = hwInfo?.hardware;

  return (
    <div className="space-y-2 text-sm">
      <p>{step.description}</p>
      {step.remoteAvailable && estimates && (
        <div className="border-t border-border pt-2 mt-2 space-y-1 text-xs text-muted-foreground">
          {estimates.transcription_minutes_per_hour !== null &&
            hw &&
            step.key === "transcription" && (
              <p>
                On your detected hardware ({hw.cpu}, {hw.ram_gb}GB RAM
                {hw.gpu ? `, ${hw.gpu}` : ", no GPU"}), transcribing a
                60-minute episode takes approximately{" "}
                {estimates.transcription_minutes_per_hour} minutes locally. With
                Fireworks AI, the same episode takes approximately{" "}
                {estimates.remote_transcription_minutes_per_hour} minutes and
                costs ~${estimates.remote_cost_per_hour_usd}.
              </p>
            )}
          {estimates.transcription_minutes_per_hour === null &&
            step.key === "transcription" && (
              <p>
                With Fireworks AI, transcribing a 60-minute episode costs
                approximately ${estimates.remote_cost_per_hour_usd}.
              </p>
            )}
          {estimates.embedding_seconds_per_hour !== null &&
            hw &&
            step.key === "embedding" && (
              <p>
                On your detected hardware ({hw.cpu}, {hw.ram_gb}GB RAM
                {hw.gpu ? `, ${hw.gpu}` : ", no GPU"}), embedding a 60-minute
                episode takes approximately{" "}
                {estimates.embedding_seconds_per_hour} seconds locally. With
                Fireworks AI, approximately{" "}
                {estimates.remote_embedding_seconds_per_hour} seconds.
              </p>
            )}
          {estimates.embedding_seconds_per_hour === null &&
            step.key === "embedding" && (
              <p>
                With Fireworks AI, embedding a 60-minute episode takes
                approximately {estimates.remote_embedding_seconds_per_hour}{" "}
                seconds.
              </p>
            )}
        </div>
      )}
      {!step.remoteAvailable && step.disabledReason && (
        <p className="text-xs text-muted-foreground italic">
          {step.disabledReason}
        </p>
      )}
    </div>
  );
}

function isRemoteStep(settings: Settings, step: PipelineStep): boolean {
  if (!step.providerField) return false;
  const remoteValue = step.remoteProviderValue ?? "fireworks";
  return settings[step.providerField] === remoteValue;
}

function getCurrentModel(settings: Settings, step: PipelineStep): string {
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

export function RemoteProviderIntro() {
  return (
    <div className="space-y-4">
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Remote inference provider
        </label>
        <Select defaultValue="fireworks" disabled>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fireworks">Fireworks AI</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Issue #608: explicit data-egress notice so users know what leaves
          their machine when they flip a step to remote. */}
      <div
        role="note"
        className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-foreground"
      >
        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
          Privacy: what leaves your machine
        </p>
        <p className="text-muted-foreground">
          When a pipeline step is set to a remote provider, the data for that
          step (audio for transcription &amp; diarization; queries and retrieved
          transcript chunks for RAG / Ask; embedding inputs for embeddings) is
          sent to that provider&apos;s servers for processing. Steps left on{" "}
          <b>local</b> stay on this machine.
        </p>
      </div>

      <Collapsible>
        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
            <h3 className="text-sm font-medium text-muted-foreground">
              What are remote inference providers?
            </h3>
            <span className="text-xs text-muted-foreground">Show</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                Remote inference providers process your audio and text on
                external servers instead of your local machine. This is useful
                when:
              </p>
              <ul className="list-disc ml-5 space-y-1">
                <li>
                  Your hardware is slow (e.g. CPU-only machines where
                  transcription takes a long time)
                </li>
                <li>You want faster processing at a per-minute cost</li>
                <li>You want to free up local resources for other tasks</li>
              </ul>
              <p>
                Currently,{" "}
                <a
                  href="https://fireworks.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Fireworks AI
                </a>{" "}
                is the supported provider. You need a Fireworks API key to
                enable remote processing.
              </p>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

export function FireworksApiKeyField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string) => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-1">Fireworks API Key</label>
      <p className="text-xs text-muted-foreground mb-1.5">
        Required for remote inference. Stored securely and masked on read.
        Generate at{" "}
        <a
          href="https://fireworks.ai/account/api-keys"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          fireworks.ai/account/api-keys
        </a>
        .
      </p>
      <div className="relative">
        <input
          id="fireworks-api-key"
          type={showApiKey ? "text" : "password"}
          className={inputClass}
          placeholder="fw_..."
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground px-2 py-1"
          onClick={() => setShowApiKey(!showApiKey)}
        >
          {showApiKey ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export function PipelineStepCards({
  settings,
  hwInfo,
  onChange,
  onRequireApiKey,
}: {
  settings: Settings;
  hwInfo: HardwareInfo | null;
  onChange: (field: keyof Settings, value: string | number | boolean | null) => void;
  onRequireApiKey: (apiKeyLabel: string) => void;
}) {
  function handleToggle(step: PipelineStep, checked: boolean) {
    if (!step.providerField) return;
    const apiKeyField = step.apiKeyField ?? "fireworks_api_key";
    const remoteValue = step.remoteProviderValue ?? "fireworks";
    const localValue = step.localProviderValue ?? "local";
    const apiKeyLabel = step.apiKeyLabel ?? "Fireworks API key";
    if (checked && !settings[apiKeyField]) {
      onRequireApiKey(apiKeyLabel);
      return;
    }
    onChange(step.providerField, checked ? remoteValue : localValue);
  }

  function handleModelChange(step: PipelineStep, value: string) {
    if (isRemoteStep(settings, step) && step.remoteModelField) {
      onChange(step.remoteModelField, value);
    } else if (step.modelField) {
      onChange(step.modelField, value);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Pipeline Steps</h3>
      {PIPELINE_STEPS.map((step) => {
        const remote = isRemoteStep(settings, step);
        const models = remote ? step.remoteModels : step.localModels;
        const currentModel = getCurrentModel(settings, step);
        const disabled = !step.remoteAvailable;

        return (
          <div key={step.key} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">{step.title}</h4>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Help for ${step.title}`}
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                    >
                      ?
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-80 bg-background border border-border shadow-lg"
                    side="right"
                  >
                    <StepHelpContent step={step} hwInfo={hwInfo} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {remote ? "Remote" : "Local"}
                </span>
                <Switch
                  checked={remote}
                  onCheckedChange={(checked) => handleToggle(step, checked)}
                  disabled={disabled}
                  className={disabled ? "opacity-50 cursor-not-allowed" : ""}
                />
              </div>
            </div>
            <Select
              value={currentModel}
              onValueChange={(val) => handleModelChange(step, val)}
              disabled={disabled}
            >
              <SelectTrigger
                className={`w-full ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

export function EstimatesExplainer({ settings }: { settings: Settings }) {
  return (
    <Collapsible>
      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
          <h3 className="text-sm font-medium text-muted-foreground">
            How are these estimates calculated?
          </h3>
          <span className="text-xs text-muted-foreground">Show</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p>
              <strong>Local estimates</strong> are based on your detected
              hardware matched to known performance profiles. The profiles
              represent typical processing speeds observed on similar hardware.
            </p>
            <p>
              <strong>Remote cost estimates</strong> use the per-minute pricing
              configured in the app (currently $
              {settings.fireworks_stt_cost_per_minute_usd}/min for Fireworks
              STT).
            </p>
            <p>Both are approximations and actual results may vary.</p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function ApiKeyRequiredDialog({
  open,
  onOpenChange,
  apiKeyLabel = "Fireworks API key",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKeyLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>API key required</DialogTitle>
          <DialogDescription>
            You must provide a valid {apiKeyLabel} before enabling remote
            inference on this pipeline step. Enter the key in the field above
            and try again.
          </DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <button className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted">
            OK
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export function PyannoteCloudIntro() {
  return (
    <Collapsible>
      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
          <h3 className="text-sm font-medium text-muted-foreground">
            What is pyannote cloud (Precision-2)?
          </h3>
          <span className="text-xs text-muted-foreground">Show</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p>
              Precision-2 is pyannote.ai&apos;s paid hosted diarization model.
              It runs on their infrastructure (no local CPU/RAM cost) and is
              reported to be ~28% more accurate than the free local{" "}
              <code>community-1</code> model on typical podcast audio.
            </p>
            <p>Enable it when:</p>
            <ul className="list-disc ml-5 space-y-1">
              <li>Your local machine struggles with diarization memory.</li>
              <li>You want higher speaker-labeling accuracy.</li>
              <li>You&apos;re fine paying per-second for audio processed.</li>
            </ul>
            <p>
              To enable: create an account and API key at{" "}
              <a
                href="https://dashboard.pyannote.ai"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                dashboard.pyannote.ai
              </a>
              , paste the key below, and flip the Diarization step to
              &quot;Remote&quot; under Pipeline Steps. Billing is per second of
              audio processed, with a 20-second per-request minimum. Check your
              dashboard for the exact rate on your tier.
            </p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function PyannoteApiKeyField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string) => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-1">
        pyannote cloud API key
      </label>
      <p className="text-xs text-muted-foreground mb-1.5">
        Required only for the Precision-2 diarization option. Stored securely
        and masked on read. Generate at{" "}
        <a
          href="https://dashboard.pyannote.ai"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          dashboard.pyannote.ai
        </a>
        .
      </p>
      <div className="relative">
        <input
          id="pyannote-api-key"
          type={showApiKey ? "text" : "password"}
          className={inputClass}
          placeholder="Your pyannote.ai API key"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground px-2 py-1"
          onClick={() => setShowApiKey(!showApiKey)}
        >
          {showApiKey ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
