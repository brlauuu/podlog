"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { MessageSquare, Send, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { renderAnswerWithCitations, type Source } from "@/lib/citations";

type StreamStatus = "idle" | "connecting" | "streaming" | "done" | "error";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

interface EpisodeChatProps {
  episodeId: string;
  episodeTitle: string;
}

export default function EpisodeChat({ episodeId, episodeTitle }: EpisodeChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Abort in-flight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = input.trim();
      if (!q) return;

      setInput("");
      setErrorMsg("");
      setStatus("connecting");

      // Append user message and empty assistant placeholder
      setMessages((prev) => [
        ...prev,
        { role: "user", content: q },
        { role: "assistant", content: "" },
      ]);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch("/api/pipeline/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, episode_id: episodeId }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          setStatus("error");
          setErrorMsg("Failed to connect to the pipeline API.");
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ") && currentEvent) {
              const raw = line.slice(6);
              try {
                const data = JSON.parse(raw);
                if (currentEvent === "sources") {
                  setMessages((prev) => {
                    const next = [...prev];
                    next[next.length - 1] = { ...next[next.length - 1], sources: data };
                    return next;
                  });
                  setStatus("streaming");
                } else if (currentEvent === "token") {
                  setStatus("streaming");
                  setMessages((prev) => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    next[next.length - 1] = { ...last, content: last.content + data.content };
                    return next;
                  });
                } else if (currentEvent === "error") {
                  setErrorMsg(data.message || "Unknown error");
                  setStatus("error");
                } else if (currentEvent === "done") {
                  setStatus((s) => (s === "error" ? "error" : "idle"));
                }
              } catch {
                // skip malformed JSON
              }
              currentEvent = "";
            }
          }
        }

        setStatus((s) => (s === "streaming" ? "idle" : s));
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
        setErrorMsg("Connection failed. Is the pipeline running?");
      }
    },
    [input, episodeId]
  );

  const isStreaming = status === "connecting" || status === "streaming";

  // Floating trigger button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        aria-label="Ask about this episode"
      >
        <MessageSquare size={18} />
        <span className="text-sm font-medium">Ask</span>
      </button>
    );
  }

  // Chat panel
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col w-[calc(100vw-2rem)] sm:w-96 h-[28rem] rounded-xl border bg-background shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare size={16} className="text-primary shrink-0" />
          <span className="text-sm font-medium truncate">{episodeTitle}</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Minimize chat"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Ask a question about this episode.
          </p>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} isStreaming={isStreaming && i === messages.length - 1} />
        ))}

        {status === "error" && errorMsg && (
          <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {errorMsg}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 px-4 py-3 border-t shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this episode..."
          className="flex-1 px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={isStreaming}
          autoFocus
        />
        <Button type="submit" size="sm" disabled={!input.trim() || isStreaming} className="px-3">
          {isStreaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </form>
    </div>
  );
}

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const rendered = useMemo(
    () =>
      message.role === "assistant" && message.content
        ? renderAnswerWithCitations(message.content, message.sources ?? [])
        : null,
    [message.content, message.sources, message.role]
  );

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
          <div className="whitespace-pre-wrap">{rendered}</div>
        ) : isStreaming ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            <span className="text-xs">Thinking...</span>
          </div>
        ) : null}

        {message.sources && message.sources.length > 0 && (
          <div className="border-t border-border pt-1.5 mt-1.5">
            <p className="text-xs text-muted-foreground mb-1">
              {message.sources.length} source{message.sources.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-0.5">
              {message.sources.slice(0, 3).map((s) => (
                <a
                  key={s.chunk_id}
                  href={`/episodes/${s.episode_id}?t=${Math.floor(s.start_time)}`}
                  className="block text-xs text-primary hover:underline truncate"
                >
                  {s.timestamp} {s.speaker_label ? `(${s.speaker_label})` : ""} — {s.text.slice(0, 80)}...
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
