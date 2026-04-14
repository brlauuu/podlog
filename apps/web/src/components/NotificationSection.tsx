"use client";

import {
  EmailNotificationCard,
  GeneralNotificationCard,
  TelegramNotificationCard,
} from "./NotificationSectionCards";
import { Settings } from "./NotificationSettingsSections";

export default function NotificationSection({
  settings,
  onChange,
  onTest,
  testing,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string | number | boolean | null) => void;
  onTest: (channel: "telegram" | "email") => void;
  testing: boolean;
}) {
  return (
    <div className="space-y-8">
      <TelegramNotificationCard
        settings={settings}
        onChange={onChange}
        onTest={onTest}
        testing={testing}
      />
      <EmailNotificationCard
        settings={settings}
        onChange={onChange}
        onTest={onTest}
        testing={testing}
      />
      <GeneralNotificationCard settings={settings} onChange={onChange} />
    </div>
  );
}
