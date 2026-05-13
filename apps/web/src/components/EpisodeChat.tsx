"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { BrainCircuit, Download, FileText, Send, Type, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import { sanitizeFilename } from "@/lib/filename";
import {
  RAG_MODELS,
  DEFAULT_RAG_MODEL,
  formatModelOption,
} from "@/lib/rag-models";
import MessageBubble, { type Message } from "./EpisodeChatMessage";
import {
  type ConversationMeta,
  downloadFile,
  generateConversationMarkdown,
  generateConversationText,
} from "./EpisodeChatExports";

type StreamStatus = "idle" | "connecting" | "streaming" | "done" | "error";

// Issue #699: cap history sent to the backend (mirrors the pipeline's own
// MAX_HISTORY_MESSAGES). 8 messages = 4 prior Q&A pairs.
const MAX_HISTORY_MESSAGES = 8;

interface EpisodeChatProps {
  episodeId: string;
  episodeTitle: string;
  feedTitle?: string | null;
  episodeDescription?: string | null;
}

export default function EpisodeChat({
  episodeId,
  episodeTitle,
  feedTitle,
  episodeDescription,
}: EpisodeChatProps) {
  const { state: playerState } = useAudioPlayer();
  const playerVisible = !!playerState.src;
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [model, setModel] = useState<string>(DEFAULT_RAG_MODEL);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Skip the first persist write so the unselected DEFAULT_RAG_MODEL isn't
  // written to localStorage on mount. Without this, opening EpisodeChat with
  // empty localStorage would poison the Ask page's "no preference" detection
  // (#637).
  const persistedOnce = useRef(false);

  // Hydrate model from localStorage, falling back to the backend default (#637).
  useEffect(() => {
    let cancelled = false;
    try {
      const stored = localStorage.getItem("podlog-ask-model");
      if (stored && RAG_MODELS.some((m) => m.value === stored)) {
        setModel(stored);
        return;
      }
    } catch {
      // localStorage unavailable (e.g. Safari private mode) — fall through to fetch.
    }
    fetch("/api/notifications/settings")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (
          data.rag_local_model &&
          RAG_MODELS.some((m: { value: string }) => m.value === data.rag_local_model)
        ) {
          setModel(data.rag_local_model);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist model selection
  useEffect(() => {
    if (!persistedOnce.current) {
      persistedOnce.current = true;
      return;
    }
    try {
      localStorage.setItem("podlog-ask-model", model);
    } catch {}
  }, [model]);

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

      // Issue #699: snapshot completed prior turns before adding the new
      // placeholder so the LLM has follow-up context. Strip the optional
      // `sources` field — the server contract is plain {role, content}.
      // Keep only fully-formed messages (assistant placeholders with empty
      // content from a still-streaming reply must not leak in).
      const priorHistory = messages
        .filter((m) => m.content.length > 0)
        .slice(-MAX_HISTORY_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content }));

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
          body: JSON.stringify({
            question: q,
            episode_id: episodeId,
            model,
            history: priorHistory,
          }),
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
    [input, episodeId, model, messages]
  );

  const isStreaming = status === "connecting" || status === "streaming";
  const hasCompletedExchange = messages.some(
    (m) => m.role === "assistant" && m.content.length > 0,
  );

  const handleExport = useCallback(
    (format: "markdown" | "text") => {
      const meta: ConversationMeta = { feedTitle, episodeTitle, episodeDescription };
      const safe = sanitizeFilename(episodeTitle, { maxLength: 50, fallback: "episode" });
      if (format === "markdown") {
        const content = generateConversationMarkdown(meta, messages);
        downloadFile(content, `podlog-ask-${safe}.md`, "text/markdown;charset=utf-8");
      } else {
        const content = generateConversationText(meta, messages);
        downloadFile(content, `podlog-ask-${safe}.txt`, "text/plain;charset=utf-8");
      }
    },
    [feedTitle, episodeTitle, episodeDescription, messages]
  );

  // Floating trigger button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed right-6 z-[60] flex items-center gap-2 rounded-full bg-action px-4 py-3 text-action-foreground shadow-lg hover:bg-action/90 transition-all ${
          playerVisible ? "bottom-40" : "bottom-6"
        }`}
        aria-label="Ask about this episode"
      >
        <BrainCircuit size={18} />
        <span className="text-sm font-medium">Ask</span>
      </button>
    );
  }

  // Chat panel
  return (
    <div className={`fixed right-6 z-[60] flex flex-col w-[calc(100vw-2rem)] sm:w-96 h-[min(28rem,calc(100vh-4rem))] rounded-xl border bg-background shadow-2xl ${
      playerVisible ? "bottom-40" : "bottom-6"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <BrainCircuit size={16} className="text-link shrink-0" />
          <span className="text-sm font-medium truncate">{episodeTitle}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasCompletedExchange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors p-1"
                  aria-label="Download conversation"
                  disabled={isStreaming}
                >
                  <Download size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 z-[70]">
                <DropdownMenuItem onClick={() => handleExport("markdown")} className="gap-2">
                  <FileText size={14} />
                  <span className="text-sm">Markdown (.md)</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("text")} className="gap-2">
                  <Type size={14} />
                  <span className="text-sm">Plain Text (.txt)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            onClick={() => setIsOpen(false)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            aria-label="Minimize chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Model selector row */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0 text-xs">
        <label htmlFor="episode-chat-model" className="text-muted-foreground">
          Model:
        </label>
        <select
          id="episode-chat-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={isStreaming}
          className="flex-1 min-w-0 text-xs border border-input rounded-md px-2 py-1 bg-background text-foreground disabled:opacity-60"
        >
          {RAG_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {formatModelOption(m)}
            </option>
          ))}
        </select>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Ask a question about this episode.
          </p>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            isStreaming={isStreaming && i === messages.length - 1}
          />
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
          className="flex-1 px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
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
