import { PIPELINE_API } from "@/lib/pipeline";

export async function getQueryEmbedding(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.embedding;
  } catch {
    return null;
  }
}
