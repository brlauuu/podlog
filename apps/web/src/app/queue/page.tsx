import QueueStatus from "@/components/QueueStatus";

export default function QueuePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Queue</h1>
      <QueueStatus />
    </div>
  );
}
