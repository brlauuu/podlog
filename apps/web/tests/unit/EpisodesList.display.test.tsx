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

  // #1092: only episodes transcribed remotely before the removal carry a
  // provenance tag; a local episode needs none.
  it("tags only the remotely transcribed episode", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    const remote = screen.getByText("Transcribed remotely");
    expect(remote).toHaveClass("bg-violet-100", "text-violet-800");
    expect(screen.getAllByText("Transcribed remotely")).toHaveLength(1);
    expect(screen.queryByText(/Local inference|Remote inference/)).toBeNull();
  });

  it("renders no provenance tag when the provider is missing", () => {
    const episodesWithoutProvider: EnrichedEpisode[] = [
      makeEpisode({ id: "ep-no-provider", inference_provider_used: null }),
    ];

    render(<EpisodesList episodes={episodesWithoutProvider} feedId="feed-1" />);
    expect(screen.queryByText("Transcribed remotely")).not.toBeInTheDocument();
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

  it("does not render transcribe/diarize tags when duration is 0 or null", () => {
    const episodesWithZeroDuration: EnrichedEpisode[] = [
      makeEpisode({ id: "ep-3", transcribe_duration_secs: 0, diarize_duration_secs: 0 }),
    ];

    render(<EpisodesList episodes={episodesWithZeroDuration} feedId="feed-1" />);

    expect(screen.queryByText(/Transcribed:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Diarized:/)).not.toBeInTheDocument();
  });
});
