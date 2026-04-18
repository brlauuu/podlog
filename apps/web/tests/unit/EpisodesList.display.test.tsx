/**
 * @jest-environment jsdom
 *
 * Display-level tests for <EpisodesList>: tags, badges, tooltip, inference
 * provider rendering, reprocess button wiring.
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
import { makeEpisode, mockEpisodes } from "./EpisodesList.fixtures";

describe("EpisodesList — display", () => {
  it("renders separate Transcribed: and Diarized: tags for done episodes", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    const transcribedTags = screen.getAllByText(/Transcribed:/);
    const diarizedTags = screen.getAllByText(/Diarized:/);
    expect(transcribedTags.length).toBe(2);
    expect(diarizedTags.length).toBe(2);

    // Ensure old combined "Processed in" tag is NOT present
    expect(screen.queryByText(/Processed in/)).not.toBeInTheDocument();
  });

  it("renders Fireworks STT cost tag with correct format when provider is fireworks", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);
    expect(screen.getByText(/Fireworks STT: \$0\.01/)).toBeInTheDocument();
  });

  it("does not render Fireworks STT cost tag when provider is not fireworks", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Only ep-1 is fireworks; ep-2 is local → exactly one tag
    const fireworksTags = screen.getAllByText(/Fireworks STT/);
    expect(fireworksTags.length).toBe(1);
  });

  it("renders local/remote inference tags with updated labels", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    const remote = screen.getByText("Remote inference");
    const local = screen.getByText("Local inference");

    expect(remote).toBeInTheDocument();
    expect(local).toBeInTheDocument();
    expect(remote).toHaveClass("bg-violet-100", "text-violet-800");
    expect(local).toHaveClass("bg-teal-100", "text-teal-800");
  });

  it("renders local inference tag when provider is missing", () => {
    const episodesWithoutProvider: EnrichedEpisode[] = [
      makeEpisode({ id: "ep-no-provider", inference_provider_used: null }),
    ];

    render(<EpisodesList episodes={episodesWithoutProvider} feedId="feed-1" />);
    expect(screen.getByText("Local inference")).toBeInTheDocument();
    expect(screen.queryByText("Remote inference")).not.toBeInTheDocument();
  });

  it("renders confirmed speakers in blue and non-confirmed speakers in orange", () => {
    const episodesWithSpeakerTags: EnrichedEpisode[] = [
      makeEpisode({
        speaker_name_tags: [
          { display_name: "Alice", inferred: false, confirmed_by_user: true },
          { display_name: "Bob", inferred: true, confirmed_by_user: false },
        ],
      }),
    ];

    render(<EpisodesList episodes={episodesWithSpeakerTags} feedId="feed-1" />);

    expect(screen.getByText("Alice")).toHaveClass("bg-blue-100", "text-blue-800");
    expect(screen.getByText("Bob")).toHaveClass("bg-orange-100", "text-orange-800");
  });

  it("renders ReprocessButton in list rows for all episodes", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    const reprocessButtons = screen.getAllByTestId("reprocess-button");
    expect(reprocessButtons.length).toBe(2);

    const episodeIds = reprocessButtons.map((btn) => btn.getAttribute("data-episode-id"));
    expect(episodeIds).toContain("ep-1");
    expect(episodeIds).toContain("ep-2");
  });

  it("shows Fireworks STT Details tooltip on hover", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    const fireworksTag = screen.getByText(/Fireworks STT: \$0\.01/);

    expect(screen.queryByText(/Fireworks STT Details/)).not.toBeInTheDocument();

    fireEvent.mouseEnter(fireworksTag);

    expect(screen.getByText(/Fireworks STT Details/)).toBeInTheDocument();
    expect(screen.getByText(/Audio:/)).toBeInTheDocument();
    expect(screen.getByText(/Cost:/)).toBeInTheDocument();
    expect(screen.getByText(/Rate:/)).toBeInTheDocument();

    fireEvent.mouseLeave(fireworksTag);

    expect(screen.queryByText(/Fireworks STT Details/)).not.toBeInTheDocument();
  });

  it("does not render transcribe/diarize tags when duration is 0 or null", () => {
    const episodesWithZeroDuration: EnrichedEpisode[] = [
      makeEpisode({ id: "ep-3", transcribe_duration_secs: 0, diarize_duration_secs: 0 }),
    ];

    render(<EpisodesList episodes={episodesWithZeroDuration} feedId="feed-1" />);

    expect(screen.queryByText(/Transcribed:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Diarized:/)).not.toBeInTheDocument();
  });
});
