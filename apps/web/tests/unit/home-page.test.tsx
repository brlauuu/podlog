/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  );
});

import HomePage from "@/app/page";

describe("HomePage issue 274", () => {
  test("renders theme-aware logos and renamed Ask button", () => {
    render(<HomePage />);

    const logos = screen.getAllByRole("img", { name: "Podlog" });
    expect(logos).toHaveLength(2);

    const lightLogo = logos.find((img) =>
      (img as HTMLImageElement).src.includes("podlog-logo-light-theme.svg"),
    );
    const darkLogo = logos.find((img) =>
      (img as HTMLImageElement).src.includes("podlog-logo-dark-theme.svg"),
    );
    expect(lightLogo).toBeDefined();
    expect(darkLogo).toBeDefined();
    expect(lightLogo!.className).toContain("dark:hidden");
    expect(darkLogo!.className).toContain("dark:block");

    expect(screen.getByRole("link", { name: "Ask" })).toHaveAttribute("href", "/ask");
    expect(screen.queryByRole("link", { name: "Ask AI" })).toBeNull();
  });

  test("uses matching button style for Search and Ask", () => {
    render(<HomePage />);

    const searchLink = screen.getByRole("link", { name: "Search" });
    const askLink = screen.getByRole("link", { name: "Ask" });

    expect(searchLink.className).toContain("border border-input bg-background text-foreground");
    expect(askLink.className).toContain("border border-input bg-background text-foreground");
  });

  test("removes stats and feature sections from homepage", () => {
    render(<HomePage />);

    expect(screen.queryByText(/This database contains/i)).toBeNull();
    expect(screen.queryByText(/Fully self-hosted/i)).toBeNull();
    expect(screen.queryByText(/RAG-powered AI answers/i)).toBeNull();
  });

  test("renders Explore button linking to /podcasts in matching style (issue #528)", () => {
    render(<HomePage />);

    const exploreLink = screen.getByRole("link", { name: "Explore" });
    expect(exploreLink).toHaveAttribute("href", "/podcasts");
    expect(exploreLink.className).toContain("border border-input bg-background text-foreground");
  });

  test("button group is width-pinned to logo so three buttons cannot outgrow it (issue #528)", () => {
    const { container } = render(<HomePage />);
    const searchLink = screen.getByRole("link", { name: "Search" });
    const buttonRow = searchLink.parentElement as HTMLElement;

    expect(buttonRow.className).toContain("w-[280px]");
    expect(buttonRow.className).toContain("sm:w-[420px]");
    expect(searchLink.className).toContain("flex-1");
    expect(screen.getByRole("link", { name: "Ask" }).className).toContain("flex-1");
    expect(screen.getByRole("link", { name: "Explore" }).className).toContain("flex-1");

    // Button row should be a direct child of the HomePage root (the logo's container)
    expect(container.contains(buttonRow)).toBe(true);
  });

  test("uses main-area centering without hardcoded viewport subtraction", () => {
    const { container } = render(<HomePage />);
    const root = container.firstElementChild as HTMLElement;

    expect(root.className).toContain("my-auto");
    expect(root.className).toContain("items-center");
    expect(root.className).not.toContain("min-h-[calc(100dvh-4rem)]");
    expect(root.className).not.toContain("pt-16");
  });
});
