import Link from "next/link";
import Image from "next/image";
import pool from "@/lib/db";

interface Feed {
  id: string;
  title: string | null;
  image_url: string | null;
  episode_count: number;
  last_polled_at: string | null;
}

async function getFeeds(): Promise<Feed[]> {
  const result = await pool.query(`
    SELECT
      f.id,
      f.title,
      f.image_url,
      f.last_polled_at,
      COUNT(e.id)::int AS episode_count
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
        <Link
          href="/feeds"
          className="text-sm px-3 py-1.5 border border-border rounded hover:bg-accent transition-colors"
        >
          Manage feeds
        </Link>
      </div>

      {feeds.length === 0 ? (
        <div className="text-center py-20 space-y-3">
          <p className="text-muted-foreground">No podcasts yet.</p>
          <Link
            href="/feeds"
            className="text-sm text-primary underline"
          >
            Add your first RSS feed →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {feeds.map((feed) => (
            <Link
              key={feed.id}
              href={`/podcasts/${feed.id}`}
              className="border border-border rounded-lg overflow-hidden hover:bg-accent/30 transition-colors"
            >
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
              <div className="p-3 space-y-1">
                <p className="text-sm font-medium line-clamp-2">{feed.title ?? "Untitled"}</p>
                <p className="text-xs text-muted-foreground">{feed.episode_count} episodes</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
