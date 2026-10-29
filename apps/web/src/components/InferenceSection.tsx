"use client";

import { useEffect, useState } from "react";
import { EstimatesExplainer, PipelineStepCards } from "./PipelineStepCards";
import type { HardwareInfo } from "./PipelineSteps";
import { Settings } from "./NotificationSettingsSections";

/** The Inference settings tab: the local model used by each pipeline stage. */
export default function InferenceSection({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (
    field: keyof Settings,
    value: string | number | boolean | null
  ) => void;
}) {
  const [hwInfo, setHwInfo] = useState<HardwareInfo | null>(null);

  useEffect(() => {
    fetch("/api/hardware")
      .then((r) => r.json())
      .then((data) => setHwInfo(data))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Every stage runs on this machine. No audio or transcript is sent to a
        third-party service.
      </p>
      <PipelineStepCards settings={settings} hwInfo={hwInfo} onChange={onChange} />
      <EstimatesExplainer />
    </div>
  );
}
