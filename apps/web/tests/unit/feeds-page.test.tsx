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
    onPromote,
    onTogglePause,
    onAddMore,
  }: {
    isLoading: boolean;
    feeds: { id: string; url: string; title: string | null; paused?: boolean }[];
    onAddFirstFeed: () => void;
    onPoll: (id: string) => void;
    onDelete: (id: string) => void;
    onPromote?: (url: string) => void;
    onTogglePause?: (id: string, paused: boolean) => void;
    onAddMore?: (feed: { id: string; url: string; title: string | null }) => void;
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
            {onPromote && (
              <button onClick={() => onPromote(f.url)} data-testid={`promote-${f.id}`}>
                Promote
              </button>
            )}
            {onTogglePause && (
              <button
                data-testid={`pause-${f.id}`}
                onClick={() => onTogglePause(f.id, !(f.paused ?? false))}
              >
                Toggle pause
              </button>
            )}
            {onAddMore && (
              <button
                data-testid={`add-more-${f.id}`}
                onClick={() => onAddMore(f)}
              >
                Add more
              </button>
            )}
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

  // Extended coverage for #765 (audit)
  describe("selective mode", () => {
    it("loads the preview before opening step 2 when mode=selective", async () => {
      const calls = installFetchMock({
        "/api/feeds": () => json([]),
        "/api/feeds/preview": () =>
          json({
            title: "Sample feed",
            episodes: [
              { guid: "g1", title: "Ep 1", published_at: null, duration_secs: 1800, audio_url: "x" },
            ],
          }),
      });

      render(withQuery(<FeedsPage />));
      await waitFor(() => expect(screen.getByText("No feeds yet")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: /add feed/i }));
      const urlInput = await screen.findByPlaceholderText(/feeds\.example\.com/i);
      await userEvent.type(urlInput, "https://example.com/sel.xml");

      // Switch to selective via the mode button labeled "Select episodes"
      const selectiveBtn = await screen.findByRole("button", {
        name: /Select episodes/i,
      });
      await userEvent.click(selectiveBtn);

      // "Next" submit triggers preview fetch
      await userEvent.click(screen.getByRole("button", { name: /next/i }));

      await waitFor(() => {
        const previewCall = calls.find((c) => c.url.includes("/api/feeds/preview"));
        expect(previewCall).toBeDefined();
      });
      // Step 2 renders the episode title
      expect(await screen.findByText("Ep 1")).toBeInTheDocument();
    });

    it("surfaces the server detail when the preview fails", async () => {
      installFetchMock({
        "/api/feeds": () => json([]),
        "/api/feeds/preview": () => json({ detail: "Not a feed" }, 422),
      });

      render(withQuery(<FeedsPage />));
      await waitFor(() => expect(screen.getByText("No feeds yet")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: /add feed/i }));
      const urlInput = await screen.findByPlaceholderText(/feeds\.example\.com/i);
      await userEvent.type(urlInput, "https://example.com/bad.xml");
      await userEvent.click(
        screen.getByRole("button", { name: /Select episodes/i }),
      );
      await userEvent.click(screen.getByRole("button", { name: /next/i }));

      expect(await screen.findByText("Not a feed")).toBeInTheDocument();
    });
  });

  describe("pause toggle (#743)", () => {
    it("PATCHes /api/feeds/{id} with paused=true when toggle is clicked", async () => {
      const calls = installFetchMock({
        "/api/feeds": () =>
          json([
            {
              id: "f-9",
              url: "https://ex.com/a.xml",
              title: "A",
              mode: "full",
              paused: false,
              last_polled_at: null,
              episode_count: 3,
            },
          ]),
        "/api/feeds/f-9": () => json({ id: "f-9", paused: true }),
      });

      render(withQuery(<FeedsPage />));
      await waitFor(() => expect(screen.getByTestId("pause-f-9")).toBeInTheDocument());
      await userEvent.click(screen.getByTestId("pause-f-9"));

      await waitFor(() => {
        const patch = calls.find((c) => c.init?.method === "PATCH");
        expect(patch).toBeDefined();
        expect(patch!.url).toContain("/api/feeds/f-9");
        expect(JSON.parse(patch!.init!.body as string)).toEqual({ paused: true });
      });
    });
  });

  describe("add-more flow (#487)", () => {
    it("loads preview + existing GUIDs when Add more is invoked from a selective feed", async () => {
      const calls = installFetchMock({
        "/api/feeds": () =>
          json([
            {
              id: "f-sel",
              url: "https://ex.com/sel.xml",
              title: "Sel",
              mode: "selective",
              paused: false,
              last_polled_at: null,
              episode_count: 1,
            },
          ]),
        "/api/feeds/preview": () =>
          json({
            title: "Sel",
            episodes: [
              { guid: "g1", title: "Ep 1", published_at: null, duration_secs: 100, audio_url: "x" },
              { guid: "g2", title: "Ep 2", published_at: null, duration_secs: 200, audio_url: "y" },
            ],
          }),
        "/api/feeds/f-sel/episodes/guids": () => json(["g1"]),
      });

      render(withQuery(<FeedsPage />));
      await waitFor(() =>
        expect(screen.getByTestId("add-more-f-sel")).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByTestId("add-more-f-sel"));

      // The preview call and the existing-GUIDs call fire in parallel.
      await waitFor(() =>
        expect(
          calls.some((c) => c.url.includes("/api/feeds/preview")),
        ).toBe(true),
      );
      expect(
        calls.some((c) =>
          c.url.includes("/api/feeds/f-sel/episodes/guids"),
        ),
      ).toBe(true);
      // Step-2 episode list mounts on success.
      expect(await screen.findByText("Ep 2")).toBeInTheDocument();
    });

    it("toggles individual episode selection through the step-2 checkboxes", async () => {
      installFetchMock({
        "/api/feeds": () =>
          json([
            {
              id: "f-sel",
              url: "https://ex.com/sel.xml",
              title: "Sel",
              mode: "selective",
              paused: false,
              last_polled_at: null,
              episode_count: 0,
            },
          ]),
        "/api/feeds/preview": () =>
          json({
            title: "Sel",
            episodes: [
              { guid: "g1", title: "Ep 1", published_at: null, duration_secs: 100, audio_url: "x" },
              { guid: "g2", title: "Ep 2", published_at: null, duration_secs: 200, audio_url: "y" },
            ],
          }),
        "/api/feeds/f-sel/episodes/guids": () => json([]),
      });

      render(withQuery(<FeedsPage />));
      await waitFor(() => expect(screen.getByTestId("add-more-f-sel")).toBeInTheDocument());
      await userEvent.click(screen.getByTestId("add-more-f-sel"));
      await screen.findByText("Ep 1");

      // Click Ep 2's checkbox — toggleGuid path.
      const checkboxes = await screen.findAllByRole("checkbox");
      // Both checkboxes start unselected (no existingGuids).
      await userEvent.click(checkboxes[1]);
      // Trigger "Select all new" → toggleAll add-more branch.
      await userEvent.click(screen.getByRole("button", { name: /Select all new|Deselect all new/ }));
    });

    it("does not advance to step 2 when the add-more preview fetch fails", async () => {
      installFetchMock({
        "/api/feeds": () =>
          json([
            {
              id: "f-sel",
              url: "https://ex.com/bad.xml",
              title: "Bad",
              mode: "selective",
              paused: false,
              last_polled_at: null,
              episode_count: 0,
            },
          ]),
        "/api/feeds/preview": () => json({ detail: "Feed offline" }, 502),
        "/api/feeds/f-sel/episodes/guids": () => json([]),
      });

      render(withQuery(<FeedsPage />));
      await waitFor(() =>
        expect(screen.getByTestId("add-more-f-sel")).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByTestId("add-more-f-sel"));

      // The "Loading episodes..." placeholder appears, then disappears.
      await waitFor(() =>
        expect(screen.queryByText(/Loading episodes/)).not.toBeInTheDocument(),
      );
      // We never render Step 2 (no episode list).
      expect(screen.queryByText("Ep 1")).not.toBeInTheDocument();
    });
  });

  describe("promote flow", () => {
    it("POSTs full mode when the user confirms promotion from a test feed", async () => {
      const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
      const calls = installFetchMock({
        "/api/feeds": (init) => {
          if (init?.method === "POST") return json({ id: "promoted" }, 201);
          return json([
            {
              id: "f-1",
              url: "https://ex.com/test.xml",
              title: "Test",
              mode: "test",
              paused: false,
              last_polled_at: null,
              episode_count: 0,
            },
          ]);
        },
      });

      render(withQuery(<FeedsPage />));
      await waitFor(() => expect(screen.getByTestId("promote-f-1")).toBeInTheDocument());
      await userEvent.click(screen.getByTestId("promote-f-1"));

      await waitFor(() => {
        const post = calls.find((c) => c.init?.method === "POST");
        expect(post).toBeDefined();
        expect(JSON.parse(post!.init!.body as string)).toEqual({
          url: "https://ex.com/test.xml",
          mode: "full",
        });
      });
      expect(confirmSpy).toHaveBeenCalled();
    });
  });
});
