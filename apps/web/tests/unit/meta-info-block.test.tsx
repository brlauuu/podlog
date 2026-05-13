/**
 * @jest-environment jsdom
 */
/**
 * Tests for the Meta-Analysis InfoBlock collapsible explainer (#673).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import InfoBlock from "@/app/meta-analysis/InfoBlock";

describe("InfoBlock", () => {
  it("renders collapsed by default with the trigger label", () => {
    render(<InfoBlock />);
    const trigger = screen.getByRole("button", {
      name: /what are segments and chunks\?/i,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/raw Whisper output/i)).not.toBeInTheDocument();
  });

  it("expands to show the segment/chunk explainer on click", async () => {
    render(<InfoBlock />);
    const trigger = screen.getByRole("button", {
      name: /what are segments and chunks\?/i,
    });

    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/raw Whisper output/i)).toBeInTheDocument();
    expect(screen.getByText(/cl100k_base/i)).toBeInTheDocument();
  });

  it("collapses again on a second click", async () => {
    render(<InfoBlock />);
    const trigger = screen.getByRole("button", {
      name: /what are segments and chunks\?/i,
    });

    await userEvent.click(trigger);
    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/raw Whisper output/i)).not.toBeInTheDocument();
  });
});
