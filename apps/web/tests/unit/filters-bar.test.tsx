import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import FiltersBar from "@/app/meta-analysis/FiltersBar";

const FEEDS = [
  { feed_id: "f1", title: "One" },
  { feed_id: "f2", title: "Two" },
];

describe("FiltersBar", () => {
  it("renders a checkbox per podcast", () => {
    render(
      <FiltersBar feeds={FEEDS} selectedFeedIds={[]} onSelectedChange={() => {}} />
    );
    expect(screen.getByLabelText("One")).toBeInTheDocument();
    expect(screen.getByLabelText("Two")).toBeInTheDocument();
  });

  it("calls onSelectedChange with updated array when toggled", () => {
    const onChange = jest.fn();
    render(
      <FiltersBar feeds={FEEDS} selectedFeedIds={[]} onSelectedChange={onChange} />
    );
    fireEvent.click(screen.getByLabelText("One"));
    expect(onChange).toHaveBeenCalledWith(["f1"]);
  });
});
