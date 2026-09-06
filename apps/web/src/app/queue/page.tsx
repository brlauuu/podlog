import QueueStatus from "@/components/QueueStatus";
import WorkerWarmupBanner from "@/components/WorkerWarmupBanner";

export default function QueuePage() {
  return (
    <div className="space-y-6">
      <WorkerWarmupBanner />
      <QueueStatus />
    </div>
  );
}
