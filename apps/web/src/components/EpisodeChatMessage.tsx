"use client";

/**
 * Message bubble + citation handling for EpisodeChat (split out in #665).
 * Owns the assistant/user bubble rendering, the "Thinking..." placeholder
 * for streaming replies, the trimmed sources list, and the click-to-seek
 * behavior on citations and source links.
 */
import { Loader2 } from "lucide-react";
import { MarkdownAnswer, type Source } from "@/lib/citations";

export interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

function scrollToTime(secs: number) {
  window.dispatchEvent(
    new CustomEvent("podlog:scroll-to-time", { detail: { secs } }),
  );
}

function handleCitationClick(_episodeId: string, seconds: number) {
  scrollToTime(seconds);
}

export default function MessageBubble({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm max-w-[85%]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-lg px-3 py-2 text-sm max-w-[85%] space-y-2">
        {message.content ? (
          <MarkdownAnswer
            text={message.content}
            sources={message.sources ?? []}
            onCitationClick={handleCitationClick}
            className="prose prose-sm dark:prose-invert max-w-none prose-a:text-link prose-a:underline"
          />
        ) : isStreaming ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            <span className="text-xs">Thinking...</span>
          </div>
        ) : null}

        {message.sources && message.sources.length > 0 && (
          <div className="border-t border-border pt-1.5 mt-1.5">
            <p className="text-xs text-muted-foreground mb-1">
              {message.sources.length} source
              {message.sources.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-0.5">
              {message.sources.slice(0, 3).map((s) => (
                <button
                  key={s.chunk_id}
                  type="button"
                  onClick={() => scrollToTime(Math.floor(s.start_time))}
                  className="block w-full text-left text-xs text-link hover:underline truncate"
                >
                  {s.timestamp} {s.speaker_label ? `(${s.speaker_label})` : ""} —{" "}
                  {s.text.slice(0, 80)}...
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
