/**
 * @jest-environment jsdom
 */
/**
 * Tests for SearchPagination (#673).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import SearchPagination from "@/components/SearchPagination";

describe("SearchPagination", () => {
  it("renders nothing for a single page", () => {
    const { container } = render(
      <SearchPagination page={1} totalPages={1} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Previous on page 1 and Next on the last page", () => {
    const { rerender } = render(
      <SearchPagination page={1} totalPages={3} onPageChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();

    rerender(
      <SearchPagination page={3} totalPages={3} onPageChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("calls onPageChange with the clamped next/prev page", async () => {
    const onPageChange = jest.fn();
    render(
      <SearchPagination
        page={2}
        totalPages={3}
        onPageChange={onPageChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
  });
});
