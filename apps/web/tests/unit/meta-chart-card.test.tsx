/**
 * @jest-environment jsdom
 */
/**
 * Tests for the Meta-Analysis ChartCard wrapper (#673).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ExpandModal pulls in shadcn Dialog (Radix). For a unit test of the
// card, stub it to a simple <section> so we can inspect open/close
// without dragging in the full Dialog environment.
jest.mock("@/app/meta-analysis/ExpandModal", () => ({
  __esModule: true,
  default: ({
    open,
    onClose,
    title,
    children,
  }: {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) =>
    open ? (
      <section data-testid="expand-modal" aria-label={title}>
        <button type="button" onClick={onClose} data-testid="expand-close">
          close
        </button>
        {children}
      </section>
    ) : null,
}));

import ChartCard from "@/app/meta-analysis/ChartCard";

describe("ChartCard", () => {
  it("renders title, subtitle, and chart children", () => {
    render(
      <ChartCard title="Episodes per feed" subtitle="last 30 days">
        <div data-testid="chart">[chart]</div>
      </ChartCard>,
    );
    expect(screen.getByText("Episodes per feed")).toBeInTheDocument();
    expect(screen.getByText("last 30 days")).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  it("shows the coverage line with included/total and excluded button", async () => {
    const onClickExcluded = jest.fn();
    render(
      <ChartCard
        title="Coverage"
        coverage={{ included: 7, total: 10, onClickExcluded }}
      >
        <div>chart</div>
      </ChartCard>,
    );
    expect(screen.getByText(/7 \/ 10 episodes/i)).toBeInTheDocument();
    const excludedBtn = screen.getByRole("button", { name: /3 excluded/i });
    await userEvent.click(excludedBtn);
    expect(onClickExcluded).toHaveBeenCalled();
  });

  it("only shows the expand button when a detail panel is provided, and opens it", async () => {
    const { rerender } = render(
      <ChartCard title="Plain">
        <div>chart</div>
      </ChartCard>,
    );
    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();

    rerender(
      <ChartCard title="With detail" detail={<div>detail body</div>}>
        <div>chart</div>
      </ChartCard>,
    );
    await userEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(screen.getByTestId("expand-modal")).toBeInTheDocument();
    expect(screen.getByText("detail body")).toBeInTheDocument();
  });
});
