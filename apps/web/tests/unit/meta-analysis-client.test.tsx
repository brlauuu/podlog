import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Stub the chart + auxiliary child components to probes so the test
// focuses on MetaAnalysisClient orchestration logic, not chart rendering
// (those have their own tests).
jest.mock("@/app/meta-analysis/FiltersBar", () => ({
  __esModule: true,
  default: ({ onSelectionChange }: { onSelectionChange: (id: string | null) => void }) => (
    <button data-testid="filters-bar" onClick={() => onSelectionChange("feed-1")}>
      filters
    </button>
  ),
}));
jest.mock("@/app/meta-analysis/CoverageStrip", () => ({
  __esModule: true,
  default: ({ onOpenMissingSpeakers }: { onOpenMissingSpeakers: () => void }) => (
    <button data-testid="coverage-strip" onClick={onOpenMissingSpeakers}>
      coverage
    </button>
  ),
}));
jest.mock("@/app/meta-analysis/MissingSpeakersModal", () => ({
  __esModule: true,
  default: ({ open, data }: { open: boolean; data: unknown }) =>
    open ? <div data-testid="missing-modal">{JSON.stringify(data)}</div> : null,
}));
jest.mock("@/app/meta-analysis/ChartCard", () => ({
  __esModule: true,
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`chart-card-${title}`}>{children}</div>
  ),
}));
jest.mock("@/app/meta-analysis/charts/SpeakerMinutesChart", () => ({
  __esModule: true,
  default: ({ rows, source }: { rows: unknown[]; source: string }) => (
    <div data-testid="speaker-minutes">{`${rows.length}|${source}`}</div>
  ),
}));
jest.mock("@/app/meta-analysis/charts/SpeakerWordsChart", () => ({
  __esModule: true,
  default: ({ rows, source }: { rows: unknown[]; source: string }) => (
    <div data-testid="speaker-words">{`${rows.length}|${source}`}</div>
  ),
}));
jest.mock("@/app/meta-analysis/charts/HostGuestDiffChart", () => ({
  __esModule: true,
  default: ({ rows, source }: { rows: unknown[]; source: string }) => (
    <div data-testid="host-guest-diff">{`${rows.length}|${source}`}</div>
  ),
}));
jest.mock("@/app/meta-analysis/InfoBlock", () => ({
  __esModule: true,
  default: () => <div data-testid="info-block" />,
}));
jest.mock("@/app/meta-analysis/ExploreStatusPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="explore-status" />,
}));
jest.mock("@/lib/dateFormat", () => ({
  formatDateTime: () => "2026-06-07 12:00",
}));

import MetaAnalysisClient from "@/app/meta-analysis/MetaAnalysisClient";

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const baseSnapshot = {
  snapshot: {
    per_feed: [
      { feed_id: "feed-1", title: "Show A" },
      { feed_id: "feed-2", title: "Show B" },
    ],
    per_episode_speaker: [
      { feed_id: "feed-1", episode_id: "ep-1", speaker_id: 1 },
      { feed_id: "feed-2", episode_id: "ep-2", speaker_id: 2 },
    ],
    episode_speaker_diff: [
      { feed_id: "feed-1", episode_id: "ep-1", diff: 12 },
      { feed_id: "feed-2", episode_id: "ep-2", diff: -5 },
    ],
    coverage: { host_share: { excluded: ["ep-3"] } },
  },
  is_stale: false,
  computed_at: "2026-06-07T10:00:00Z",
  episode_count: 42,
  feed_count: 7,
  last_error: null,
};

