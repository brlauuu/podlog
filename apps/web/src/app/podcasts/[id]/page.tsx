import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, FlaskConical } from "lucide-react";
import pool from "@/lib/db";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

interface Episode {
  id: string;
  title: string | null;
  published_at: string | null;
  duration_secs: number | null;
  status: string;
  has_diarization: boolean;
}

interface Feed {
  id: string;
  title: string | null;
  image_url: string | null;
  website_url: string | null;
  mode: string;
}

async function getFeed(id: string): Promise<Feed | null> {
  const result = await pool.query("SELECT * FROM feeds WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

async function getEpisodes(feedId: string): Promise<Episode[]> {
  const result = await pool.query(
    `SELECT id, title, published_at, duration_secs, status, has_diarization
     FROM episodes
     WHERE feed_id = $1
     ORDER BY published_at DESC NULLS LAST`,
    [feedId]
  );
  return result.rows;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  const label = status === "done" ? "Transcribed" : status.charAt(0).toUpperCase() + status.slice(1);
  const style = colors[status] ?? colors.pending;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${style}`}>{label}</span>
  );
}

export default async function PodcastPage({ params }: { params: { id: string } }) {
  const [feed, episodes] = await Promise.all([getFeed(params.id), getEpisodes(params.id)]);

  if (!feed) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/podcasts" className="text-sm text-muted-foreground hover:text-foreground">
          ← Podcasts
        </Link>
        <div className="flex items-center gap-2 mt-2">
          <h1 className="text-2xl font-semibold">{feed.title ?? "Untitled podcast"}</h1>
          {feed.mode === "test" && (
            <Badge variant="outline" className="text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-1">
              <FlaskConical size={12} />
              Test
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {episodes.length === 0 ? (
          <p className="text-muted-foreground">No episodes yet.</p>
        ) : (
          episodes.map((ep) => (
            <Link
              key={ep.id}
              href={`/episodes/${ep.id}`}
              className="flex items-center justify-between gap-4 border border-border rounded-lg p-3 hover:bg-accent/30 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{ep.title ?? "Untitled"}</p>
                {ep.published_at && (
                  <p className="text-xs text-muted-foreground">
                    {new Date(ep.published_at).toLocaleDateString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!ep.has_diarization && ep.status === "done" && (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                    title="Speaker labels unavailable"
                  >
                    <AlertTriangle size={11} />
                    No labels
                  </span>
                )}
                <StatusBadge status={ep.status} />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
