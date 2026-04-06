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
      expect.stringContaining("COALESCE(published_at, created_at)"),
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
});
