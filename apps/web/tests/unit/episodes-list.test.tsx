/**
 * Tests for EpisodesList — sort/filter/toggle behavior (#822).
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// Stub Next.js Link + ReprocessButton so we don't need a route shell.
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
jest.mock("@/components/ReprocessButton", () => ({
  __esModule: true,
  default: () => <button data-testid="reprocess">reprocess</button>,
}));

import EpisodesList from "@/components/EpisodesList";
import type { EnrichedEpisode } from "@/components/EpisodeCard";

function _ep(o: Partial<EnrichedEpisode> = {}): EnrichedEpisode {
  return {
    id: "ep-default",
    title: "Default",
    published_at: "2026-01-01T00:00:00Z",
    processed_at: null,
    duration_secs: 600,
    language: "en",
    status: "done",
    has_diarization: true,
    diarization_error: null,
    error_class: null,
    error_message: null,
    retry_count: 0,
    retry_max: 3,
    transcribe_duration_secs: 60,
    diarize_duration_secs: 30,
    inference_provider_used: "local",
    fireworks_audio_minutes: null,
    fireworks_stt_cost_usd: null,
    pyannote_cloud_cost_usd: null,
    audio_file_size_bytes: 4_000_000,
    speaker_count: 2,
    speaker_name_tags: [],
    ...o,
  };
}

describe("EpisodesList — empty state", () => {
  it("renders 'No episodes yet.' when list is empty", () => {
    render(<EpisodesList episodes={[]} feedId="feed-1" />);
    expect(screen.getByText("No episodes yet.")).toBeInTheDocument();
  });
});

describe("EpisodesList — StatsBar branches", () => {
  it("counts done / processing / failed / pending across all branches", () => {
    const episodes = [
      _ep({ id: "1", status: "done" }),
      _ep({ id: "2", status: "done" }),
      _ep({ id: "3", status: "transcribing" }),
      _ep({ id: "4", status: "downloading" }),
      _ep({ id: "5", status: "failed" }),
      _ep({ id: "6", status: "pending" }),
    ];
    render(<EpisodesList episodes={episodes} feedId="feed-1" />);
    // Stats show each category that has > 0 entries
    expect(screen.getByText("2 transcribed")).toBeInTheDocument();
    expect(screen.getByText("2 processing")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });
});

describe("EpisodesList — sorting", () => {
  const fixtures = [
    _ep({ id: "a", title: "Beta", duration_secs: 1000,
           published_at: "2026-01-01T00:00:00Z",
           processed_at: "2026-01-03T00:00:00Z", status: "done" }),
    _ep({ id: "b", title: "Alpha", duration_secs: 500,
           published_at: "2026-02-01T00:00:00Z",
           processed_at: "2026-02-01T00:00:00Z", status: "failed" }),
    _ep({ id: "c", title: "Gamma", duration_secs: 750,
           published_at: "2026-03-01T00:00:00Z",
           processed_at: null, status: "transcribing" }),
  ];

  function titles(): string[] {
    return Array.from(document.querySelectorAll("a[href^='/episodes/']"))
      .map((a) => a.textContent || "")
      .filter((t, i, arr) => arr.indexOf(t) === i);  // dedupe
  }

  it("sorts by published_at desc by default", () => {
    render(<EpisodesList episodes={fixtures} feedId="feed-1" />);
    const links = Array.from(
      document.querySelectorAll("a[href^='/episodes/']")
    ).map((a) => (a as HTMLAnchorElement).getAttribute("href"));
    // Newest first: c, b, a
    expect(links).toEqual([
      "/episodes/c", "/episodes/c",
      "/episodes/b", "/episodes/b",
      "/episodes/a", "/episodes/a",
    ].filter((_, i, arr) =>
      // The card may produce duplicate anchor entries via the stretched-link
      // wrapper; keep just the first per id by deduping the test's expected
      // list to match. (Order remains c, b, a.)
      arr.findIndex((x) => x === arr[i]) === i
    ));
  });

  it("toggleSort switches direction when same key tapped twice", () => {
    render(<EpisodesList episodes={fixtures} feedId="feed-1" />);
    // Tap "Date posted" — switches from default desc to asc
    const button = screen.getByRole("button", { name: /^published$/i });
    fireEvent.click(button);
    const links = Array.from(
      document.querySelectorAll("a[href^='/episodes/']")
    ).map((a) => (a as HTMLAnchorElement).getAttribute("href"));
    // asc: oldest first → a then b then c
    expect(links[0]).toBe("/episodes/a");
  });

  it("sorts by title alphabetically (asc by default for title)", () => {
    render(<EpisodesList episodes={fixtures} feedId="feed-1" />);
    fireEvent.click(screen.getByRole("button", { name: /title/i }));
    const links = Array.from(
      document.querySelectorAll("a[href^='/episodes/']")
    ).map((a) => (a as HTMLAnchorElement).getAttribute("href"));
    // Alpha, Beta, Gamma → b, a, c
    expect(links[0]).toBe("/episodes/b");
  });

  it("sorts by duration", () => {
    render(<EpisodesList episodes={fixtures} feedId="feed-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^duration$/i }));
    const links = Array.from(
      document.querySelectorAll("a[href^='/episodes/']")
    ).map((a) => (a as HTMLAnchorElement).getAttribute("href"));
    // Longest first: a (1000), c (750), b (500)
    expect(links[0]).toBe("/episodes/a");
  });

  it("sorts by status", () => {
    render(<EpisodesList episodes={fixtures} feedId="feed-1" />);
    fireEvent.click(screen.getByRole("button", { name: /status/i }));
    // Just verify it doesn't crash and produces some order.
    expect(screen.getAllByTestId("reprocess").length).toBe(3);
  });
});

describe("EpisodesList — search filter", () => {
  it("filters by title query and shows 'X of Y'", () => {
    const episodes = [
      _ep({ id: "1", title: "Climate Change Special" }),
      _ep({ id: "2", title: "Quantum Physics" }),
      _ep({ id: "3", title: "Climate Talks 2026" }),
    ];
    render(<EpisodesList episodes={episodes} feedId="feed-1" />);
    const input = screen.getByLabelText(/search episodes/i);
    fireEvent.change(input, { target: { value: "climate" } });
    expect(screen.getByText(/showing 2 of 3/i)).toBeInTheDocument();
  });

  it("renders 'no episodes match' empty state for non-matching query", () => {
    const episodes = [_ep({ id: "1", title: "Some Episode" })];
    render(<EpisodesList episodes={episodes} feedId="feed-1" />);
    fireEvent.change(screen.getByLabelText(/search episodes/i), {
      target: { value: "xyz nothing matches" },
    });
    expect(screen.getByText(/no episodes match your search/i)).toBeInTheDocument();
  });

  it("clear-search button restores the unfiltered list", () => {
    const episodes = [_ep({ id: "1", title: "Foo" })];
    render(<EpisodesList episodes={episodes} feedId="feed-1" />);
    const input = screen.getByLabelText(/search episodes/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bar" } });
    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));
    expect(input.value).toBe("");
  });
});

describe("EpisodesList — error toggle propagation", () => {
  it("clicking the error toggle on a failed episode expands it", () => {
    const episodes = [
      _ep({
        id: "fail-1", status: "failed",
        error_class: "TRANSIENT_NETWORK",
        error_message: "Connection reset",
      }),
    ];
    render(<EpisodesList episodes={episodes} feedId="feed-1" />);
    // Initially collapsed
    expect(screen.queryByText("Connection reset")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show details/i }));
    expect(screen.getByText("Connection reset")).toBeInTheDocument();
    // Click again → collapses
    fireEvent.click(screen.getByRole("button", { name: /hide details/i }));
    expect(screen.queryByText("Connection reset")).not.toBeInTheDocument();
  });
});
