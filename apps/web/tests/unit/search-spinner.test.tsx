/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockUseSearchParams = jest.fn();
const mockUseRouter = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => mockUseRouter(),
}));

jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  );
});

import SearchPage from "@/app/search/page";

describe("Search page loading spinner", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => (key === "q" ? "loading-query" : null),
    });
    mockUseRouter.mockReturnValue({ replace: jest.fn() });

    global.fetch = jest.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("/api/ask/coverage")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ processed: 10 }),
        } as Response);
      }
      if (url.startsWith("/api/feeds")) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
        } as Response);
      }
      if (url.startsWith("/api/search/grouped?")) {
        return new Promise(() => undefined);
      }
      if (url.startsWith("/api/search?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            results: [],
            total: 0,
            page: 1,
            pageSize: 20,
            coverage: { processed: 0, total: 0 },
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as jest.Mock;
  });

  test("renders fixed-height equalizer bars while searching", async () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <SearchPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Searching...")).toBeInTheDocument();
    expect(
      container.querySelector(
        ".bg-foreground.h-6.origin-center.animate-\\[eqBar_1\\.4s_ease-in-out_infinite\\]"
      )
    ).toBeInTheDocument();
  });
});
