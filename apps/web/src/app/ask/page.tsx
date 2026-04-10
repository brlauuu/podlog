"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Play, BrainCircuit, ArrowRight } from "lucide-react";
import Link from "next/link";
import { renderAnswerWithCitations, type Source } from "@/lib/citations";
import { episodeTimestampHref } from "@/lib/episode-link";
import { loadAskSnapshot, saveAskSnapshot } from "@/lib/page-state";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import { basename } from "@/lib/utils";
import SearchInput from "@/components/SearchInput";
import HelpPopover from "@/components/HelpPopover";
import SearchSpinner from "@/components/SearchSpinner";
import PodcastFilter from "@/components/PodcastFilter";

interface Feed {
  id: string;
  title: string | null;
  episode_count: number;
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

export default function AskPage() {
  const initialSnapshot = loadAskSnapshot();
  const [question, setQuestion] = useState(initialSnapshot?.question || "");
  const [answer, setAnswer] = useState(initialSnapshot?.answer || "");
  const [sources, setSources] = useState<Source[]>(initialSnapshot?.sources || []);
  const [status, setStatus] = useState<StreamStatus>(() => {
    const snapshotStatus = initialSnapshot?.status;
    if (snapshotStatus === "done" || snapshotStatus === "error") return snapshotStatus;
    return "idle";
  });
  const [errorMsg, setErrorMsg] = useState(initialSnapshot?.errorMsg || "");
  const [model, setModel] = useState(initialSnapshot?.model || getStoredModel);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<string>>(
    new Set(initialSnapshot?.selectedFeedIds || [])
  );
  const [hasManualUploads, setHasManualUploads] = useState(false);
  const [coverage, setCoverage] = useState<CoverageStats | null>(null);
  const [helpCoverageSnapshot, setHelpCoverageSnapshot] = useState<CoverageStats | null>(() => {
    const snapshot = loadAskSnapshot();
    return snapshot?.helpCoverageSnapshot ?? null;
  });
  const answerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { playEpisode } = useAudioPlayer();

  useEffect(() => {
    localStorage.setItem("podlog-ask-model", model);
  }, [model]);

  useEffect(() => {
    const snapshotStatus =
      status === "connecting" || status === "streaming" ? "idle" : status;
    saveAskSnapshot({
      question,
      answer,
      sources,
      status: snapshotStatus,
      errorMsg,
      model,
      selectedFeedIds: Array.from(selectedFeedIds),
      helpCoverageSnapshot,
    });
  }, [question, answer, sources, status, errorMsg, model, selectedFeedIds, helpCoverageSnapshot]);

  // Fetch feeds and coverage stats
  useEffect(() => {
    fetch("/api/feeds")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setFeeds(data);
      })
      .catch(() => {});

    fetch("/api/ask/coverage")
      .then((r) => r.json())
      .then((data) => {
        setCoverage({ processed: data.processed, total: data.total });
        setHelpCoverageSnapshot((prev) =>
          prev ?? { processed: data.processed, total: data.total }
        );
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

      setAnswer("");
      setSources([]);
      setErrorMsg("");
      setStatus("connecting");

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const body: Record<string, unknown> = { question: q, model };
        if (selectedFeedIds.size > 0)
          body.feed_ids = Array.from(selectedFeedIds);

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

        setStatus((s) => (s === "streaming" ? "done" : s));
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
        setErrorMsg((prev) =>
          prev || "Connection failed. Is the pipeline running?"
        );
      }
    },
    [question, model, selectedFeedIds]
  );

  function handleClear() {
    setQuestion("");
    setAnswer("");
    setSources([]);
    setErrorMsg("");
    setStatus("idle");
    abortRef.current?.abort();
  }

  function handlePlaySource(source: Source) {
    if (!source.audio_local_path) {
      window.open(episodeTimestampHref(source.episode_id, source.start_time), "_blank");
      return;
    }
    playEpisode(
      source.episode_id,
      basename(source.audio_local_path),
      source.start_time,
      source.episode_title
    );
  }

  const isProcessing = status === "connecting" || status === "streaming";
  const helpSummary = useMemo(() => {
    if (!helpCoverageSnapshot) return null;
    const remaining = Math.max(0, helpCoverageSnapshot.total - helpCoverageSnapshot.processed);
    return `Analyzing ${helpCoverageSnapshot.processed} processed episodes (${remaining} still processing)`;
  }, [helpCoverageSnapshot]);

  const processingCount = coverage
    ? Math.max(0, coverage.total - coverage.processed)
    : 0;

  return (
    <div className="space-y-6">
      {/* Centered header + input */}
      <div className={`flex flex-col items-center ${answer || sources.length > 0 ? "pt-2" : "pt-16"} transition-all`}>
        <div className="w-full max-w-2xl space-y-3">
          {/* Title + help popover */}
          <HelpPopover title="Ask">
            <p>
              Retrieval-augmented analysis across your transcripts. Finds the 8 most relevant transcript excerpts and generates an answer grounded in their content.
            </p>
            {helpSummary && (
              <p className="mt-2 text-muted-foreground">{helpSummary}</p>
            )}
          </HelpPopover>

          {/* Ask input */}
          <SearchInput
            value={question}
            onChange={setQuestion}
            onSubmit={handleSubmit}
            onClear={handleClear}
            placeholder="Ask about your transcripts..."
            icon={<BrainCircuit size={18} />}
            disabled={isProcessing}
            rightSlot={
              <button
                type="submit"
                disabled={!question.trim() || isProcessing}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <ArrowRight size={18} />
              </button>
            }
          />

          {/* Stats below search bar */}
          {!answer && sources.length === 0 && coverage && (
            <p className="text-center text-xs text-muted-foreground">
              Searching across {feeds.length} podcast
              {feeds.length !== 1 ? "s" : ""} and {coverage.processed} episode
              {coverage.processed !== 1 ? "s" : ""}
              {processingCount > 0 && (
                <> ({processingCount} still processing)</>
              )}
            </p>
          )}

          {/* Settings row below input */}
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
            {/* Model selector */}
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="model-select"
                className="text-muted-foreground"
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

            {/* Source filter */}
            <PodcastFilter
              feeds={feeds}
              selectedFeedIds={selectedFeedIds}
              onSelectionChange={setSelectedFeedIds}
              hasManualUploads={hasManualUploads}
            />
          </div>

        </div>
      </div>

      {/* Loading / generating indicator */}
      {isProcessing && (
        <SearchSpinner
          label={
            status === "connecting"
              ? "Searching transcripts..."
              : !answer
                ? "Generating answer..."
                : "Writing..."
          }
        />
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <div className="border border-destructive/50 bg-destructive/10 rounded-lg p-4 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      {/* Answer */}
      {answer && (
        <div className="border border-border rounded-lg p-4 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Analysis
          </h2>
          <div
            ref={answerRef}
            className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap"
          >
            {renderedAnswer}
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
                      href={episodeTimestampHref(source.episode_id, source.start_time)}
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
