"use client";

/**
 * Pipeline-step cards for the Inference settings tab: one card per stage,
 * each with its model picker and an in-card help popover. Every stage runs
 * locally (#1092); this replaced RemoteInferencePipelineCards.
 */
import { EmbeddingCorpusModel } from "@/components/EmbeddingCorpusModel";
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
import type { Settings } from "./NotificationSettingsSections";
import {
  type HardwareInfo,
  type PipelineStep,
  PIPELINE_STEPS,
  getCurrentModel,
  isUnlistedModel,
} from "./PipelineSteps";

function hardwareLabel(hw: NonNullable<HardwareInfo["hardware"]>): string {
  return `${hw.cpu}, ${hw.ram_gb}GB RAM${hw.gpu ? `, ${hw.gpu}` : ", no GPU"}`;
}

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
      {hw && estimates?.transcription_minutes_per_hour != null &&
        step.key === "transcription" && (
          <p className="border-t border-border pt-2 mt-2 text-xs text-muted-foreground">
            On your detected hardware ({hardwareLabel(hw)}), transcribing a
            60-minute episode takes approximately{" "}
            {estimates.transcription_minutes_per_hour} minutes.
          </p>
        )}
      {hw && estimates?.embedding_seconds_per_hour != null &&
        step.key === "embedding" && (
          <p className="border-t border-border pt-2 mt-2 text-xs text-muted-foreground">
            On your detected hardware ({hardwareLabel(hw)}), embedding a
            60-minute episode takes approximately{" "}
            {estimates.embedding_seconds_per_hour} seconds.
          </p>
        )}
      {step.key === "embedding" && <EmbeddingCorpusModel />}
    </div>
  );
}

export function PipelineStepCards({
  settings,
  hwInfo,
  onChange,
}: {
  settings: Settings;
  hwInfo: HardwareInfo | null;
  onChange: (field: keyof Settings, value: string | number | boolean | null) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Pipeline Steps</h3>
      {PIPELINE_STEPS.map((step) => {
        const currentModel = getCurrentModel(settings, step);
        // A step whose model is fixed in config has nothing to save.
        const disabled = !step.modelField;
        // #1005: keep a drifted value visible. Without an item matching the
        // Select's value, Radix renders an empty trigger.
        const unlisted = isUnlistedModel(settings, step);

        return (
          <div key={step.key} className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
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
            <Select
              value={currentModel}
              onValueChange={(val) => step.modelField && onChange(step.modelField, val)}
              disabled={disabled}
            >
              <SelectTrigger
                className={`w-full ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {unlisted && (
                  <SelectItem key={currentModel} value={currentModel}>
                    {currentModel}
                  </SelectItem>
                )}
                {step.models.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unlisted && (
              // Deliberately not phrased as an error: an unlisted model
              // pulled into Ollama usually works. The point is to say that
              // Podlog cannot vouch for it, not that it is broken.
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{currentModel}</span>{" "}
                is not one of the models Podlog offers. It may still work if it
                is available on this machine.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EstimatesExplainer() {
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
              Estimates are based on your detected hardware matched to known
              performance profiles. The profiles represent typical processing
              speeds observed on similar hardware.
            </p>
            <p>They are approximations and actual results may vary.</p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
