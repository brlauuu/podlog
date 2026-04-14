/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockUseSearchParams = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

import BackToSearchLink from "@/components/BackToSearchLink";

describe("BackToSearchLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not render when there is no search query", () => {
    mockUseSearchParams.mockReturnValue({
      get: () => null,
    });

    render(<BackToSearchLink />);

    expect(screen.queryByRole("link", { name: /back to search results/i })).not.toBeInTheDocument();
  });

  it("renders a fixed floating link with encoded query when search query exists", () => {
    mockUseSearchParams.mockReturnValue({
      get: () => "john doe & jane",
    });

    render(<BackToSearchLink />);

    const link = screen.getByRole("link", { name: /back to search results/i });
    expect(link).toHaveAttribute("href", "/search?q=john%20doe%20%26%20jane");
    expect(link).toHaveClass(
      "fixed",
      "bottom-6",
      "left-6",
      "z-40",
      "bg-action",
      "text-action-foreground",
      "hover:bg-action/90"
    );
  });
});
