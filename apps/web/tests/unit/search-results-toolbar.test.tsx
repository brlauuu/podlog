/**
 * @jest-environment jsdom
 */
/**
 * Tests for SearchResultsToolbar (#673).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// DownloadReportButton bundles a markdown generator and a real download
// trigger. Stub it for this unit test.
jest.mock("@/components/DownloadReportButton", () => ({
  __esModule: true,
  default: ({ query }: { query: string }) => (
    <button data-testid="download-btn">{query}</button>
  ),
}));

import SearchResultsToolbar from "@/components/SearchResultsToolbar";

describe("SearchResultsToolbar", () => {
  function baseProps(over: Partial<React.ComponentProps<typeof SearchResultsToolbar>> = {}) {
    return {
      viewMode: "grouped" as const,
      onViewModeChange: jest.fn(),
      pageSize: 20,
      onPageSizeChange: jest.fn(),
      summaryText: "12 results",
      coverageText: " · 5 episodes",
      submittedQuery: "climate",
      flatData: undefined,
      groupedData: undefined,
      ...over,
    };
  }

  it("renders summary, coverage, and the page-size options", () => {
    render(<SearchResultsToolbar {...baseProps()} />);
    expect(screen.getByText(/12 results/)).toBeInTheDocument();
    expect(screen.getByText(/· 5 episodes/)).toBeInTheDocument();
    const select = screen.getByRole("combobox");
    expect((select as HTMLSelectElement).value).toBe("20");
    expect(screen.getByRole("option", { name: "50" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "100" })).toBeInTheDocument();
  });

  it("calls onPageSizeChange with a parsed number", async () => {
    const onPageSizeChange = jest.fn();
    render(
      <SearchResultsToolbar {...baseProps({ onPageSizeChange })} />,
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox"),
      "50",
    );
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("toggles between grouped and flat views", async () => {
    const onViewModeChange = jest.fn();
    render(<SearchResultsToolbar {...baseProps({ onViewModeChange })} />);

    await userEvent.click(screen.getByRole("button", { name: /^flat$/i }));
    expect(onViewModeChange).toHaveBeenLastCalledWith("flat");

    await userEvent.click(screen.getByRole("button", { name: /^grouped$/i }));
    expect(onViewModeChange).toHaveBeenLastCalledWith("grouped");
  });

  it("renders the DownloadReportButton with the submitted query", () => {
    render(<SearchResultsToolbar {...baseProps()} />);
    expect(screen.getByTestId("download-btn")).toHaveTextContent("climate");
  });
});
