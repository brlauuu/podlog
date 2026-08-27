import LanAccessCard from "@/components/LanAccessCard";
import NotificationSettings from "@/components/NotificationSettings";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      {/* #1012: above the tabs on purpose. Someone looking for "how do I open
          this on my phone" is not going to guess which tab it lives under,
          and it renders nothing when there is no address to show. */}
      <LanAccessCard />
      <NotificationSettings />
    </div>
  );
}
