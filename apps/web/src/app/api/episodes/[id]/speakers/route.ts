import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/**
 * Speaker name management — PRD-02 §5.4
 * PUT /api/episodes/{id}/speakers — upsert a display name for a speaker label
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { speaker_label, display_name } = await req.json();

    if (!speaker_label || !display_name?.trim()) {
      return NextResponse.json({ error: "speaker_label and display_name are required" }, { status: 400 });
    }

    const trimmedName = display_name.trim();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // PRD-04 §5.1: when user edits, mark confirmed and clear inferred flag
      await client.query(
        `INSERT INTO speaker_names (episode_id, speaker_label, display_name, inferred, confirmed_by_user)
         VALUES ($1, $2, $3, false, true)
         ON CONFLICT (episode_id, speaker_label)
         DO UPDATE SET display_name = EXCLUDED.display_name,
                       inferred = false,
                       confirmed_by_user = true`,
        [id, speaker_label, trimmedName]
      );

      // PRD-04 C1/C2: upsert per-feed speaker cache so future episodes of
      // the same feed can seed inference with this confirmed name.
      // normalized_name mirrors app.services.inference_helpers.normalize_name
      // (lower + collapsed whitespace).
      await client.query(
        `INSERT INTO feed_speaker_cache (
           id, feed_id, speaker_label, display_name, normalized_name,
           occurrence_count, last_seen_episode_id, last_seen_at, created_at
         )
         SELECT
           gen_random_uuid()::text,
           e.feed_id,
           $2,
           $3,
           lower(regexp_replace(btrim($3), '\\s+', ' ', 'g')),
           1,
           e.id,
           NOW(),
           NOW()
         FROM episodes e
         WHERE e.id = $1 AND e.feed_id IS NOT NULL
         ON CONFLICT (feed_id, speaker_label, normalized_name)
         DO UPDATE SET
           display_name = EXCLUDED.display_name,
           occurrence_count = feed_speaker_cache.occurrence_count + 1,
           last_seen_episode_id = EXCLUDED.last_seen_episode_id,
           last_seen_at = NOW()`,
        [id, speaker_label, trimmedName]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Speaker rename error:", err);
    return NextResponse.json({ error: "Failed to update speaker name" }, { status: 500 });
  }
}
