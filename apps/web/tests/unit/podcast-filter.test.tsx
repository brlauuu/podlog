/**
 * @jest-environment jsdom
 *
 * Tests for the PodcastFilter dropdown used on the search results page.
 * (Coverage gap closed in #765.)
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import PodcastFilter from "@/components/PodcastFilter";

type Feed = { id: string; title: string | null; episode_count: number };

const FEEDS: Feed[] = [
  { id: "f1", title: "One", episode_count: 10 },
  { id: "f2", title: "Two", episode_count: 5 },
  { id: "f3", title: null, episode_count: 1 },
];

function renderFilter(overrides: Partial<React.ComponentProps<typeof PodcastFilter>> = {}) {
  const onSelectionChange = jest.fn();
  const utils = render(
    <PodcastFilter
      feeds={FEEDS}
      selectedFeedIds={new Set()}
      onSelectionChange={onSelectionChange}
      {...overrides}
    />,
  );
  return { onSelectionChange, ...utils };
}

describe("<PodcastFilter>", () => {
  it("renders the closed trigger with 'All' label when nothing selected", () => {
    renderFilter();
    expect(
      screen.getByRole("button", { name: /Source:\s*All/ }),
    ).toBeInTheDocument();
  });

  it("renders an 'N selected' label when feeds are selected", () => {
    renderFilter({ selectedFeedIds: new Set(["f1", "f2"]) });
    expect(
      screen.getByRole("button", { name: /Source:\s*2 selected/ }),
    ).toBeInTheDocument();
  });

  it("shows 'Loading...' on the trigger when loading and there are no options yet", () => {
    renderFilter({ feeds: [], loading: true });
    expect(screen.getByRole("button", { name: /Loading/ })).toBeInTheDocument();
  });

  it("opens the menu when the trigger is clicked and lists every feed title", () => {
    renderFilter();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    // Null title falls back to "Untitled"
    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText("All sources")).toBeInTheDocument();
  });

  it("calls onSelectionChange with the feed id when a row is toggled on", () => {
    const { onSelectionChange } = renderFilter();
    fireEvent.click(screen.getByRole("button"));
    const checkbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(checkbox);
    expect(onSelectionChange).toHaveBeenCalled();
    const arg = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(arg.has("f1")).toBe(true);
  });

  it("calls onSelectionChange removing the feed id when a row is toggled off", () => {
    const { onSelectionChange } = renderFilter({
      selectedFeedIds: new Set(["f1"]),
    });
    fireEvent.click(screen.getByRole("button"));
    const checkbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(checkbox);
    const arg = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(arg.has("f1")).toBe(false);
  });

  it("clears the selection when 'All sources' is clicked", () => {
    const { onSelectionChange } = renderFilter({
      selectedFeedIds: new Set(["f1", "f2"]),
    });
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("All sources"));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set());
  });

  it("renders the 'Manual uploads' option when hasManualUploads is true", () => {
    renderFilter({ hasManualUploads: true });
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Manual uploads")).toBeInTheDocument();
  });

  it("toggles the synthetic __uploads__ id when Manual uploads is clicked", () => {
    const { onSelectionChange } = renderFilter({ hasManualUploads: true });
    fireEvent.click(screen.getByRole("button"));
    const allCheckboxes = screen.getAllByRole("checkbox");
    fireEvent.click(allCheckboxes[allCheckboxes.length - 1]);
    const arg = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(arg.has("__uploads__")).toBe(true);
  });

  it("shows the 'No sources available' message when nothing is loading and there are no options", () => {
    renderFilter({ feeds: [], hasManualUploads: false });
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/No sources available/)).toBeInTheDocument();
  });

  it("closes when clicking outside the dropdown", () => {
    renderFilter();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("All sources")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("All sources")).not.toBeInTheDocument();
  });
});
