"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { MessageSquare, Send, Play, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface Source {
  chunk_id: number;
  episode_id: string;
  episode_title: string;
  speaker_label: string | null;
  start_time: number;
  end_time: number;
  timestamp: string;
  text: string;
  similarity: number;
}

interface Feed {
  id: string;
  title: string | null;
}

interface CoverageStats {
  processed: number;
  total: number;
}

type StreamStatus = "idle" | "connecting" | "streaming" | "done" | "error";

const MODEL_OPTIONS = [
  { value: "qwen2.5:1.5b", label: "Fast", hint: "6-8 tok/s, 8-15s" },
  { value: "qwen2.5:3b", label: "Default", hint: "3-4 tok/s, 15-25s" },
  { value: "phi3:mini", label: "Quality", hint: "2-3 tok/s, 20-40s" },
];

function getStoredModel(): string {
  if (typeof window === "undefined") return "qwen2.5:3b";
  return localStorage.getItem("podlog-ask-model") || "qwen2.5:3b";
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Parse citation patterns like [Episode Title, 12:34] in the answer text
 * and return React nodes with clickable links.
 */
function renderAnswerWithCitations(
  text: string,
  sources: Source[]
): React.ReactNode[] {
  // Match [anything, M:SS] or [anything, MM:SS]
  const citationRegex = /\[([^\]]+?),\s*(\d{1,3}:\d{2})\]/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = citationRegex.exec(text)) !== null) {
    // Add text before this citation
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const citedTitle = match[1].trim();
    const citedTimestamp = match[2];
    const [minStr, secStr] = citedTimestamp.split(":");
    const citedSeconds = parseInt(minStr) * 60 + parseInt(secStr);

    // Find matching source by title similarity
    const matchedSource = sources.find(
      (s) =>
        s.episode_title.toLowerCase().includes(citedTitle.toLowerCase()) ||
        citedTitle.toLowerCase().includes(s.episode_title.toLowerCase())
    );

    if (matchedSource) {
      nodes.push(
        <Link
          key={`cite-${match.index}`}
          href={`/episodes/${matchedSource.episode_id}?t=${citedSeconds}`}
          className="inline-flex items-center gap-0.5 text-primary hover:underline font-medium"
          title={`${matchedSource.episode_title} at ${citedTimestamp}`}
        >
          [{citedTitle}, {citedTimestamp}]
        </Link>
      );
    } else {
      // No match found — render as styled but non-linked citation
      nodes.push(
        <span
          key={`cite-${match.index}`}
          className="text-muted-foreground font-medium"
        >
          [{citedTitle}, {citedTimestamp}]
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [model, setModel] = useState(getStoredModel);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<string>>(new Set());
  const [feedDropdownOpen, setFeedDropdownOpen] = useState(false);
  const [hasManualUploads, setHasManualUploads] = useState(false);
  const [coverage, setCoverage] = useState<CoverageStats | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const feedDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("podlog-ask-model", model);
  }, [model]);

  // Close feed dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (feedDropdownRef.current && !feedDropdownRef.current.contains(e.target as Node)) {
        setFeedDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch feeds and coverage stats
  useEffect(() => {
    fetch("/api/feeds")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setFeeds(data);
      })
      .catch(() => {});

    // Check for manual uploads (episodes with no feed_id)
    fetch("/api/ask/coverage")
      .then((r) => r.json())
      .then((data) => {
        setCoverage({ processed: data.processed, total: data.total });
        setHasManualUploads(data.has_manual_uploads ?? false);
      })
      .catch(() => {});
  }, []);

  const renderedAnswer = useMemo(
    () => (answer ? renderAnswerWithCitations(answer, sources) : null),
    [answer, sources]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = question.trim();
      if (!q) return;

      // Reset state
      setAnswer("");
      setSources([]);
      setErrorMsg("");
      setStatus("connecting");

      // Abort previous request if any
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const body: Record<string, unknown> = { question: q, model };
        if (selectedFeedIds.size > 0) body.feed_ids = Array.from(selectedFeedIds);

        const resp = await fetch("/api/pipeline/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
                  setSources(data);
                  setStatus("streaming");
                } else if (currentEvent === "token") {
                  setStatus("streaming");
                  setAnswer((prev) => prev + data.content);
                } else if (currentEvent === "error") {
                  setErrorMsg(data.message || "Unknown error");
                  setStatus("error");
                } else if (currentEvent === "done") {
                  setStatus((s) => (s === "error" ? "error" : "done"));
                }
              } catch {
                // skip malformed JSON
              }
              currentEvent = "";
            }
          }
        }

        // Ensure we mark done if stream ended without done event
        setStatus((s) => (s === "streaming" ? "done" : s));
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
        setErrorMsg("Connection failed. Is the pipeline running?");
      }
    },
    [question, model, selectedFeedIds]
  );

  function handlePlaySource(source: Source) {
    window.open(
      `/episodes/${source.episode_id}?t=${Math.floor(source.start_time)}`,
      "_blank"
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <MessageSquare size={24} />
          Ask
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask questions about your podcast transcripts. Answers are generated
          from transcript excerpts and may take 15-30 seconds.
        </p>
      </div>

      {/* Controls row: model + feed filter + coverage */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label
            htmlFor="model-select"
            className="text-sm text-muted-foreground"
          >
            Model:
          </label>
          <select
            id="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-sm border border-input rounded-md px-2 py-1 bg-background text-foreground"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} &middot; {opt.value} ({opt.hint})
              </option>
            ))}
          </select>
        </div>

        {(feeds.length > 0 || hasManualUploads) && (
          <div className="relative" ref={feedDropdownRef}>
            <button
              type="button"
              onClick={() => setFeedDropdownOpen((o) => !o)}
              className="flex items-center gap-1.5 text-sm border border-input rounded-md px-2 py-1 bg-background text-foreground hover:bg-accent/30 transition-colors"
            >
              <span className="text-muted-foreground">Source:</span>
              {selectedFeedIds.size === 0
                ? "All"
                : `${selectedFeedIds.size} selected`}
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
            {feedDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-md shadow-lg py-1 min-w-[220px] max-h-64 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => setSelectedFeedIds(new Set())}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent/30 transition-colors ${
                    selectedFeedIds.size === 0 ? "font-medium" : ""
                  }`}
                >
                  All sources
                </button>
                <div className="border-t border-border my-1" />
                {feeds.map((f) => (
                  <label
                    key={f.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/30 transition-colors cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFeedIds.has(f.id)}
                      onChange={() => {
                        setSelectedFeedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(f.id)) next.delete(f.id);
                          else next.add(f.id);
                          return next;
                        });
                      }}
                      className="rounded"
                    />
                    <span className="truncate">{f.title || "Untitled"}</span>
                  </label>
                ))}
                {hasManualUploads && (
                  <>
                    <div className="border-t border-border my-1" />
                    <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/30 transition-colors cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedFeedIds.has("__uploads__")}
                        onChange={() => {
                          setSelectedFeedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has("__uploads__")) next.delete("__uploads__");
                            else next.add("__uploads__");
                            return next;
                          });
                        }}
                        className="rounded"
                      />
                      <span>Manual uploads</span>
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {coverage && (
          <span className="text-xs text-muted-foreground">
            Searching across {coverage.processed} processed episode{coverage.processed !== 1 ? "s" : ""}
            {coverage.total > coverage.processed && ` (${coverage.total - coverage.processed} still processing)`}
          </span>
        )}
      </div>

      {/* Question input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What did they discuss about..."
          className="flex-1 px-4 py-3 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
          disabled={status === "connecting" || status === "streaming"}
          autoFocus
        />
        <Button
          type="submit"
          disabled={
            !question.trim() ||
            status === "connecting" ||
            status === "streaming"
          }
          className="px-4"
        >
          <Send size={18} />
        </Button>
      </form>

      {/* Loading indicator */}
      {status === "connecting" && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={16} className="animate-spin" />
          Searching transcripts and generating answer...
        </div>
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <div className="border border-destructive/50 bg-destructive/10 rounded-lg p-4 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      {/* Answer with parsed citations */}
      {answer && (
        <div className="border border-border rounded-lg p-4 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Answer</h2>
          <div
            ref={answerRef}
            className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap"
          >
            {renderedAnswer}
            {status === "streaming" && (
              <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse ml-0.5" />
            )}
          </div>
        </div>
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Sources ({sources.length} transcript excerpts)
          </h2>
          <div className="grid gap-2">
            {sources.map((source) => (
              <div
                key={source.chunk_id}
                className="border border-border rounded-lg p-3 text-sm space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link
                      href={`/episodes/${source.episode_id}?t=${Math.floor(source.start_time)}`}
                      className="font-medium truncate hover:underline text-primary"
                    >
                      {source.episode_title}
                    </Link>
                    <span className="text-muted-foreground shrink-0">
                      {source.timestamp}
                    </span>
                    {source.speaker_label && (
                      <span className="text-xs text-muted-foreground bg-accent px-1.5 py-0.5 rounded shrink-0">
                        {source.speaker_label}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handlePlaySource(source)}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    title="Play from this point"
                  >
                    <Play size={14} />
                  </button>
                </div>
                <p className="text-muted-foreground line-clamp-2">
                  {source.text}
                </p>
                <div className="text-xs text-muted-foreground/60">
                  {Math.round(source.similarity * 100)}% match
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
