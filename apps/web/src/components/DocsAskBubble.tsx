"use client";

/**
 * #990: Ask about Podlog's own documentation.
 *
 * Deliberately distinct from EpisodeChat, which asks about podcast
 * transcripts. This one posts to /api/docs/ask, where retrieval happens
 * over the guide, the reference docs and the design docs, and cites the
 * exact section each answer came from.
 *
 * The streaming loop and open/closed structure follow EpisodeChat --
 * including the `{"content": ...}` token frame shape the pipeline emits.
 * Do not introduce a second parser for the same stream.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Loader2, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { citationHref, citationSourceLabel } from "@/lib/docs-retrieval";

type StreamStatus = "idle" | "connecting" | "streaming" | "error";

/** Mirrors the pipeline's ContextSection, echoed back on the sources event. */
interface DocSourceRef {
  title: string;
  source: string;
  slug: string;
  anchor: string | null;
  repo_path: string;
  text: string;
}

interface DocsMessage {
  role: "user" | "assistant";
  content: string;
  /** Citations belong to the answer they produced, not to the panel: with a
   *  single shared list, a follow-up would silently retitle the previous
   *  answer's sources. */
  sources?: DocSourceRef[];
}

// Mirrors the pipeline's MAX_HISTORY_MESSAGES.
const MAX_HISTORY_MESSAGES = 8;

export default function DocsAskBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<DocsMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const isStreaming = status === "connecting" || status === "streaming";

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = input.trim();
      if (!q) return;

      setInput("");
      setErrorMsg("");
      setStatus("connecting");

      const priorHistory = messages
        .filter((m) => m.content.length > 0)
        .slice(-MAX_HISTORY_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [
        ...prev,
        { role: "user", content: q },
        { role: "assistant", content: "" },
      ]);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch("/api/docs/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // No `model` on purpose (#990). The pipeline resolves it from
          // Settings: rag_provider chooses local vs Fireworks, then
          // rag_local_model / fireworks_chat_model chooses the model. Pinning
          // one here would win over `model or runtime.get("rag_local_model")`
          // in api/ask.py and silently ignore the configured local model.
          body: JSON.stringify({
            question: q,
            history: priorHistory,
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          setStatus("error");
          setErrorMsg("Failed to reach the documentation service.");
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
              try {
                const data = JSON.parse(line.slice(6));
                if (currentEvent === "sources") {
                  setStatus("streaming");
                  setMessages((prev) => {
                    const next = [...prev];
                    next[next.length - 1] = {
                      ...next[next.length - 1],
                      sources: data as DocSourceRef[],
                    };
                    return next;
                  });
                } else if (currentEvent === "token") {
                  setStatus("streaming");
                  setMessages((prev) => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    next[next.length - 1] = {
                      ...last,
                      content: last.content + data.content,
                    };
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
    [input, messages],
  );

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-full border bg-background px-4 py-3 shadow-lg transition-colors hover:bg-accent"
        aria-label="Ask about the docs"
      >
        <BookOpen size={18} />
        <span className="text-sm font-medium">Ask about the docs</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-[60] flex flex-col w-[calc(100vw-2rem)] sm:w-96 h-[min(28rem,calc(100vh-4rem))] rounded-xl border bg-background shadow-2xl">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen size={16} className="text-link shrink-0" />
          <span className="text-sm font-medium truncate">Ask about the docs</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          aria-label="Minimize"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Ask how Podlog works, or why it works the way it does. Answers come
            from the user guide, the reference documentation and the design
            documents.
          </p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={msg.role === "user" ? "text-right" : "text-left"}
          >
            <div
              className={`inline-block max-w-full rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-left ${
                msg.role === "user"
                  ? "bg-accent"
                  : "bg-muted"
              }`}
            >
              {msg.content}
              {msg.role === "assistant" &&
                !msg.content &&
                isStreaming &&
                i === messages.length - 1 && (
                  <Loader2 size={14} className="animate-spin" />
                )}
            </div>
            {msg.sources && msg.sources.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-left">
                {msg.sources.map((s) => (
                  <li key={`${s.repo_path}#${s.anchor ?? ""}`}>
                    <a
                      href={citationHref(s.source, s.slug, s.anchor, s.repo_path)}
                      className="text-link hover:underline"
                      {...(s.source === "guide"
                        ? {}
                        : { target: "_blank", rel: "noreferrer" })}
                    >
                      {s.title}
                    </a>
                    <span className="ml-1 text-muted-foreground">
                      {citationSourceLabel(s.source)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {status === "error" && errorMsg && (
          <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {errorMsg}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 px-4 py-3 border-t shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about Podlog..."
          className="flex-1 px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
          disabled={isStreaming}
          autoFocus
        />
        <Button
          type="submit"
          size="sm"
          disabled={!input.trim() || isStreaming}
          className="px-3"
          aria-label="Send"
        >
          {isStreaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </form>
    </div>
  );
}
