/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockQuery = jest.fn();

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("notFound");
  }),
}));

jest.mock("@/components/EpisodeDescription", () => () => <div data-testid="episode-description" />);
jest.mock("@/components/TranscriptSection", () => () => <div data-testid="transcript-section" />);
jest.mock("@/components/BackToSearchLink", () => () => <div data-testid="back-to-search" />);
jest.mock("@/components/ReprocessButton", () => () => <div data-testid="reprocess-button" />);
jest.mock("@/components/EpisodeChat", () => () => <div data-testid="episode-chat" />);

import EpisodePage from "@/app/episodes/[id]/page";

const currentEpisode = {
  id: "ep-current",
  title: "Current episode",
  description: "desc",
  published_at: null,
  duration_secs: 120,
  status: "done",
  error_class: null,
  error_message: null,
  has_diarization: true,
  diarization_error: null,
  inference_error: null,
  transcribe_duration_secs: null,
  diarize_duration_secs: null,
  diarize_step_durations: null,
  inference_provider_used: null,
  fireworks_audio_secs: null,
  fireworks_audio_minutes: null,
  fireworks_stt_cost_per_minute_usd: null,
  fireworks_stt_cost_usd: null,
  audio_url: null,
  audio_local_path: null,
  guid: null,
  feed_id: "feed-1",
  feed_title: "Feed One",
  feed_description: null,
  feed_image_url: null,
  feed_website_url: null,
  created_at: "2026-04-01T10:00:00.000Z",
  feed_url: null,
};

describe("Episode page navigation", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("queries adjacent episodes within the same feed using published_at fallback to created_at", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) });

    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("status = 'done'"),
      ["2026-04-01T10:00:00.000Z", "feed-1", "ep-current"]
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("COALESCE(published_at, created_at)"),
      ["2026-04-01T10:00:00.000Z", "feed-1", "ep-current"]
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("status = 'done'"),
      ["2026-04-01T10:00:00.000Z", "feed-1", "ep-current"]
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("COALESCE(published_at, created_at)"),
      ["2026-04-01T10:00:00.000Z", "feed-1", "ep-current"]
    );
  });

  it("renders only the available navigation link for a boundary episode", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-next", title: "Next episode" }] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    expect(screen.queryByRole("link", { name: "Current episode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /previous episode/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /next episode/i })).toHaveAttribute(
      "href",
      "/episodes/ep-next"
    );
  });

  it("renders episode navigation above transcript content", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-prev", title: "Previous episode" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-next", title: "Next episode" }] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    const prevLink = screen.getByRole("link", { name: /previous episode/i });
    const transcript = screen.getByTestId("transcript-section");

    expect(prevLink.compareDocumentPosition(transcript) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders diarization step timing details when available", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            ...currentEpisode,
            transcribe_duration_secs: 120,
            diarize_duration_secs: 60,
            diarize_step_durations: {
              provider_diarization_secs: 42,
              alignment_io_secs: 5,
              speaker_assignment_secs: 13,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    expect(screen.getByText(/Diarization steps:/i)).toBeInTheDocument();
    expect(screen.getByText(/Provider diarization/i)).toBeInTheDocument();
    expect(screen.getByText(/Speaker assignment/i)).toBeInTheDocument();
  });

  it("renders previous and next as button-style links with flex layout", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-prev", title: "Previous episode title" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-next", title: "Next episode title" }] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    const prevLink = screen.getByRole("link", { name: /previous episode title/i });
    const nextLink = screen.getByRole("link", { name: /next episode title/i });

    // Both links should have button-style classes
    expect(prevLink).toHaveClass("rounded-lg", "border", "border-input", "bg-background");
    expect(nextLink).toHaveClass("rounded-lg", "border", "border-input", "bg-background");

    // Both should have flex-1 when both present
    expect(prevLink).toHaveClass("flex-1");
    expect(nextLink).toHaveClass("flex-1");
  });

  it("renders only previous button at natural width when no next episode", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-prev", title: "Previous episode" }] })
      .mockResolvedValueOnce({ rows: [] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    const prevLink = screen.getByRole("link", { name: /previous episode/i });
    expect(prevLink).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /next episode/i })).not.toBeInTheDocument();

    // Should NOT have flex-1 when alone
    expect(prevLink).not.toHaveClass("flex-1");
  });

  it("renders only next button at natural width when no previous episode", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-next", title: "Next episode" }] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    const nextLink = screen.getByRole("link", { name: /next episode/i });
    expect(nextLink).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /previous episode/i })).not.toBeInTheDocument();

    // Should NOT have flex-1 when alone
    expect(nextLink).not.toHaveClass("flex-1");
  });

  it("truncates long episode titles in single-button layout", async () => {
    const longTitle = "This is a very long episode title that should be truncated with ellipsis when rendered in the navigation button";
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-next", title: longTitle }] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    const nextLink = screen.getByRole("link", { name: new RegExp(longTitle.substring(0, 20)) });
    expect(nextLink).toBeInTheDocument();

    // Should have min-w-0 for proper truncation context
    expect(nextLink).toHaveClass("min-w-0");

    // Should NOT have max-w-[50%] when single button
    expect(nextLink).not.toHaveClass("max-w-[50%]");

    // Title span should have truncation classes
    const titleSpan = nextLink.querySelector("span.truncate");
    expect(titleSpan).toHaveClass("flex-1", "min-w-0", "truncate");
  });
});
