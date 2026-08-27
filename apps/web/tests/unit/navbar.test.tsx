/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock next/link
jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  );
});

// Mock next/navigation. Mutable so the route-change behaviour (#989) can be
// exercised -- with a constant here, the effect that closes the panel on
// navigation is unreachable and silently untested.
let mockPathname = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

// Mock child components
jest.mock("@/components/DarkModeToggle", () => () => <div data-testid="dark-mode-toggle" />);

import Navbar from "@/components/Navbar";

describe("Navbar", () => {
  beforeEach(() => {
    render(<Navbar />);
  });

  test("renders About link pointing to /about", () => {
    const aboutLink = screen.getByRole("link", { name: "About" });
    expect(aboutLink).toHaveAttribute("href", "/about");
  });

  test("renders all expected nav links", () => {
    const expectedLinks = ["Search", "Ask", "Sources", "Queue", "Settings", "About"];
    for (const label of expectedLinks) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  test("renders Podlog home link", () => {
    const homeLink = screen.getByRole("link", { name: "Podlog" });
    expect(homeLink).toHaveAttribute("href", "/");
  });
});

describe("Navbar — mobile menu (#989)", () => {
  // jsdom applies no CSS, so `hidden md:flex` does not actually hide the
  // desktop row here. These tests are about the panel's BEHAVIOUR -- that it
  // exists only when opened, and is wired up for assistive tech. Whether the
  // collapse itself works at 390px is measured in the real browser, by
  // tests/e2e/mobile-layout.spec.ts.
  function menuButton() {
    return screen.getByRole("button", { name: /open menu/i });
  }

  test("the menu is closed to begin with", () => {
    render(<Navbar />);
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("mobile-nav")).toBeNull();
  });

  test("opening it reveals every nav link and flips the label", () => {
    render(<Navbar />);
    fireEvent.click(menuButton());

    const panel = document.getElementById("mobile-nav");
    expect(panel).not.toBeNull();
    for (const label of ["Search", "Ask", "Sources", "Queue", "Meta-analysis", "Settings", "Docs", "About"]) {
      expect(within(panel as HTMLElement).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /close menu/i })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  test("the button points at the panel it controls", () => {
    render(<Navbar />);
    fireEvent.click(menuButton());
    expect(screen.getByRole("button", { name: /close menu/i })).toHaveAttribute(
      "aria-controls",
      "mobile-nav"
    );
  });

  test("choosing a destination closes the menu", () => {
    // Otherwise the panel covers the page the user just asked for.
    render(<Navbar />);
    fireEvent.click(menuButton());
    const panel = document.getElementById("mobile-nav") as HTMLElement;
    fireEvent.click(within(panel).getByRole("link", { name: "Queue" }));
    expect(document.getElementById("mobile-nav")).toBeNull();
  });

  test("navigating away closes the menu, even without a click on a panel link", () => {
    // Browser back/forward changes the route without going through the
    // panel's own onClick. Leaving it open would cover the page.
    const { rerender } = render(<Navbar />);
    fireEvent.click(menuButton());
    expect(document.getElementById("mobile-nav")).not.toBeNull();

    mockPathname = "/queue";
    rerender(<Navbar />);

    expect(document.getElementById("mobile-nav")).toBeNull();
    mockPathname = "/";
  });

  test("Escape closes the menu", () => {
    render(<Navbar />);
    fireEvent.click(menuButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.getElementById("mobile-nav")).toBeNull();
  });

  test("menu links are at least 44px of touch target", () => {
    // iOS and Android both ask for ~44px; the desktop row's py-1.5 is ~30px.
    render(<Navbar />);
    fireEvent.click(menuButton());
    const panel = document.getElementById("mobile-nav") as HTMLElement;
    const link = within(panel).getByRole("link", { name: "Search" });
    expect(link.className).toContain("min-h-11");
  });
});
