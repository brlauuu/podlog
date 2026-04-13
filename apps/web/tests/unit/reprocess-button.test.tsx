/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

import ReprocessButton from "@/components/ReprocessButton";

describe("ReprocessButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses compact tag-like sizing classes", () => {
    render(<ReprocessButton episodeId="ep-1" status="done" />);

    const button = screen.getByRole("button", { name: /reprocess/i });
    expect(button).toHaveClass(
      "px-1.5",
      "py-0.5",
      "text-xs",
      "rounded",
      "font-medium",
      "border"
    );
  });
});
