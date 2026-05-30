/**
 * @jest-environment jsdom
 *
 * Tests for the usePlotlyTheme hook (PRD-06; coverage gap closed in #764).
 * The hook syncs to the `<html class="dark">` state via MutationObserver.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { usePlotlyTheme } from "@/app/meta-analysis/charts/usePlotlyTheme";

function Probe() {
  const t = usePlotlyTheme();
  return <span data-testid="t">{t}</span>;
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("usePlotlyTheme", () => {
  it("returns plotly_white when the <html> element has no 'dark' class", () => {
    render(<Probe />);
    expect(screen.getByTestId("t")).toHaveTextContent("plotly_white");
  });

  it("returns plotly_dark when the 'dark' class is already present at mount", () => {
    document.documentElement.classList.add("dark");
    render(<Probe />);
    expect(screen.getByTestId("t")).toHaveTextContent("plotly_dark");
  });

  it("switches to plotly_dark when the class is toggled on after mount", async () => {
    render(<Probe />);
    expect(screen.getByTestId("t")).toHaveTextContent("plotly_white");

    act(() => {
      document.documentElement.classList.add("dark");
    });

    // MutationObserver flushes asynchronously — give it a microtask.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("t")).toHaveTextContent("plotly_dark");
  });

  it("switches back to plotly_white when the class is removed", async () => {
    document.documentElement.classList.add("dark");
    render(<Probe />);
    expect(screen.getByTestId("t")).toHaveTextContent("plotly_dark");

    act(() => {
      document.documentElement.classList.remove("dark");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("t")).toHaveTextContent("plotly_white");
  });

  it("disconnects its observer on unmount (no further state updates leak)", async () => {
    const { unmount } = render(<Probe />);
    unmount();
    // Toggling after unmount must not throw.
    act(() => {
      document.documentElement.classList.add("dark");
    });
    await act(async () => {
      await Promise.resolve();
    });
    // No assertion needed beyond "no throw".
  });
});
