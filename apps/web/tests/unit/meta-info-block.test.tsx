/**
 * @jest-environment jsdom
 */
/**
 * Tests for the Meta-Analysis InfoBlock collapsible explainer.
 * The block's prose was rewritten for PRD-06; this test exercises the
 * toggle behaviour against the current copy.
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
      name: /what do these charts show\?/i,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Per-speaker minutes/i)).not.toBeInTheDocument();
  });

  it("expands to show the chart explainer on click", async () => {
    render(<InfoBlock />);
    const trigger = screen.getByRole("button", {
      name: /what do these charts show\?/i,
    });

    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Per-speaker minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/Host vs Guest talking time/i)).toBeInTheDocument();
  });

  it("collapses again on a second click", async () => {
    render(<InfoBlock />);
    const trigger = screen.getByRole("button", {
      name: /what do these charts show\?/i,
    });

    await userEvent.click(trigger);
    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Per-speaker minutes/i)).not.toBeInTheDocument();
  });
});
