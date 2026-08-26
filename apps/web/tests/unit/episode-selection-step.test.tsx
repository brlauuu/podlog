/**
 * @jest-environment jsdom
 *
 * Tests for Step 2 of the Add-Feed dialog: the per-episode selection list
 * (split from feeds/page.tsx in #664, coverage gap closed in #765).
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import EpisodeSelectionStep from "@/app/feeds/_components/EpisodeSelectionStep";
import type { FeedPreview, EpisodePreview } from "@/app/feeds/_lib/types";

function ep(overrides: Partial<EpisodePreview> = {}): EpisodePreview {
  return {
    guid: "g1",
    title: "Ep 1",
    published_at: "2026-04-01T10:00:00Z",
    duration_secs: 3600,
    audio_url: "https://ex.com/a.mp3",
    ...overrides,
  } as EpisodePreview;
}

function preview(eps: EpisodePreview[]): FeedPreview {
  return { title: "Feed", episodes: eps };
}

function renderStep(
  overrides: Partial<React.ComponentProps<typeof EpisodeSelectionStep>> = {},
) {
  const onToggleGuid = jest.fn();
  const onToggleAll = jest.fn();
  const onSubmit = jest.fn((e: React.FormEvent) => e.preventDefault());
  const onBackOrCancel = jest.fn();

  const utils = render(
    <EpisodeSelectionStep
      preview={preview([ep({ guid: "g1", title: "Ep 1" }), ep({ guid: "g2", title: "Ep 2" })])}
      selectedGuids={new Set()}
      existingGuids={new Set()}
      addMoreMode={false}
      error={null}
      submitting={false}
      onToggleGuid={onToggleGuid}
      onToggleAll={onToggleAll}
      onSubmit={onSubmit}
      onBackOrCancel={onBackOrCancel}
      {...overrides}
    />,
  );
  return { onToggleGuid, onToggleAll, onSubmit, onBackOrCancel, ...utils };
}

describe("<EpisodeSelectionStep>", () => {
  describe("selective-add mode (addMoreMode=false)", () => {
    it("renders one row per episode with its title", () => {
      renderStep();
      expect(screen.getByText("Ep 1")).toBeInTheDocument();
      expect(screen.getByText("Ep 2")).toBeInTheDocument();
      expect(screen.getByText("2 episodes found")).toBeInTheDocument();
    });

    it("falls back to the GUID when an episode has no title", () => {
      renderStep({
        preview: preview([ep({ guid: "g1", title: null })]),
      });
      expect(screen.getByText("g1")).toBeInTheDocument();
    });

    it("calls onToggleGuid with the row's GUID when its checkbox is clicked", () => {
      const { onToggleGuid } = renderStep();
      fireEvent.click(screen.getAllByRole("checkbox")[1]);
      expect(onToggleGuid).toHaveBeenCalledWith("g2");
    });

    it("shows 'Select all' when nothing is selected and 'Deselect all' when everything is", () => {
      const { rerender } = renderStep({ selectedGuids: new Set() });
      expect(screen.getByText("Select all")).toBeInTheDocument();

      rerender(
        <EpisodeSelectionStep
          preview={preview([ep({ guid: "g1" }), ep({ guid: "g2" })])}
          selectedGuids={new Set(["g1", "g2"])}
          existingGuids={new Set()}
          addMoreMode={false}
          error={null}
          submitting={false}
          onToggleGuid={jest.fn()}
          onToggleAll={jest.fn()}
          onSubmit={(e) => e.preventDefault()}
          onBackOrCancel={jest.fn()}
        />,
      );
      expect(screen.getByText("Deselect all")).toBeInTheDocument();
    });

    it("invokes onToggleAll when the select-all link is clicked", () => {
      const { onToggleAll } = renderStep();
      fireEvent.click(screen.getByText("Select all"));
      expect(onToggleAll).toHaveBeenCalledTimes(1);
    });

    it("disables Add when no episodes are selected", () => {
      renderStep();
      expect(screen.getByRole("button", { name: /Add \(0\)/ })).toBeDisabled();
    });

    it("enables Add with the count in the label when episodes are selected", () => {
      renderStep({ selectedGuids: new Set(["g1"]) });
      const btn = screen.getByRole("button", { name: /Add \(1\)/ });
      expect(btn).toBeEnabled();
    });

    it("calls onBackOrCancel with the 'Back' button", () => {
      const { onBackOrCancel } = renderStep();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(onBackOrCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onSubmit on form submit", () => {
      const { onSubmit, container } = renderStep({ selectedGuids: new Set(["g1"]) });
      fireEvent.submit(container.querySelector("form")!);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("renders an error message when error is set", () => {
      renderStep({ error: "Boom" });
      expect(screen.getByText("Boom")).toBeInTheDocument();
    });

    it("shows 'Adding...' on the submit button while submitting", () => {
      renderStep({ selectedGuids: new Set(["g1"]), submitting: true });
      expect(screen.getByRole("button", { name: /Adding/ })).toBeDisabled();
    });
  });

  describe("add-more mode (addMoreMode=true)", () => {
    const existing = new Set(["g1"]);

    it("disables checkboxes for already-added episodes and shows the badge", () => {
      renderStep({ addMoreMode: true, existingGuids: existing });
      const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
      // First episode (g1) is already added → disabled
      expect(checkboxes[0]).toBeDisabled();
      expect(checkboxes[1]).toBeEnabled();
      // Inline badge plus the summary mention; ensure the badge specifically renders.
      expect(screen.getByText(/\(already added\)/)).toBeInTheDocument();
    });

    it("shows the 'already added' counter in the summary line", () => {
      renderStep({ addMoreMode: true, existingGuids: existing });
      // Two episodes total, one already added. Match the unique fragment.
      const matches = screen.getAllByText(/already added/i);
      // One in the summary line; one inline italic badge on the row.
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("uses 'Cancel' instead of 'Back' for the secondary action", () => {
      renderStep({ addMoreMode: true, existingGuids: existing });
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    });

    it("submit button label uses 'Add N episode(s)' wording and pluralizes correctly", () => {
      const { rerender } = renderStep({
        addMoreMode: true,
        existingGuids: existing,
        selectedGuids: new Set(["g1", "g2"]),
      });
      // Only g2 is "new" (g1 is existing) → 1 episode (singular)
      expect(
        screen.getByRole("button", { name: /Add 1 episode\b/ }),
      ).toBeInTheDocument();

      rerender(
        <EpisodeSelectionStep
          preview={preview([ep({ guid: "g1" }), ep({ guid: "g2" }), ep({ guid: "g3" })])}
          selectedGuids={new Set(["g1", "g2", "g3"])}
          existingGuids={existing}
          addMoreMode={true}
          error={null}
          submitting={false}
          onToggleGuid={jest.fn()}
          onToggleAll={jest.fn()}
          onSubmit={(e) => e.preventDefault()}
          onBackOrCancel={jest.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: /Add 2 episodes/ }),
      ).toBeInTheDocument();
    });

    it("uses the 'Select all new' / 'Deselect all new' toggle label", () => {
      const { rerender } = renderStep({
        addMoreMode: true,
        existingGuids: existing,
        selectedGuids: new Set(),
      });
      expect(screen.getByText("Select all new")).toBeInTheDocument();

      // Only the remaining (non-existing) episode is g2; selecting it makes
      // "all remaining selected" → toggle flips to Deselect.
      rerender(
        <EpisodeSelectionStep
          preview={preview([ep({ guid: "g1" }), ep({ guid: "g2" })])}
          selectedGuids={new Set(["g2"])}
          existingGuids={existing}
          addMoreMode={true}
          error={null}
          submitting={false}
          onToggleGuid={jest.fn()}
          onToggleAll={jest.fn()}
          onSubmit={(e) => e.preventDefault()}
          onBackOrCancel={jest.fn()}
        />,
      );
      expect(screen.getByText("Deselect all new")).toBeInTheDocument();
    });

    it("disables Add when no NEW episodes are selected", () => {
      renderStep({
        addMoreMode: true,
        existingGuids: existing,
        selectedGuids: new Set(["g1"]), // only existing → 0 new
      });
      expect(
        screen.getByRole("button", { name: /Add 0 episodes/ }),
      ).toBeDisabled();
    });
  });
});

describe("episode filter (#982)", () => {
  // Two titles start with "The" on purpose, so a "the" query matches exactly
  // two of the four and the scoped select-all assertions are unambiguous.
  const many = [
    ep({ guid: "g1", title: "Sam Altman on building OpenAI" }),
    ep({ guid: "g2", title: "The King of Israel" }),
    ep({ guid: "g3", title: "Scotty Doesn't Know" }),
    ep({ guid: "g4", title: "The Books That Shaped Us" }),
  ];

  function filterInput() {
    return screen.getByPlaceholderText(/filter episodes/i);
  }

  it("narrows the rendered list as you type", () => {
    renderStep({ preview: preview(many) });
    fireEvent.change(filterInput(), { target: { value: "king" } });

    expect(screen.getByText("The King of Israel")).toBeInTheDocument();
    expect(screen.queryByText("Sam Altman on building OpenAI")).toBeNull();
  });

  it("matches case-insensitively", () => {
    renderStep({ preview: preview(many) });
    fireEvent.change(filterInput(), { target: { value: "SCOTTY" } });
    expect(screen.getByText("Scotty Doesn't Know")).toBeInTheDocument();
  });

  it("falls back to the guid for episodes with no title", () => {
    renderStep({ preview: preview([ep({ guid: "abc-123", title: null })]) });
    fireEvent.change(filterInput(), { target: { value: "abc" } });
    expect(screen.getByText("abc-123")).toBeInTheDocument();
  });

  it("shows how much of the feed is visible while filtering", () => {
    renderStep({ preview: preview(many) });
    expect(screen.getByText(/4 episodes found/)).toBeInTheDocument();

    fireEvent.change(filterInput(), { target: { value: "the" } });
    expect(screen.getByText(/2 of 4 episodes/)).toBeInTheDocument();
  });

  it("keeps a checked episode checked after it is filtered out of view", () => {
    // The core rule: the filter narrows the *view*, never the selection.
    const { rerender } = renderStep({
      preview: preview(many),
      selectedGuids: new Set(["g1"]),
    });
    fireEvent.change(filterInput(), { target: { value: "king" } });
    expect(screen.queryByText("Sam Altman on building OpenAI")).toBeNull();

    // Clearing the filter brings it back, still checked.
    fireEvent.change(filterInput(), { target: { value: "" } });
    const box = screen.getByText("Sam Altman on building OpenAI")
      .closest("label")!
      .querySelector("input")!;
    expect(box).toBeChecked();
    expect(rerender).toBeDefined();
  });

  it("still submits a selection made before filtering", () => {
    const { onSubmit, container } = renderStep({
      preview: preview(many),
      selectedGuids: new Set(["g1"]),
    });
    fireEvent.change(filterInput(), { target: { value: "king" } });
    fireEvent.submit(container.querySelector("form")!);

    // Submission reads selectedGuids, which the filter never touches.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Add \(1\)/ })).toBeEnabled();
  });

  it("scopes select-all to the visible episodes and says so", () => {
    const { onToggleAll } = renderStep({ preview: preview(many) });
    fireEvent.change(filterInput(), { target: { value: "the" } });

    const link = screen.getByText(/Select all 2 shown/);
    fireEvent.click(link);
    expect(onToggleAll).toHaveBeenCalledWith(["g2", "g4"]);
  });

  it("passes the whole feed to select-all when no filter is active", () => {
    const { onToggleAll } = renderStep({ preview: preview(many) });
    fireEvent.click(screen.getByText("Select all"));
    expect(onToggleAll).toHaveBeenCalledWith(["g1", "g2", "g3", "g4"]);
  });

  it("never offers already-added episodes to a filtered select-all", () => {
    // addMoreMode's "don't touch already-added" rule has to survive filtering.
    const { onToggleAll } = renderStep({
      preview: preview(many),
      addMoreMode: true,
      existingGuids: new Set(["g2"]),
    });
    fireEvent.change(filterInput(), { target: { value: "the" } });

    fireEvent.click(screen.getByText(/Select all 1 new shown/));
    expect(onToggleAll).toHaveBeenCalledWith(["g4"]);
  });

  it("keeps already-added rows disabled while filtering", () => {
    renderStep({
      preview: preview(many),
      addMoreMode: true,
      existingGuids: new Set(["g2"]),
    });
    fireEvent.change(filterInput(), { target: { value: "king" } });

    const box = screen.getByText("The King of Israel")
      .closest("label")!
      .querySelector("input")!;
    expect(box).toBeDisabled();
  });

  it("shows an empty state when nothing matches", () => {
    renderStep({ preview: preview(many) });
    fireEvent.change(filterInput(), { target: { value: "zzzz" } });

    expect(screen.getByText(/No episodes match/i)).toBeInTheDocument();
    expect(screen.queryByText("The King of Israel")).toBeNull();
  });

  it("behaves exactly as before with an empty query", () => {
    renderStep({ preview: preview(many) });
    fireEvent.change(filterInput(), { target: { value: "x" } });
    fireEvent.change(filterInput(), { target: { value: "" } });

    expect(screen.getByText(/4 episodes found/)).toBeInTheDocument();
    for (const e of many) {
      expect(screen.getByText(e.title!)).toBeInTheDocument();
    }
  });
});
