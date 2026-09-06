import QueueStatus from "@/components/QueueStatus";
import HealthNotices from "@/components/HealthNotices";

export default function QueuePage() {
  return (
    <div className="space-y-6">
      <HealthNotices />
      <QueueStatus />
    </div>
  );
}
