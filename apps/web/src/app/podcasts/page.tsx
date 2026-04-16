import Link from "next/link";
import Image from "next/image";
import { FlaskConical } from "lucide-react";
import pool from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import AudioUpload from "@/components/AudioUpload";
import UploadedEpisodeCard from "@/components/UploadedEpisodeCard";

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
      {feeds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold">Podcasts</h2>
            <Button variant="outline" size="sm" asChild>
              <Link href="/feeds">Manage feeds</Link>
            </Button>
          </div>
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
          <Link href="/feeds" className="text-sm text-link underline">
            Add your first RSS feed
          </Link>
          <p className="text-xs text-muted-foreground">or upload an audio file below</p>
        </div>
      )}

      <Separator />

      {/* Uploads section */}
      <div>
        <h2 className="text-xl font-semibold mb-3">
          Manual uploads
          {uploads.total > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
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
              <UploadedEpisodeCard
                key={ep.id}
                id={ep.id}
                title={ep.title}
                status={ep.status}
                created_at={ep.created_at}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
