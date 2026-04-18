import type { Source } from "@/lib/citations";

type ViewMode = "grouped" | "flat";
type AskStatus = "idle" | "connecting" | "streaming" | "done" | "error";

const SEARCH_STORAGE_KEY = "podlog-search-page-state";
const ASK_STORAGE_KEY = "podlog-ask-page-state";

interface SearchPageSnapshot {
  query: string;
  submittedQuery: string;
  selectedFeedIds: string[];
  selectedSpeaker?: string | null;
  page: number;
  pageSize?: number;
  viewMode: ViewMode;
}

interface AskPageSnapshot {
  question: string;
  answer: string;
  sources: Source[];
  status: AskStatus;
  errorMsg: string;
  model: string;
  selectedFeedIds: string[];
  helpCoverageSnapshot?: { processed: number; total: number } | null;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isViewMode(value: unknown): value is ViewMode {
  return value === "grouped" || value === "flat";
}

function isAskStatus(value: unknown): value is AskStatus {
  return (
    value === "idle" ||
    value === "connecting" ||
    value === "streaming" ||
    value === "done" ||
    value === "error"
  );
}

function getSessionStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

export function saveSearchSnapshot(snapshot: SearchPageSnapshot, storage?: Storage): void {
  const target = getSessionStorage(storage);
  if (!target) return;
  target.setItem(SEARCH_STORAGE_KEY, JSON.stringify(snapshot));
}

export function loadSearchSnapshot(storage?: Storage): SearchPageSnapshot | null {
  const target = getSessionStorage(storage);
  if (!target) return null;
  const parsed = parseJson<SearchPageSnapshot>(target.getItem(SEARCH_STORAGE_KEY));
  if (!parsed) return null;
  if (
    typeof parsed.query !== "string" ||
    typeof parsed.submittedQuery !== "string" ||
    !Array.isArray(parsed.selectedFeedIds) ||
    typeof parsed.page !== "number" ||
    !Number.isFinite(parsed.page) ||
    parsed.page < 1 ||
    (parsed.pageSize !== undefined &&
      (typeof parsed.pageSize !== "number" ||
        !Number.isFinite(parsed.pageSize) ||
        parsed.pageSize < 1)) ||
    !isViewMode(parsed.viewMode)
  ) {
    return null;
  }
  return parsed;
}

export function saveAskSnapshot(snapshot: AskPageSnapshot, storage?: Storage): void {
  const target = getSessionStorage(storage);
  if (!target) return;
  target.setItem(ASK_STORAGE_KEY, JSON.stringify(snapshot));
}

export function loadAskSnapshot(storage?: Storage): AskPageSnapshot | null {
  const target = getSessionStorage(storage);
  if (!target) return null;
  const parsed = parseJson<AskPageSnapshot>(target.getItem(ASK_STORAGE_KEY));
  if (!parsed) return null;
  const maybeHelpCoverage = parsed.helpCoverageSnapshot;
  const hasValidHelpCoverage =
    maybeHelpCoverage === undefined ||
    maybeHelpCoverage === null ||
    (typeof maybeHelpCoverage === "object" &&
      maybeHelpCoverage !== null &&
      typeof maybeHelpCoverage.processed === "number" &&
      Number.isFinite(maybeHelpCoverage.processed) &&
      typeof maybeHelpCoverage.total === "number" &&
      Number.isFinite(maybeHelpCoverage.total));
  if (
    typeof parsed.question !== "string" ||
    typeof parsed.answer !== "string" ||
    !Array.isArray(parsed.sources) ||
    !isAskStatus(parsed.status) ||
    typeof parsed.errorMsg !== "string" ||
    typeof parsed.model !== "string" ||
    !Array.isArray(parsed.selectedFeedIds) ||
    !hasValidHelpCoverage
  ) {
    return null;
  }
  return parsed;
}
