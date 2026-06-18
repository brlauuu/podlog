/**
 * Tests for EpisodeCard's previously-uncovered branches (#822):
 * the ErrorPill HARD vs soft color choice, the PyannoteCloudCostTag
 * tooltip and "no cost" fallback, the ProcessingProgress step tracker,
 * and the delete-button click handler (preventDefault + stopPropagation
 * + onDelete invocation).
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

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

import EpisodeCard, { type EnrichedEpisode } from "@/components/EpisodeCard";

function _ep(overrides: Partial<EnrichedEpisode> = {}): EnrichedEpisode {
  return {
    id: "ep-1",
    title: "Sample Episode",
    published_at: "2026-06-01T10:00:00Z",
    processed_at: "2026-06-01T11:00:00Z",
    duration_secs: 1800,
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
    ...overrides,
  };
}

describe("EpisodeCard — ErrorPill color branches", () => {
  it("renders hard-error class with red palette", () => {
    render(
      <EpisodeCard
        episode={_ep({ status: "failed", error_class: "DISK_FULL",
                       error_message: "out of space" })}
        expandedError={false}
        onToggleError={() => {}}
      />
    );
    const pill = screen.getByText(/disk full/i);
    expect(pill.className).toMatch(/bg-red/);
  });

  it("renders non-hard error class with amber palette", () => {
    render(
      <EpisodeCard
        episode={_ep({ status: "failed", error_class: "TRANSIENT_NETWORK",
                       error_message: "blip" })}
        expandedError={false}
        onToggleError={() => {}}
      />
    );
    const pill = screen.getByText(/transient network/i);
    expect(pill.className).toMatch(/bg-amber/);
  });
});

describe("EpisodeCard — PyannoteCloudCostTag", () => {
  it("renders cost dollars when cost > 0", () => {
    render(
      <EpisodeCard
        episode={_ep({ pyannote_cloud_cost_usd: 0.45 })}
        expandedError={false}
        onToggleError={() => {}}
      />
    );
    expect(screen.getByText("pyannote cloud: $0.45")).toBeInTheDocument();
  });

  it("renders em-dash when cost is 0", () => {
    render(
      <EpisodeCard
        episode={_ep({ pyannote_cloud_cost_usd: 0 })}
        expandedError={false}
        onToggleError={() => {}}
      />
    );
    // Cost = 0 → label is "—"
    expect(screen.getByText("pyannote cloud: —")).toBeInTheDocument();
  });

  it("shows tooltip on mouse-enter and hides on mouse-leave", () => {
    render(
      <EpisodeCard
        episode={_ep({ pyannote_cloud_cost_usd: 0.12 })}
        expandedError={false}
        onToggleError={() => {}}
      />
    );
    const tag = screen.getByText("pyannote cloud: $0.12").parentElement!;
    fireEvent.mouseEnter(tag);
    // Tooltip text is visible after enter
    expect(screen.getByText(/precision-2/i)).toBeInTheDocument();
    fireEvent.mouseLeave(tag);
    expect(screen.queryByText(/precision-2/i)).not.toBeInTheDocument();
  });
});

describe("EpisodeCard — ProcessingProgress", () => {
  it("renders the step tracker for transcribing status", () => {
    const { container } = render(
      <EpisodeCard
        episode={_ep({ status: "transcribing" })}
        expandedError={false}
        onToggleError={() => {}}
      />
    );
    // Current step (◉) marker appears for active stage.
    expect(container.textContent).toContain("◉");
    // Earlier step (downloading) is marked completed with ✓.
    expect(container.textContent).toContain("✓");
  });

  it("renders nothing when status is not a processing step (e.g. done)", () => {
    const { container } = render(
      <EpisodeCard
        episode={_ep({ status: "done" })}
        expandedError={false}
        onToggleError={() => {}}
      />
    );
    // No step-tracker markers
    expect(container.textContent).not.toContain("◉");
  });
});

describe("EpisodeCard — delete button", () => {
  it("calls onDelete when clicked", async () => {
    const onDelete = jest.fn().mockResolvedValue(undefined);
    render(
      <EpisodeCard
        episode={_ep()}
        expandedError={false}
        onToggleError={() => {}}
        onDelete={onDelete}
      />
    );
    const deleteBtn = screen.getByRole("button", { name: /delete/i });
    fireEvent.click(deleteBtn);
    await Promise.resolve(); // flush async onDelete
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "ep-1" }));
  });

  it("is a no-op when onDelete is not provided", () => {
    render(
      <EpisodeCard
        episode={_ep()}
        expandedError={false}
        onToggleError={() => {}}
      />
    );
    // No delete button rendered without onDelete prop
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});

describe("EpisodeCard — error details toggle", () => {
  it("toggle button calls onToggleError with episode id", () => {
    const onToggleError = jest.fn();
    render(
      <EpisodeCard
        episode={_ep({ status: "failed", error_class: "TRANSIENT_NETWORK",
                       error_message: "blip" })}
        expandedError={false}
        onToggleError={onToggleError}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /show details/i }));
    expect(onToggleError).toHaveBeenCalledWith(expect.any(Object), "ep-1");
  });

  it("renders 'Hide details' label and the error message when expanded", () => {
    render(
      <EpisodeCard
        episode={_ep({ status: "failed", error_class: "TRANSIENT_NETWORK",
                       error_message: "an explanatory error message" })}
        expandedError={true}
        onToggleError={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /hide details/i })).toBeInTheDocument();
    expect(screen.getByText("an explanatory error message")).toBeInTheDocument();
  });
});
