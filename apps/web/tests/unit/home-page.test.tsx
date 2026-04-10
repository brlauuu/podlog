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

  test("centers logo, tagline, and actions in the viewport area below navbar", () => {
    const { container } = render(<HomePage />);
    const root = container.firstElementChild as HTMLElement;

    expect(root.className).toContain("min-h-[calc(100dvh-4rem)]");
    expect(root.className).toContain("justify-center");
    expect(root.className).toContain("items-center");
    expect(root.className).not.toContain("pt-16");
  });
});
