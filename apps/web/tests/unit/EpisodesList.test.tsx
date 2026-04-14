/**
 * @jest-environment jsdom
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

const mockEpisodes: EnrichedEpisode[] = [
  {
    id: "ep-1",
    title: "Test Episode 1",
    published_at: "2026-04-01T10:00:00.000Z",
    processed_at: "2026-04-01T11:00:00.000Z",
    duration_secs: 3600,
    language: "en",
    status: "done",
    has_diarization: true,
    diarization_error: null,
    error_class: null,
    error_message: null,
    retry_count: 0,
    retry_max: 3,
    transcribe_duration_secs: 120,
    diarize_duration_secs: 60,
    inference_provider_used: "fireworks",
    fireworks_audio_minutes: 60,
    fireworks_stt_cost_usd: 0.0123,
    speaker_count: 2,
    speaker_name_tags: [],
  },
  {
    id: "ep-2",
    title: "Test Episode 2",
    published_at: "2026-04-02T10:00:00.000Z",
    processed_at: null,
    duration_secs: 1800,
    language: "de",
    status: "done",
    has_diarization: true,
    diarization_error: null,
    error_class: null,
    error_message: null,
    retry_count: 0,
    retry_max: 3,
    transcribe_duration_secs: 90,
    diarize_duration_secs: 45,
    inference_provider_used: "local",
    fireworks_audio_minutes: null,
    fireworks_stt_cost_usd: null,
    speaker_count: 3,
    speaker_name_tags: [],
  },
];

describe("EpisodesList", () => {
  it("renders separate Transcribed: and Diarized: tags for done episodes", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Check for separate transcribe and diarize tags (should be 2 of each - one per episode)
    const transcribedTags = screen.getAllByText(/Transcribed:/);
    const diarizedTags = screen.getAllByText(/Diarized:/);
    expect(transcribedTags.length).toBe(2);
    expect(diarizedTags.length).toBe(2);

    // Ensure old combined "Processed in" tag is NOT present
    expect(screen.queryByText(/Processed in/)).not.toBeInTheDocument();
  });

  it("renders Fireworks STT cost tag with correct format when provider is fireworks", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Check for Fireworks STT tag with rounded to 2 decimals
    expect(screen.getByText(/Fireworks STT: \$0\.01/)).toBeInTheDocument();
  });

  it("does not render Fireworks STT cost tag when provider is not fireworks", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Should only show one Fireworks tag (for ep-1), not for ep-2
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
      {
        ...mockEpisodes[0],
        id: "ep-no-provider",
        inference_provider_used: null,
      },
    ];

    render(<EpisodesList episodes={episodesWithoutProvider} feedId="feed-1" />);
    expect(screen.getByText("Local inference")).toBeInTheDocument();
    expect(screen.queryByText("Remote inference")).not.toBeInTheDocument();
  });

  it("renders confirmed speakers in blue and non-confirmed speakers in orange", () => {
    const episodesWithSpeakerTags: EnrichedEpisode[] = [
      {
        ...mockEpisodes[0],
        speaker_name_tags: [
          { display_name: "Alice", inferred: false, confirmed_by_user: true },
          { display_name: "Bob", inferred: true, confirmed_by_user: false },
        ],
      },
    ];

    render(<EpisodesList episodes={episodesWithSpeakerTags} feedId="feed-1" />);

    expect(screen.getByText("Alice")).toHaveClass("bg-blue-100", "text-blue-800");
    expect(screen.getByText("Bob")).toHaveClass("bg-orange-100", "text-orange-800");
  });

  it("renders ReprocessButton in list rows for all episodes", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    const reprocessButtons = screen.getAllByTestId("reprocess-button");
    expect(reprocessButtons.length).toBe(2);

    // Verify both buttons are present (order depends on sorting, just check they exist)
    const episodeIds = reprocessButtons.map(btn => btn.getAttribute("data-episode-id"));
    expect(episodeIds).toContain("ep-1");
    expect(episodeIds).toContain("ep-2");
  });

  it("shows Fireworks STT Details tooltip on hover", () => {
    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    const fireworksTag = screen.getByText(/Fireworks STT: \$0\.01/);

    // Initially tooltip should not be visible
    expect(screen.queryByText(/Fireworks STT Details/)).not.toBeInTheDocument();

    // Hover over the tag
    fireEvent.mouseEnter(fireworksTag);

    // Tooltip should now be visible
    expect(screen.getByText(/Fireworks STT Details/)).toBeInTheDocument();
    expect(screen.getByText(/Audio:/)).toBeInTheDocument();
    expect(screen.getByText(/Cost:/)).toBeInTheDocument();
    expect(screen.getByText(/Rate:/)).toBeInTheDocument();

    // Leave hover
    fireEvent.mouseLeave(fireworksTag);

    // Tooltip should be hidden
    expect(screen.queryByText(/Fireworks STT Details/)).not.toBeInTheDocument();
  });

  it("does not render transcribe/diarize tags when duration is 0 or null", () => {
    const episodesWithZeroDuration: EnrichedEpisode[] = [
      {
        ...mockEpisodes[0],
        id: "ep-3",
        transcribe_duration_secs: 0,
        diarize_duration_secs: 0,
      },
    ];

    render(<EpisodesList episodes={episodesWithZeroDuration} feedId="feed-1" />);

    // Should not show transcribe/diarize tags when duration is 0
    expect(screen.queryByText(/Transcribed:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Diarized:/)).not.toBeInTheDocument();
  });

  it("filters episodes by title case-insensitively", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Search for "test" should match "Test Episode One"
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Should show only "Test Episode One"
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.queryByText("Another Episode")).not.toBeInTheDocument();
  });

  it("filters episodes by partial title match", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Search for "ep" should match both episodes
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "ep" } });

    // Should show both episodes
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();

    // Search for "one" should match only first episode
    fireEvent.change(searchInput, { target: { value: "one" } });
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.queryByText("Another Episode")).not.toBeInTheDocument();
  });

  it("shows empty state when no episodes match search", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Search for something that doesn't match
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "xyz" } });

    // Should show empty state message
    expect(screen.getByText("No episodes match your search")).toBeInTheDocument();
    expect(screen.queryByText("Test Episode One")).not.toBeInTheDocument();
  });

  it("clear button resets search and shows all episodes", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Search to filter
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Only first episode should be visible
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.queryByText("Another Episode")).not.toBeInTheDocument();

    // Click clear button
    const clearButton = screen.getByLabelText("Clear search");
    fireEvent.click(clearButton);

    // Both episodes should be visible again
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();
  });

  it("shows filtered count in stats bar", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Initially shows total count
    expect(screen.getByText(/2 episodes/)).toBeInTheDocument();

    // Search to filter
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Should show "Showing X of Y" format
    expect(screen.getByText(/Showing 1 of 2 episodes/)).toBeInTheDocument();
  });

  it("shows all episodes when search query is empty", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Both episodes visible initially
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();

    // Type and then clear
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });
    fireEvent.change(searchInput, { target: { value: "" } });

    // Both episodes should still be visible
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();
  });
});
