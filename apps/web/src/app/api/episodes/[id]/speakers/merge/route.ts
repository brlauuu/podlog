import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

function validateMergeRequest(body: unknown): { error: string } | null {
  const b = body as Record<string, unknown>;
  if (!b.source_labels || !Array.isArray(b.source_labels) || b.source_labels.length === 0) {
    return { error: "source_labels must be a non-empty array" };
  }
  if (!b.target_label || typeof b.target_label !== "string" || b.target_label.trim() === "") {
    return { error: "target_label must be a non-empty string" };
  }
  if (b.source_labels.includes(b.target_label)) {
    return { error: "target_label must not appear in source_labels" };
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validationError = validateMergeRequest(body);
  if (validationError) {
    return NextResponse.json(validationError, { status: 400 });
  }

  const { source_labels, target_label } = body as {
    source_labels: string[];
    target_label: string;
  };
  const episodeId = params.id;
  const allLabels = [target_label, ...source_labels];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validate all labels belong to this episode
    const check = await client.query(
      `SELECT DISTINCT speaker_label FROM segments
       WHERE episode_id = $1 AND speaker_label = ANY($2)`,
      [episodeId, allLabels]
    );
    const found = new Set(check.rows.map((r: { speaker_label: string }) => r.speaker_label));
    const missing = allLabels.filter((l) => !found.has(l));
    if (missing.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Labels not found in episode: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    // Reassign segments from source labels to target
    const update = await client.query(
      `UPDATE segments SET speaker_label = $1
       WHERE episode_id = $2 AND speaker_label = ANY($3)`,
      [target_label, episodeId, source_labels]
    );

    // Delete orphaned speaker_names for source labels
    await client.query(
      `DELETE FROM speaker_names
       WHERE episode_id = $1 AND speaker_label = ANY($2)`,
      [episodeId, source_labels]
    );

    await client.query("COMMIT");

    return NextResponse.json({ ok: true, merged_segments: update.rowCount ?? 0 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Speaker merge error:", err);
    return NextResponse.json({ error: "Failed to merge speakers" }, { status: 500 });
  } finally {
    client.release();
  }
}
