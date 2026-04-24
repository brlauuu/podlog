import { notFound } from "next/navigation";
import { searchMentions, searchGrouped } from "@/lib/search";
import { formatTimestamp } from "@/lib/timestamp";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

export default async function PrintPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const query = searchParams.q;
  if (!query) notFound();

  // Fetch all episodes that match
  const grouped = await searchGrouped(query, null, true, 1, 100);
  if (grouped.feeds.length === 0) notFound();

  // Fetch mentions with context for each episode
  const allEpisodeMentions = await Promise.all(
    grouped.feeds.flatMap((feed) =>
      feed.episodes.map(async (ep) => {
        const mentions = await searchMentions(query, ep.episodeId);
        return {
          episodeTitle: ep.episodeTitle,
          feedTitle: feed.feedTitle,
          episodeUrl: ep.episodeUrl,
          audioUrl: ep.audioUrl,
          mentionCount: ep.mentionCount,
          mentions: mentions.mentions,
        };
      })
    )
  );

  return (
    <html>
      <head>
        <title>Podlog Search Report — &ldquo;{query}&rdquo;</title>
        <style>{`
          @media print {
            body { font-size: 11pt; }
            .no-print { display: none !important; }
            .mention-card { break-inside: avoid; }
          }
          body {
            font-family: Georgia, 'Times New Roman', serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 32px 24px;
            color: #1a1a1a;
            line-height: 1.6;
          }
          h1 { font-family: -apple-system, sans-serif; font-size: 22px; margin: 0; }
          h2 { font-family: -apple-system, sans-serif; font-size: 16px; margin: 0 0 4px 0; }
          .header { text-align: center; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 28px; }
          .meta { font-size: 13px; color: #6b7280; margin: 6px 0 0 0; }
          .episode { margin-bottom: 28px; }
          .episode + .episode { border-top: 1px solid #e5e7eb; padding-top: 20px; }
          .episode-meta { font-size: 12px; color: #6b7280; margin: 0 0 12px 0; }
          .mention-card { margin-bottom: 16px; padding-left: 12px; border-left: 3px solid #e5e7eb; }
          .mention-label { font-size: 11px; color: #9ca3af; margin: 0 0 6px 0; font-family: monospace; }
          .context { font-size: 13px; color: #9ca3af; margin: 0 0 4px 0; line-height: 1.6; }
          .context b { color: #6b7280; font-weight: 600; }
          .matched { font-size: 13px; color: #111; margin: 0 0 4px 0; line-height: 1.6; background: #fef9c3; padding: 2px 4px; border-radius: 3px; }
          .matched b:first-child { color: #111; font-weight: 600; }
          .matched b { font-weight: 700; }
          .episode-links { font-size: 12px; color: #6b7280; margin: 0 0 12px 0; }
          .episode-links a { color: #3b82f6; text-decoration: none; }
          .episode-links a:hover { text-decoration: underline; }
          @media print { .episode-links a { color: #3b82f6; } .episode-links a::after { content: " (" attr(href) ")"; font-size: 9px; color: #9ca3af; } }
          .footer { border-top: 1px solid #d1d5db; padding-top: 12px; margin-top: 32px; text-align: center; font-size: 11px; color: #9ca3af; }
          .print-btn {
            position: fixed; top: 16px; right: 16px;
            font-family: -apple-system, sans-serif; font-size: 13px;
            background: #3b82f6; color: white; border: none;
            padding: 8px 16px; border-radius: 6px; cursor: pointer;
          }
          .print-btn:hover { background: #2563eb; }
        `}</style>
      </head>
      <body>
        <PrintButton />

        <div className="header">
          <h1>Podlog Search Report</h1>
          <p className="meta">
            Search term: <b>&ldquo;{query}&rdquo;</b> &middot;{" "}
            {grouped.totalMentions} mentions across {grouped.totalEpisodes} episodes
            &middot; {new Date().toLocaleDateString()}
          </p>
        </div>

        {allEpisodeMentions.map((ep, epIdx) => (
          <div key={epIdx} className="episode">
            <h2>{ep.episodeTitle}</h2>
            <p className="episode-meta">
              {ep.feedTitle} &middot; {ep.mentionCount} mention
              {ep.mentionCount !== 1 ? "s" : ""}
            </p>
            <p className="episode-links">
              {ep.episodeUrl && (
                <><a href={ep.episodeUrl} target="_blank" rel="noopener noreferrer">Episode page</a>{ep.audioUrl ? " · " : ""}</>
              )}
              {ep.audioUrl && (
                <a href={ep.audioUrl} target="_blank" rel="noopener noreferrer">RSS audio</a>
              )}
            </p>

            {ep.mentions.map((mention, mIdx) => (
              <div key={mIdx} className="mention-card">
                <p className="mention-label">
                  Mention {mIdx + 1} — at {formatTimestamp(mention.startTime)}
                </p>

                {mention.contextBefore.map((ctx, i) => (
                  <p key={`b-${i}`} className="context">
                    <b>
                      {ctx.speakerDisplay ?? "Speaker"} [{formatTimestamp(ctx.startTime)}]:
                    </b>{" "}
                    {ctx.text}
                  </p>
                ))}

                <p className="matched">
                  <b>
                    {mention.speakerDisplay ?? "Speaker"} [{formatTimestamp(mention.startTime)}]:
                  </b>{" "}
                  <span dangerouslySetInnerHTML={{ __html: mention.snippet }} />
                </p>

                {mention.contextAfter.map((ctx, i) => (
                  <p key={`a-${i}`} className="context">
                    <b>
                      {ctx.speakerDisplay ?? "Speaker"} [{formatTimestamp(ctx.startTime)}]:
                    </b>{" "}
                    {ctx.text}
                  </p>
                ))}
              </div>
            ))}
          </div>
        ))}

        <div className="footer">
          Generated by Podlog &middot; {new Date().toLocaleDateString()}
        </div>
      </body>
    </html>
  );
}
