import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import FiltersBar from "@/app/meta-analysis/FiltersBar";

const FEEDS = [
  { feed_id: "f1", title: "One" },
  { feed_id: "f2", title: "Two" },
];

describe("FiltersBar", () => {
  it("renders a button per podcast plus 'All podcasts'", () => {
    render(
      <FiltersBar feeds={FEEDS} selectedFeedId={null} onSelectionChange={() => {}} />
    );
    expect(screen.getByRole("button", { name: "One" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Two" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All podcasts" })).toBeInTheDocument();
  });

  it("calls onSelectionChange with the feed_id when a podcast button is clicked", () => {
    const onChange = jest.fn();
    render(
      <FiltersBar feeds={FEEDS} selectedFeedId={null} onSelectionChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: "One" }));
    expect(onChange).toHaveBeenCalledWith("f1");
  });

  it("calls onSelectionChange with null when 'All podcasts' is clicked", () => {
    const onChange = jest.fn();
    render(
      <FiltersBar feeds={FEEDS} selectedFeedId="f1" onSelectionChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: "All podcasts" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("highlights the active feed button", () => {
    render(
      <FiltersBar feeds={FEEDS} selectedFeedId="f2" onSelectionChange={() => {}} />
    );
    const active = screen.getByRole("button", { name: "Two" });
    const inactive = screen.getByRole("button", { name: "One" });
    expect(active.className).toMatch(/bg-accent/);
    expect(inactive.className).not.toMatch(/bg-accent text-accent-foreground/);
  });

  it("highlights 'All podcasts' when selection is null", () => {
    render(
      <FiltersBar feeds={FEEDS} selectedFeedId={null} onSelectionChange={() => {}} />
    );
    const all = screen.getByRole("button", { name: "All podcasts" });
    expect(all.className).toMatch(/bg-accent/);
  });
});
