/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, waitFor } from "@testing-library/react";
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
import { saveSearchSnapshot, type SearchPageSnapshot } from "@/lib/page-state";

describe("Search page URL query priority", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => (key === "q" ? "url-query" : null),
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
        return Promise.resolve({
          ok: true,
          json: async () => ({
            feeds: [],
            totalFeeds: 0,
            totalEpisodes: 0,
            totalMentions: 0,
            coverage: { processed: 0, total: 0 },
          }),
        } as Response);
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

  test("starts URL query searches from page 1 even when snapshot page is higher", async () => {
    const staleSnapshot: SearchPageSnapshot = {
      query: "older-query",
      submittedQuery: "older-query",
      feedFilter: "",
      page: 5,
      viewMode: "grouped",
    };
    saveSearchSnapshot(staleSnapshot, sessionStorage);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SearchPage />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls.map(([arg]) =>
        String(arg)
      );
      expect(
        calls.some(
          (url) =>
            url.startsWith("/api/search/grouped?") &&
            url.includes("q=url-query") &&
            url.includes("page=1")
        )
      ).toBe(true);
    });
  });
});
