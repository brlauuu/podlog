/**
 * @jest-environment jsdom
 */
/**
 * Tests for /feeds page (apps/web/src/app/feeds/page.tsx, #669).
 *
 * Focuses on the highest-value paths through the page after the #664
 * split: render of empty + populated lists, the add-feed POST flow,
 * the poll mutation, and the delete-with-confirm flow.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// FeedsListSection is exercised by its own tests; stub it so this suite
// can drive the dialog + mutations through the page surface.
jest.mock("@/components/FeedsListSection", () => ({
  __esModule: true,
  default: ({
    isLoading,
    feeds,
    onAddFirstFeed,
    onPoll,
    onDelete,
  }: {
    isLoading: boolean;
    feeds: { id: string; url: string; title: string | null }[];
    onAddFirstFeed: () => void;
    onPoll: (id: string) => void;
    onDelete: (id: string) => void;
  }) => {
    if (isLoading) return <div data-testid="feeds-loading">Loading…</div>;
    if (feeds.length === 0) {
      return (
        <div>
          <p>No feeds yet</p>
          <button onClick={onAddFirstFeed} data-testid="empty-add">
            Add first feed
          </button>
        </div>
      );
    }
    return (
      <ul data-testid="feeds-list">
        {feeds.map((f) => (
          <li key={f.id} data-testid={`feed-${f.id}`}>
            <span>{f.title ?? f.url}</span>
            <button onClick={() => onPoll(f.id)}>Poll</button>
            <button onClick={() => onDelete(f.id)}>Delete</button>
          </li>
        ))}
      </ul>
    );
  },
}));

import FeedsPage from "@/app/feeds/page";

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

type FetchInit = RequestInit | undefined;

interface FetchMockEntry {
  url: string;
  init: FetchInit;
}

function installFetchMock(handlers: {
  [path: string]: (init: FetchInit) => Promise<Response> | Response;
}) {
  const calls: FetchMockEntry[] = [];
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    // Match by URL pathname (strip query string).
    const path = url.split("?")[0];
    const handler = handlers[path];
    if (!handler) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: `no mock for ${path}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(handler(init));
  }) as unknown as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200) {
  // Minimal Response-shaped object — sufficient for the page's `fetchFeeds`
  // / mutationFn helpers and avoids jsdom Response oddities that can swallow
  // the populated array body.
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("FeedsPage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the empty list when /api/feeds returns []", async () => {
    installFetchMock({
      "/api/feeds": () => json([]),
    });

    render(withQuery(<FeedsPage />));

    await waitFor(() =>
      expect(screen.getByText("No feeds yet")).toBeInTheDocument(),
    );
  });

  it("renders the populated list", async () => {
    installFetchMock({
      "/api/feeds": () =>
        json([
          {
            id: "f-1",
            url: "https://example.com/a.xml",
            title: "Feed A",
            mode: "test",
            last_polled_at: null,
            episode_count: 0,
          },
          {
            id: "f-2",
            url: "https://example.com/b.xml",
            title: null,
            mode: "full",
            last_polled_at: null,
            episode_count: 3,
          },
        ]),
    });

    render(withQuery(<FeedsPage />));

    await waitFor(
      () => expect(screen.getByTestId("feed-f-1")).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.getByText("Feed A")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/b.xml")).toBeInTheDocument();
  });

  it("posts to /api/feeds when the Add dialog is submitted in test mode", async () => {
    const calls = installFetchMock({
      "/api/feeds": (init) => {
        if (init?.method === "POST") return json({ id: "new-feed" }, 201);
        return json([]);
      },
    });

    render(withQuery(<FeedsPage />));

    await waitFor(() =>
      expect(screen.getByText("No feeds yet")).toBeInTheDocument(),
    );

    // Open dialog via header button (the explicit "Add Feed" button).
    await userEvent.click(screen.getByRole("button", { name: /add feed/i }));

    const urlInput = await screen.findByPlaceholderText(/feeds\.example\.com/i);
    await userEvent.type(urlInput, "https://example.com/new.xml");

    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.init?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post!.init!.body as string)).toEqual({
        url: "https://example.com/new.xml",
        mode: "test",
        selected_guids: undefined,
      });
    });
  });

  it("posts to /api/feeds/[id]/poll when Poll is clicked on a row", async () => {
    const calls = installFetchMock({
      "/api/feeds": () =>
        json([
          {
            id: "f-1",
            url: "https://example.com/a.xml",
            title: "Feed A",
            mode: "test",
            last_polled_at: null,
            episode_count: 0,
          },
        ]),
      "/api/feeds/f-1/poll": () => json({ ok: true }),
    });

    render(withQuery(<FeedsPage />));

    await waitFor(
      () => expect(screen.getByTestId("feed-f-1")).toBeInTheDocument(),
      { timeout: 3000 },
    );

    await userEvent.click(screen.getByRole("button", { name: /poll/i }));

    await waitFor(() => {
      const pollCall = calls.find((c) => c.url.endsWith("/poll"));
      expect(pollCall).toBeDefined();
      expect(pollCall!.init?.method).toBe("POST");
    });
  });

  it("DELETEs the feed when the user confirms both prompts", async () => {
    const calls = installFetchMock({
      "/api/feeds": () =>
        json([
          {
            id: "f-1",
            url: "https://example.com/a.xml",
            title: "Feed A",
            mode: "test",
            last_polled_at: null,
            episode_count: 0,
          },
        ]),
      "/api/feeds/f-1": () => json({ ok: true }),
    });

    // Page calls confirm() once (delete-episodes prompt).
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    render(withQuery(<FeedsPage />));

    await waitFor(
      () => expect(screen.getByTestId("feed-f-1")).toBeInTheDocument(),
      { timeout: 3000 },
    );

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      const del = calls.find((c) => c.init?.method === "DELETE");
      expect(del).toBeDefined();
      expect(del!.url).toContain("/api/feeds/f-1?delete_episodes=true");
    });
    expect(confirmSpy).toHaveBeenCalled();
  });
});
