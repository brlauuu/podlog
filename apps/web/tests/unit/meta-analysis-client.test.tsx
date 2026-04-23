import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MetaAnalysisClient from "@/app/meta-analysis/MetaAnalysisClient";

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

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
});
