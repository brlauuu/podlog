/**
 * @jest-environment jsdom
 *
 * Search/filter interaction tests for <EpisodesList>.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock next/link
jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

// Mock ReprocessButton
jest.mock("@/components/ReprocessButton", () => {
  return ({ episodeId, status }: { episodeId: string; status: string }) => (
    <button data-testid="reprocess-button" data-episode-id={episodeId} data-status={status}>
      Reprocess
    </button>
  );
});

import EpisodesList, { EnrichedEpisode } from "@/components/EpisodesList";
import { makeEpisode } from "./EpisodesList.fixtures";

const twoEpisodes: EnrichedEpisode[] = [
  makeEpisode({ id: "ep-1", title: "Test Episode One" }),
  makeEpisode({
    id: "ep-2",
    title: "Another Episode",
    published_at: "2026-04-02T10:00:00.000Z",
    processed_at: null,
    duration_secs: 1800,
    language: "de",
    transcribe_duration_secs: 90,
    diarize_duration_secs: 45,
    inference_provider_used: "local",
    fireworks_audio_minutes: null,
    fireworks_stt_cost_usd: null,
    speaker_count: 3,
  }),
];

describe("EpisodesList — search / filter", () => {
  it("filters episodes by title case-insensitively", () => {
    render(<EpisodesList episodes={twoEpisodes} feedId="feed-1" />);

    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });

    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.queryByText("Another Episode")).not.toBeInTheDocument();
  });

  it("filters episodes by partial title match", () => {
    render(<EpisodesList episodes={twoEpisodes} feedId="feed-1" />);

    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "ep" } });

    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "one" } });
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.queryByText("Another Episode")).not.toBeInTheDocument();
  });

  it("shows empty state when no episodes match search", () => {
    render(<EpisodesList episodes={[twoEpisodes[0]]} feedId="feed-1" />);

    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "xyz" } });

    expect(screen.getByText("No episodes match your search")).toBeInTheDocument();
    expect(screen.queryByText("Test Episode One")).not.toBeInTheDocument();
  });

  it("clear button resets search and shows all episodes", () => {
    render(<EpisodesList episodes={twoEpisodes} feedId="feed-1" />);

    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });

    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.queryByText("Another Episode")).not.toBeInTheDocument();

    const clearButton = screen.getByLabelText("Clear search");
    fireEvent.click(clearButton);

    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();
  });

  it("shows filtered count in stats bar", () => {
    render(<EpisodesList episodes={twoEpisodes} feedId="feed-1" />);

    expect(screen.getByText(/2 episodes/)).toBeInTheDocument();

    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });

    expect(screen.getByText(/Showing 1 of 2 episodes/)).toBeInTheDocument();
  });

  it("shows all episodes when search query is empty", () => {
    render(<EpisodesList episodes={twoEpisodes} feedId="feed-1" />);

    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();

    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });
    fireEvent.change(searchInput, { target: { value: "" } });

    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();
  });
});
