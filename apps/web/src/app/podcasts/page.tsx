import Link from "next/link";
import Image from "next/image";
import { FlaskConical, FileAudio, CheckCircle2, Loader2, XCircle } from "lucide-react";
import pool from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import AudioUpload from "@/components/AudioUpload";

export const dynamic = "force-dynamic";

interface Feed {
  id: string;
  title: string | null;
  image_url: string | null;
  mode: string;
  episode_count: number;
  processed_count: number;
  last_polled_at: string | null;
}

interface UploadedEpisode {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
}

async function getFeeds(): Promise<Feed[]> {
  const result = await pool.query(`
    SELECT
      f.id,
      f.title,
      f.image_url,
      f.mode,
      f.last_polled_at,
      COUNT(e.id)::int AS episode_count,
      COUNT(e.id) FILTER (WHERE e.status = 'done')::int AS processed_count
    FROM feeds f
    LEFT JOIN episodes e ON e.feed_id = f.id
    GROUP BY f.id
    ORDER BY f.created_at DESC
  `);
  return result.rows;
}

async function getUploadedEpisodes(): Promise<{ episodes: UploadedEpisode[]; processed: number; total: number }> {
  const result = await pool.query(`
    SELECT id, title, status, created_at
    FROM episodes
    WHERE feed_id IS NULL
    ORDER BY created_at DESC
  `);
  const episodes: UploadedEpisode[] = result.rows;
  const processed = episodes.filter((e) => e.status === "done").length;
  return { episodes, processed, total: episodes.length };
}

export default async function SourcesPage() {
  const [feeds, uploads] = await Promise.all([getFeeds(), getUploadedEpisodes()]);

  return (
    <div className="space-y-6">
      {/* Podcasts section */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sources</h1>
        <Button variant="outline" size="sm" asChild>
          <Link href="/feeds">Manage feeds</Link>
        </Button>
      </div>

      {feeds.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Podcasts</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {feeds.map((feed) => (
              <Link key={feed.id} href={`/podcasts/${feed.id}`}>
                <Card className="overflow-hidden hover:bg-accent/30 transition-colors h-full">
                  {feed.image_url ? (
                    <Image
                      src={feed.image_url}
                      alt={feed.title ?? "Podcast"}
                      width={300}
                      height={300}
                      className="w-full aspect-square object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-muted flex items-center justify-center text-4xl">
                      🎙
                    </div>
                  )}
                  <CardContent className="p-3 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium line-clamp-2">{feed.title ?? "Untitled"}</p>
                      {feed.mode === "test" && (
                        <Badge variant="outline" className="shrink-0 text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-0.5 text-[10px] px-1 py-0">
                          <FlaskConical size={9} />
                          Test
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {feed.processed_count === feed.episode_count
                        ? `${feed.episode_count} episodes`
                        : `${feed.processed_count} / ${feed.episode_count} episodes processed`}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {feeds.length === 0 && uploads.total === 0 && (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">No sources yet.</p>
          <Link href="/feeds" className="text-sm text-primary underline">
            Add your first RSS feed
          </Link>
          <p className="text-xs text-muted-foreground">or upload an audio file below</p>
        </div>
      )}

      <Separator />

      {/* Uploads section */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Manual uploads
          {uploads.total > 0 && (
            <span className="ml-2 font-normal">
              ({uploads.processed === uploads.total
                ? `${uploads.total} file${uploads.total !== 1 ? "s" : ""}`
                : `${uploads.processed} / ${uploads.total} processed`})
            </span>
          )}
        </h2>

        <div className="max-w-md">
          <AudioUpload />
        </div>

        {uploads.episodes.length > 0 && (
          <div className="mt-4 space-y-2">
            {uploads.episodes.map((ep) => (
              <Link key={ep.id} href={`/episodes/${ep.id}`}>
                <Card className="hover:bg-accent/30 transition-colors">
                  <CardContent className="p-3 flex items-center gap-3">
                    <FileAudio size={16} className="text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{ep.title ?? "Untitled"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(ep.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {ep.status === "done" ? (
                      <CheckCircle2 size={14} className="text-green-600 dark:text-green-400 shrink-0" />
                    ) : ep.status === "failed" ? (
                      <XCircle size={14} className="text-red-600 dark:text-red-400 shrink-0" />
                    ) : (
                      <Loader2 size={14} className="text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
