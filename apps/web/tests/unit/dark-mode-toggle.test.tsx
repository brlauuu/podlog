/**
 * @jest-environment jsdom
 */
/**
 * Tests for DarkModeToggle (#673). Covers the SSR-flash guard, hydrated
 * default-light render, system-pref override, persisted preference,
 * and the toggle click that flips the `dark` class on <html>.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({
    src,
    alt,
    width,
    height,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
  }) => (
    <img src={src} alt={alt} width={width} height={height} data-mocked-image />
  ),
}));

import DarkModeToggle from "@/components/DarkModeToggle";

function mockMatchMedia(matchesDark: boolean) {
  window.matchMedia = jest.fn().mockImplementation((q: string) => ({
    matches: q.includes("dark") && matchesDark,
    media: q,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("DarkModeToggle", () => {
  it("starts dark when localStorage records the preference", async () => {
    localStorage.setItem("podlog-theme", "dark");
    mockMatchMedia(false);

    await act(async () => {
      render(<DarkModeToggle />);
    });

    const button = screen.getByRole("button", {
      name: /switch to light mode/i,
    });
    expect(button).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("respects the system preference when no override is stored", async () => {
    mockMatchMedia(true);

    await act(async () => {
      render(<DarkModeToggle />);
    });

    expect(
      screen.getByRole("button", { name: /switch to light mode/i }),
    ).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggles dark off → on and persists the choice", async () => {
    mockMatchMedia(false);

    await act(async () => {
      render(<DarkModeToggle />);
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    const button = screen.getByRole("button", {
      name: /switch to dark mode/i,
    });

    await userEvent.click(button);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("podlog-theme")).toBe("dark");
    expect(
      screen.getByRole("button", { name: /switch to light mode/i }),
    ).toBeInTheDocument();
  });
});
