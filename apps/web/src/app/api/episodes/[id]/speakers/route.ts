import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/**
 * Speaker name management — PRD-02 §5.4
 * PUT /api/episodes/{id}/speakers — upsert a display name for a speaker label
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { speaker_label, display_name } = await req.json();

    if (!speaker_label || !display_name?.trim()) {
      return NextResponse.json({ error: "speaker_label and display_name are required" }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO speaker_names (episode_id, speaker_label, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (episode_id, speaker_label)
       DO UPDATE SET display_name = EXCLUDED.display_name`,
      [params.id, speaker_label, display_name.trim()]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Speaker rename error:", err);
    return NextResponse.json({ error: "Failed to update speaker name" }, { status: 500 });
  }
}
