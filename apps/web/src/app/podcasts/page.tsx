import Link from "next/link";
import Image from "next/image";
import { FlaskConical } from "lucide-react";
import pool from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

export default async function PodcastsPage() {
  const feeds = await getFeeds();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Podcasts</h1>
        <Button variant="outline" size="sm" asChild>
          <Link href="/feeds">Manage feeds</Link>
        </Button>
      </div>

      {feeds.length === 0 ? (
        <div className="text-center py-20 space-y-3">
          <p className="text-muted-foreground">No podcasts yet.</p>
          <Link
            href="/feeds"
            className="text-sm text-primary underline"
          >
            Add your first RSS feed
          </Link>
        </div>
      ) : (
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
      )}
    </div>
  );
}
