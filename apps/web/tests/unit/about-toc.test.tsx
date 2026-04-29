/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import AboutToc, { stripDate } from "@/components/AboutToc";

describe("<AboutToc>", () => {
  const baseProps = {
    about: { id: "about-podlog", label: "About" },
    changelog: {
      id: "changelog",
      label: "Changelog",
      versions: [
        { id: "unreleased", text: "[Unreleased]" },
        { id: "0-3-0-2026-04-24", text: "[0.3.0] — 2026-04-24" },
        { id: "0-2-0-2026-04-24", text: "[0.2.0] — 2026-04-24" },
      ],
    },
  };

  it("renders the two top-level entries", () => {
    render(<AboutToc {...baseProps} />);
    expect(
      screen.getByRole("link", { name: "About" }),
    ).toHaveAttribute("href", "#about-podlog");
    expect(
      screen.getByRole("link", { name: "Changelog" }),
    ).toHaveAttribute("href", "#changelog");
  });

  it("renders versions nested under Changelog with date stripped", () => {
    render(<AboutToc {...baseProps} />);
    // Version label is the date-stripped version number, not the raw heading.
    expect(
      screen.getByRole("link", { name: "[0.3.0]" }),
    ).toHaveAttribute("href", "#0-3-0-2026-04-24");
    expect(
      screen.getByRole("link", { name: "[0.2.0]" }),
    ).toHaveAttribute("href", "#0-2-0-2026-04-24");
    // No date suffix should appear in the rail.
    expect(screen.queryByText(/2026-04-24/)).toBeNull();
  });

  it("preserves the [Unreleased] label as-is (no date to strip)", () => {
    render(<AboutToc {...baseProps} />);
    expect(
      screen.getByRole("link", { name: "[Unreleased]" }),
    ).toHaveAttribute("href", "#unreleased");
  });

  it("renders no versions section when the version list is empty", () => {
    render(
      <AboutToc
        {...baseProps}
        changelog={{ ...baseProps.changelog, versions: [] }}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /\[\d/ }),
    ).toBeNull();
    // Top-level entries still render.
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Changelog" })).toBeInTheDocument();
  });
});

describe("stripDate()", () => {
  it("removes em-dash + ISO date suffix", () => {
    expect(stripDate("[0.3.0] — 2026-04-24")).toBe("[0.3.0]");
  });

  it("removes en-dash + ISO date suffix", () => {
    expect(stripDate("[0.3.0] – 2026-04-24")).toBe("[0.3.0]");
  });

  it("removes hyphen + ISO date suffix", () => {
    expect(stripDate("[0.3.0] - 2026-04-24")).toBe("[0.3.0]");
  });

  it("leaves [Unreleased] untouched", () => {
    expect(stripDate("[Unreleased]")).toBe("[Unreleased]");
  });
});
