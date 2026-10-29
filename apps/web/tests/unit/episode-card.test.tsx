/**
 * Tests for EpisodeCard's previously-uncovered branches (#822):
 * the ErrorPill HARD vs soft color choice, the ProcessingProgress step tracker,
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

// #1098: speaker_names rows with role='other' carry an empty display_name by
// design (#703), and one person can be named on two speaker labels. The card
// used to key tags on display_name, so both cases collided (React duplicate-key
// errors) and the blank rows rendered as empty tags.
describe("EpisodeCard — speaker name tags (#1098)", () => {
  const tag = (display_name: string, confirmed_by_user = false) => ({
    display_name,
    inferred: !confirmed_by_user,
    confirmed_by_user,
  });

  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  function keyWarnings() {
    return consoleError.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && a.includes("same key")),
    );
  }

  it("drops blank names and shows a repeated name once, without key warnings", () => {
    const { container } = render(
      <EpisodeCard
        episode={_ep({
          speaker_name_tags: [tag(""), tag(""), tag("  "), tag("Ana"), tag("Ana"), tag("Ben")],
        })}
        expandedError={false}
        onToggleError={() => {}}
      />,
    );
    expect(screen.getAllByText("Ana")).toHaveLength(1);
    expect(screen.getAllByText("Ben")).toHaveLength(1);
    const tagRow = screen.getByText("Ana").parentElement!;
    expect(tagRow.children).toHaveLength(2);
    expect(keyWarnings()).toEqual([]);
    expect(container.textContent).not.toContain("2 speakers");
  });

  it("marks a repeated name confirmed when any of its rows is confirmed", () => {
    render(
      <EpisodeCard
        episode={_ep({ speaker_name_tags: [tag("Ana"), tag("Ana", true)] })}
        expandedError={false}
        onToggleError={() => {}}
      />,
    );
    expect(screen.getByText("Ana").className).toContain("bg-blue-100");
  });

  it("falls back to the speaker count when every name is blank", () => {
    render(
      <EpisodeCard
        episode={_ep({ speaker_count: 3, speaker_name_tags: [tag(""), tag("")] })}
        expandedError={false}
        onToggleError={() => {}}
      />,
    );
    expect(screen.getByText("3 speakers")).toBeInTheDocument();
    expect(keyWarnings()).toEqual([]);
  });
});
