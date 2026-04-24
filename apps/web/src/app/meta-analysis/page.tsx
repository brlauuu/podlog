import MetaAnalysisClient from "./MetaAnalysisClient";

export const dynamic = "force-dynamic";

export default function MetaAnalysisPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      <MetaAnalysisClient />
    </main>
  );
}