describe("MetaAnalysisClient", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("renders loading state first", () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {})   // never resolves
    );
    render(withQuery(<MetaAnalysisClient />));
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders empty state when snapshot is null", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        snapshot: null, is_stale: true, computed_at: null,
        episode_count: 0, feed_count: 0, last_error: null,
      }),
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByText(/No analysis yet/i)).toBeInTheDocument()
    );
  });

  it("renders error state on fetch failure", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("boom"));
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByText(/Could not load/i)).toBeInTheDocument()
    );
  });

  it("renders the full UI when a snapshot is loaded", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => baseSnapshot,
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByTestId("speaker-minutes")).toBeInTheDocument()
    );
    expect(screen.getByText(/Updated 2026-06-07 12:00/)).toBeInTheDocument();
    expect(screen.getByTestId("filters-bar")).toBeInTheDocument();
    expect(screen.getByTestId("coverage-strip")).toBeInTheDocument();
    expect(screen.getByTestId("explore-status")).toBeInTheDocument();
    expect(screen.getByTestId("info-block")).toBeInTheDocument();
    expect(screen.getByTestId("speaker-words")).toBeInTheDocument();
    expect(screen.getByTestId("host-guest-diff")).toBeInTheDocument();
    // All three charts default to confirmed source with 2 unfiltered rows
    expect(screen.getByTestId("speaker-minutes").textContent).toBe("2|confirmed");
    expect(screen.getByTestId("host-guest-diff").textContent).toBe("2|confirmed");
  });

  it("shows the 'Refresh pending' badge when is_stale is true", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ ...baseSnapshot, is_stale: true }),
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByText(/Refresh pending/i)).toBeInTheDocument()
    );
  });

  it("shows 'Never computed' when computed_at is null", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ ...baseSnapshot, computed_at: null }),
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByText("Never computed")).toBeInTheDocument()
    );
  });

  it("triggers refresh POST and shows 'Refreshing…' state", async () => {
    let resolveRefresh: (v: unknown) => void = () => {};
    (global.fetch as jest.Mock).mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") {
        return new Promise((res) => {
          resolveRefresh = res;
        });
      }
      return Promise.resolve({ ok: true, json: async () => baseSnapshot });
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /refresh meta-analysis/i })).toBeInTheDocument()
    );
    const btn = screen.getByRole("button", { name: /refresh meta-analysis/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByText(/Refreshing…/i)).toBeInTheDocument()
    );
    // Resolve the POST so the test cleanly tears down
    resolveRefresh({ ok: true, json: async () => baseSnapshot });
  });

  it("filters speaker rows by selected feed when FiltersBar fires", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => baseSnapshot,
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByTestId("speaker-minutes")).toBeInTheDocument()
    );
    expect(screen.getByTestId("speaker-minutes").textContent).toBe("2|confirmed");
    fireEvent.click(screen.getByTestId("filters-bar"));
    await waitFor(() =>
      expect(screen.getByTestId("speaker-minutes").textContent).toBe("1|confirmed")
    );
    expect(screen.getByTestId("host-guest-diff").textContent).toBe("1|confirmed");
  });

  it("changes the source tab and re-renders charts with the new source", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => baseSnapshot,
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByTestId("speaker-minutes").textContent).toBe("2|confirmed")
    );
    await user.click(screen.getByRole("tab", { name: /inferred — high/i }));
    await waitFor(() =>
      expect(screen.getByTestId("speaker-minutes").textContent).toBe("2|inferred_high")
    );
  });

  it("opens MissingSpeakersModal with fetched data when coverage strip is clicked", async () => {
    const missingPayload = { podcasts: [{ feedId: "feed-9", title: "Other" }] };
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("missing-speakers")) {
        return Promise.resolve({ ok: true, json: async () => missingPayload });
      }
      return Promise.resolve({ ok: true, json: async () => baseSnapshot });
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByTestId("coverage-strip")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("coverage-strip"));
    await waitFor(() =>
      expect(screen.getByTestId("missing-modal")).toBeInTheDocument()
    );
    expect(screen.getByTestId("missing-modal").textContent).toContain("feed-9");
  });

  it("openMissing falls back to empty list when the fetch fails", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("missing-speakers")) {
        return Promise.resolve({ ok: false, status: 500 });
      }
      return Promise.resolve({ ok: true, json: async () => baseSnapshot });
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByTestId("coverage-strip")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("coverage-strip"));
    await waitFor(() =>
      expect(screen.getByTestId("missing-modal")).toBeInTheDocument()
    );
    expect(screen.getByTestId("missing-modal").textContent).toContain('"podcasts":[]');
  });
});
