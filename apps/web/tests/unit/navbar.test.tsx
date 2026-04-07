/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock next/link
jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  );
});

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// Mock child components
jest.mock("@/components/DarkModeToggle", () => () => <div data-testid="dark-mode-toggle" />);
jest.mock("@/components/HelpMenu", () => () => <div data-testid="help-menu" />);

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
