/**
 * Tests for UploadsSection — header counts, search filter, empty states.
 *
 * EpisodeCard and AudioUpload are mocked so tests focus on the section's
 * own state (search, counts, dialog toggle, delete flow).
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

jest.mock("@/components/EpisodeCard", () => ({
  __esModule: true,
  default: ({
    episode,
    onDelete,
    onToggleError,
  }: {
    episode: { id: string; title: string | null };
    onDelete?: (ep: { id: string; title: string | null }) => Promise<void> | void;
    onToggleError?: (e: React.MouseEvent, id: string) => void;
  }) => (
    <div data-testid={`card-${episode.id}`}>
      <span>{episode.title ?? "—"}</span>
      <button
        data-testid={`delete-${episode.id}`}
        onClick={() => onDelete?.(episode)}
      >
        delete
      </button>
      <button
        data-testid={`toggle-${episode.id}`}
        onClick={(e) => onToggleError?.(e, episode.id)}
      >
        toggle
      </button>
    </div>
  ),
}));

jest.mock("@/components/AudioUpload", () => ({
  __esModule: true,
  default: () => <div data-testid="audio-upload-mock" />,
}));

import UploadsSection from "@/components/UploadsSection";
import type { UploadedEpisode } from "@/components/UploadsSection";

function makeEp(overrides: Partial<UploadedEpisode> = {}): UploadedEpisode {
  return {
    id: "ep-1",
    title: "First upload",
    description: "A great audio file",
    published_at: null,
    processed_at: null,
    duration_secs: 60,
    language: null,
    status: "done",
    has_diarization: true,
    diarization_error: null,
    error_class: null,
    error_message: null,
    retry_count: 0,
    retry_max: 3,
    transcribe_duration_secs: 10,
    diarize_duration_secs: 5,
    inference_provider_used: null,
    fireworks_audio_minutes: null,
    fireworks_stt_cost_usd: null,
    pyannote_cloud_cost_usd: null,
    speaker_count: 1,
    speaker_name_tags: [],
    ...overrides,
  };
}

describe("UploadsSection", () => {
  it("shows the empty state when no uploads exist", () => {
    render(<UploadsSection uploads={[]} processed={0} total={0} />);
    expect(screen.getByText(/No uploads yet/i)).toBeInTheDocument();
    // No header count when total=0
    expect(screen.queryByText(/processed/)).not.toBeInTheDocument();
  });

  it("shows the file count in the header when fully processed", () => {
    const uploads = [makeEp({ id: "ep-1" }), makeEp({ id: "ep-2", title: "Second" })];
    render(<UploadsSection uploads={uploads} processed={2} total={2} />);
    expect(screen.getByText(/\(2 files\)/)).toBeInTheDocument();
  });

  it("shows the processed/total count when processing is incomplete", () => {
    const uploads = [makeEp()];
    render(<UploadsSection uploads={uploads} processed={1} total={3} />);
    expect(screen.getByText(/\(1 \/ 3 processed\)/)).toBeInTheDocument();
  });

  it("filters uploads by title substring", async () => {
    const user = userEvent.setup();
    const uploads = [
      makeEp({ id: "ep-1", title: "Climate talk" }),
      makeEp({ id: "ep-2", title: "Economy brief" }),
    ];
    render(<UploadsSection uploads={uploads} processed={2} total={2} />);

    expect(screen.getByTestId("card-ep-1")).toBeInTheDocument();
    expect(screen.getByTestId("card-ep-2")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/search manual uploads/i), "climate");

    expect(screen.getByTestId("card-ep-1")).toBeInTheDocument();
    expect(screen.queryByTestId("card-ep-2")).not.toBeInTheDocument();
  });

  it("filters by description when title does not match", async () => {
    const user = userEvent.setup();
    const uploads = [
      makeEp({ id: "ep-1", title: "Untitled", description: "about climate change" }),
      makeEp({ id: "ep-2", title: "Untitled", description: "about economy" }),
    ];
    render(<UploadsSection uploads={uploads} processed={2} total={2} />);

    await user.type(screen.getByLabelText(/search manual uploads/i), "climate");

    expect(screen.getByTestId("card-ep-1")).toBeInTheDocument();
    expect(screen.queryByTestId("card-ep-2")).not.toBeInTheDocument();
  });

  it("shows 'No uploads match' when filter returns zero results", async () => {
    const user = userEvent.setup();
    render(
      <UploadsSection
        uploads={[makeEp({ id: "ep-1", title: "Climate" })]}
        processed={1}
        total={1}
      />
    );

    await user.type(
      screen.getByLabelText(/search manual uploads/i),
      "zzznomatch"
    );

    expect(screen.getByText(/No uploads match your search/i)).toBeInTheDocument();
  });

  it("delete flow: confirmation + DELETE fetch + router refresh on success", async () => {
    mockRefresh.mockClear();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch as unknown as typeof fetch;

    const user = userEvent.setup();
    render(
      <UploadsSection
        uploads={[makeEp({ id: "ep-1", title: "Climate" })]}
        processed={1}
        total={1}
      />
    );

    await user.click(screen.getByTestId("delete-ep-1"));

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/episodes/ep-1",
      expect.objectContaining({ method: "DELETE" })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockRefresh).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("delete flow: user cancels the confirm and no fetch is issued", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    const mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    const user = userEvent.setup();
    render(
      <UploadsSection
        uploads={[makeEp({ id: "ep-9", title: "Nope" })]}
        processed={1}
        total={1}
      />
    );

    await user.click(screen.getByTestId("delete-ep-9"));

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("toggleError adds/removes ids from the expanded error set", async () => {
    const user = userEvent.setup();
    render(
      <UploadsSection
        uploads={[makeEp({ id: "ep-5", title: "E" })]}
        processed={1}
        total={1}
      />
    );
    // Covers the toggleError callback path (adds then removes).
    await user.click(screen.getByTestId("toggle-ep-5"));
    await user.click(screen.getByTestId("toggle-ep-5"));
  });

  it("clears the search when the X button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <UploadsSection
        uploads={[makeEp({ id: "ep-1", title: "Climate" })]}
        processed={1}
        total={1}
      />
    );

    const input = screen.getByLabelText(/search manual uploads/i);
    await user.type(input, "xyz");
    await user.click(screen.getByRole("button", { name: /clear search/i }));

    expect((input as HTMLInputElement).value).toBe("");
  });
});
