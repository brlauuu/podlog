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
    remoteAvailable: false,
    disabledReason: "Speaker diarization is currently supported locally only.",
    providerField: null,
    localModels: [
      {
        value: "community-1",
        label: "pyannote community-1",
      },
    ],
    remoteModels: [],
    modelField: null,
    remoteModelField: null,
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
    localModels: [{ value: "en_core_web_lg", label: "spaCy en_core_web_lg" }],
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
    key: "rag",
    title: "RAG / Ask",
    description:
      "Powers the Ask AI feature using retrieval-augmented generation with a local Ollama model.",
    remoteAvailable: false,
    disabledReason:
      "RAG-powered Ask uses a local Ollama model. Remote LLM support is planned.",
    providerField: null,
    localModels: [{ value: "ollama", label: "Ollama (local LLM)" }],
    remoteModels: [],
    modelField: null,
    remoteModelField: null,
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
  return settings[step.providerField] === "fireworks";
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
                Currently, Fireworks AI is the supported provider. You need a
                Fireworks API key to enable remote processing.
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
  onRequireApiKey: () => void;
}) {
  function handleToggle(step: PipelineStep, checked: boolean) {
    if (!step.providerField) return;
    if (checked && !settings.fireworks_api_key) {
      onRequireApiKey();
      return;
    }
    onChange(step.providerField, checked ? "fireworks" : "local");
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>API key required</DialogTitle>
          <DialogDescription>
            You must provide a valid Fireworks API key before enabling remote
            inference on any pipeline step. Enter your API key in the field
            above and try again.
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
