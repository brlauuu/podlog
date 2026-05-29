/**
 * @jest-environment jsdom
 *
 * Tests for /search page (apps/web/src/app/search/page.tsx).
 * Stubs the heavy child components (FeedGroupCard, SearchResult, the
 * top-panel and toolbar) and drives the page through its URL-state and
 * fetch-mutation handlers (coverage gap closed in #765).
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------- Router / search-params mocks ----------
const replaceMock = jest.fn();
let searchParamsString = "";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () =>
    new URLSearchParams(searchParamsString),
}));

// ---------- Child-component stubs ----------
jest.mock("@/components/SearchTopPanel", () => ({
  __esModule: true,
  default: ({
    query,
    onQueryChange,
    onSubmit,
    onClear,
  }: {
    query: string;
    onQueryChange: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    onClear: () => void;
  }) => (
    <form onSubmit={onSubmit} data-testid="top-panel">
      <input
        data-testid="q-input"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <button type="submit" data-testid="submit-btn">
        Search
      </button>
      <button type="button" onClick={onClear} data-testid="clear-btn">
        Clear
      </button>
    </form>
  ),
}));

jest.mock("@/components/SearchResultsToolbar", () => ({
  __esModule: true,
  default: ({
    viewMode,
    onViewModeChange,
    summaryText,
  }: {
    viewMode: "grouped" | "flat";
    onViewModeChange: (m: "grouped" | "flat") => void;
    summaryText: string;
  }) => (
    <div data-testid="toolbar">
      <span data-testid="summary">{summaryText}</span>
      <span data-testid="view-mode">{viewMode}</span>
      <button onClick={() => onViewModeChange("flat")} data-testid="to-flat">
        Flat
      </button>
      <button onClick={() => onViewModeChange("grouped")} data-testid="to-grouped">
        Grouped
      </button>
    </div>
  ),
}));

jest.mock("@/components/SearchResult", () => ({
  __esModule: true,
  default: ({ result }: { result: { id: string } }) => (
    <div data-testid={`result-${result.id}`}>result {result.id}</div>
  ),
}));

jest.mock("@/components/FeedGroupCard", () => ({
  __esModule: true,
  default: ({ feed }: { feed: { feedId: string } }) => (
    <div data-testid={`group-${feed.feedId}`}>group {feed.feedId}</div>
  ),
}));

jest.mock("@/components/SearchSpinner", () => ({
  __esModule: true,
  default: ({ label }: { label: string }) => (
    <div data-testid="spinner">{label}</div>
  ),
}));

jest.mock("@/components/SearchNoResults", () => ({
  __esModule: true,
  default: ({ query }: { query: string }) => (
    <div data-testid="no-results">no results for {query}</div>
  ),
}));

jest.mock("@/components/SearchPagination", () => ({
  __esModule: true,
  default: ({ page, totalPages }: { page: number; totalPages: number }) => (
    <div data-testid="pagination">
      page {page} of {totalPages}
    </div>
  ),
}));

// Clear localStorage between tests so page-state.loadSearchSnapshot
// doesn't leak across cases.
beforeEach(() => {
  searchParamsString = "";
  replaceMock.mockReset();
  window.localStorage.clear();
});

import SearchPage from "@/app/search/page";

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

type FetchInit = RequestInit | undefined;
interface FetchMockEntry {
  url: string;
  init: FetchInit;
}

function installFetchMock(handlers: {
  [path: string]: (init: FetchInit, url: string) => Response;
}) {
  const calls: FetchMockEntry[] = [];
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const path = url.split("?")[0];
    const handler = handlers[path];
    if (!handler) {
      return Promise.resolve(json({ error: `no mock for ${path}` }, 500));
    }
    return Promise.resolve(handler(init, url));
  }) as unknown as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("SearchPage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders with no submitted query when URL is empty", async () => {
    installFetchMock({
      "/api/feeds": () => json([]),
      "/api/ask/coverage": () =>
        json({ processed: 0, total: 0, has_manual_uploads: false }),
    });

    render(withQuery(<SearchPage />));
    // Top panel always renders
    expect(await screen.findByTestId("top-panel")).toBeInTheDocument();
    // No spinner, no toolbar, no results without submitted query.
    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("toolbar")).not.toBeInTheDocument();
  });

  it("hydrates query from ?q= and fires the grouped-search fetch", async () => {
    searchParamsString = "q=hello";
    const calls = installFetchMock({
      "/api/feeds": () => json([]),
      "/api/ask/coverage": () =>
        json({ processed: 5, total: 10, has_manual_uploads: false }),
      "/api/search/grouped": () =>
        json({
          feeds: [
            { feedId: "f1", feedTitle: "F", episodes: [] },
          ],
          totalFeeds: 1,
          totalEpisodes: 2,
          totalMentions: 3,
          coverage: { processed: 5, total: 10 },
        }),
    });

    render(withQuery(<SearchPage />));

    await waitFor(() => expect(screen.getByTestId("group-f1")).toBeInTheDocument());
    const groupedCall = calls.find((c) => c.url.includes("/api/search/grouped"));
    expect(groupedCall).toBeDefined();
    expect(groupedCall!.url).toContain("q=hello");
  });

  it("renders the summary line for grouped results with correct pluralization", async () => {
    searchParamsString = "q=topic";
    installFetchMock({
      "/api/feeds": () => json([]),
      "/api/ask/coverage": () =>
        json({ processed: 0, total: 0, has_manual_uploads: false }),
      "/api/search/grouped": () =>
        json({
          feeds: [{ feedId: "f1", feedTitle: "F", episodes: [] }],
          totalFeeds: 1,
          totalEpisodes: 1,
          totalMentions: 1,
          coverage: { processed: 0, total: 0 },
        }),
    });

    render(withQuery(<SearchPage />));
    const summary = await screen.findByTestId("summary");
    // Singular case for each: 1 podcast, 1 episode, 1 mention
    expect(summary.textContent).toMatch(/1 podcast,\s*1 episode\s*\(1 mention\)/);
  });

  it("switches to flat mode and fires the flat-search fetch", async () => {
    searchParamsString = "q=topic";
    const calls = installFetchMock({
      "/api/feeds": () => json([]),
      "/api/ask/coverage": () =>
        json({ processed: 0, total: 0, has_manual_uploads: false }),
      "/api/search/grouped": () =>
        json({
          feeds: [{ feedId: "f1", feedTitle: "F", episodes: [] }],
          totalFeeds: 1,
          totalEpisodes: 1,
          totalMentions: 1,
          coverage: { processed: 0, total: 0 },
        }),
      "/api/search": () =>
        json({
          results: [{ id: "r1" }, { id: "r2" }],
          total: 2,
          coverage: { processed: 0, total: 0 },
        }),
    });

    render(withQuery(<SearchPage />));
    await waitFor(() => expect(screen.getByTestId("toolbar")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("to-flat"));

    await waitFor(() => {
      const flatCall = calls.find(
        (c) =>
          c.url.startsWith("/api/search?") || c.url.includes("/api/search?q"),
      );
      expect(flatCall).toBeDefined();
    });
    expect(await screen.findByTestId("result-r1")).toBeInTheDocument();
    expect(screen.getByTestId("result-r2")).toBeInTheDocument();
  });

  it("submits the form and pushes the URL via router.replace", async () => {
    installFetchMock({
      "/api/feeds": () => json([]),
      "/api/ask/coverage": () =>
        json({ processed: 0, total: 0, has_manual_uploads: false }),
      "/api/search/grouped": () =>
        json({
          feeds: [],
          totalFeeds: 0,
          totalEpisodes: 0,
          totalMentions: 0,
          coverage: { processed: 0, total: 0 },
        }),
    });

    render(withQuery(<SearchPage />));
    const input = (await screen.findByTestId("q-input")) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "podcasts");
    await userEvent.click(screen.getByTestId("submit-btn"));

    expect(replaceMock).toHaveBeenCalledWith(
      "/search?q=podcasts",
      expect.objectContaining({ scroll: false }),
    );
  });

  it("clears the query and resets the URL when Clear is pressed", async () => {
    searchParamsString = "q=hello";
    installFetchMock({
      "/api/feeds": () => json([]),
      "/api/ask/coverage": () =>
        json({ processed: 0, total: 0, has_manual_uploads: false }),
      "/api/search/grouped": () =>
        json({
          feeds: [],
          totalFeeds: 0,
          totalEpisodes: 0,
          totalMentions: 0,
          coverage: { processed: 0, total: 0 },
        }),
    });

    render(withQuery(<SearchPage />));
    await waitFor(() => expect(screen.getByTestId("toolbar")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("clear-btn"));
    expect(replaceMock).toHaveBeenCalledWith(
      "/search",
      expect.objectContaining({ scroll: false }),
    );
  });

  it("shows the no-results component when grouped search returns no feeds", async () => {
    searchParamsString = "q=zzznomatch";
    installFetchMock({
      "/api/feeds": () => json([]),
      "/api/ask/coverage": () =>
        json({ processed: 0, total: 0, has_manual_uploads: false }),
      "/api/search/grouped": () =>
        json({
          feeds: [],
          totalFeeds: 0,
          totalEpisodes: 0,
          totalMentions: 0,
          coverage: { processed: 0, total: 0 },
        }),
    });

    render(withQuery(<SearchPage />));
    expect(await screen.findByTestId("no-results")).toBeInTheDocument();
  });
});
