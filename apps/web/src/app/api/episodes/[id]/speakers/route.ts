import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { normalizeName } from "@/lib/normalizeName";
import { setMetaAnalysisStale } from "@/lib/metaAnalysisStale";

const VALID_ROLES = new Set(["host", "guest", "other"]);

/**
 * Speaker name management — PRD-02 §5.4
 * PUT /api/episodes/{id}/speakers — upsert a display name (and optionally
 * a role: host | guest | other; #698) for a speaker label.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { speaker_label, display_name, role } = await req.json();

    if (!speaker_label || !display_name?.trim()) {
      return NextResponse.json({ error: "speaker_label and display_name are required" }, { status: 400 });
    }
    // role is optional. When present, must be one of the curated values.
    // null is allowed and clears any previously-assigned role.
    if (role !== undefined && role !== null && !VALID_ROLES.has(role)) {
      return NextResponse.json(
        { error: `role must be one of ${[...VALID_ROLES].join(", ")} or null` },
        { status: 400 },
      );
    }
    const roleValue = role === undefined ? null : role;

    const trimmedName = display_name.trim();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // PRD-04 §5.1: when user edits, mark confirmed and clear inferred flag.
      // #698: persist role alongside the rename. Sending an undefined role
      // (existing callers) preserves any previously-set role; sending null
      // explicitly clears it.
      await client.query(
        `INSERT INTO speaker_names (episode_id, speaker_label, display_name, inferred, confirmed_by_user, role)
         VALUES ($1, $2, $3, false, true, $5)
         ON CONFLICT (episode_id, speaker_label)
         DO UPDATE SET display_name = EXCLUDED.display_name,
                       inferred = false,
                       confirmed_by_user = true,
                       role = CASE
                         WHEN $4 THEN EXCLUDED.role
                         ELSE speaker_names.role
                       END`,
        [id, speaker_label, trimmedName, role !== undefined, roleValue]
      );

      // PRD-04 C1/C2: upsert per-feed speaker cache so future episodes of
      // the same feed can seed inference with this confirmed name.
      // normalized_name is computed in TS via normalizeName() so it matches
      // the Python inference_helpers.normalize_name (lower + collapsed
      // whitespace + leading-honorifics stripped) — ensures "Dr. Jane Smith"
      // and "Jane Smith" dedupe into a single cache row.
      const normalizedName = normalizeName(trimmedName);
      await client.query(
        `INSERT INTO feed_speaker_cache (
           id, feed_id, speaker_label, display_name, normalized_name,
           occurrence_count, last_seen_episode_id, last_seen_at, created_at
         )
         SELECT
           gen_random_uuid(),
           e.feed_id,
           $2,
           $3,
           $4,
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
        [id, speaker_label, trimmedName, normalizedName]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Issue #521: invalidate meta-analysis cache so the worker recomputes.
    await setMetaAnalysisStale();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Speaker rename error:", err);
    return NextResponse.json({ error: "Failed to update speaker name" }, { status: 500 });
  }
}
