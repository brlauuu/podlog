"use client";

/**
 * Pipeline-step cards UI for the Remote Inference settings section
 * (split out of RemoteInferenceSectionParts in #663). Owns the step-card
 * grid, the in-card help popover content, the per-step estimates
 * explainer, and the "API key required" warning dialog. Re-exported
 * from RemoteInferenceSectionParts for back-compat.
 */
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
import {
  type HardwareInfo,
  type PipelineStep,
  PIPELINE_STEPS,
  getCurrentModel,
  isRemoteStep,
} from "./RemoteInferencePipelineSteps";

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
