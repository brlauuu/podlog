"use client";

import { useEffect, useState } from "react";
import {
  ApiKeyRequiredDialog,
  EstimatesExplainer,
  FireworksApiKeyField,
  type HardwareInfo,
  PipelineStepCards,
  RemoteProviderIntro,
} from "./RemoteInferenceSectionParts";
import { Settings } from "./NotificationSettingsSections";

export default function RemoteInferenceSection({
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
  const [showKeyError, setShowKeyError] = useState(false);

  useEffect(() => {
    fetch("/api/hardware")
      .then((r) => r.json())
      .then((data) => setHwInfo(data))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <RemoteProviderIntro />
      <FireworksApiKeyField
        value={settings.fireworks_api_key}
        onChange={(value) => onChange("fireworks_api_key", value)}
      />
      <PipelineStepCards
        settings={settings}
        hwInfo={hwInfo}
        onChange={onChange}
        onRequireApiKey={() => setShowKeyError(true)}
      />
      <EstimatesExplainer settings={settings} />
      <ApiKeyRequiredDialog
        open={showKeyError}
        onOpenChange={setShowKeyError}
      />
    </div>
  );
}
