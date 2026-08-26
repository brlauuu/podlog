/**
 * /feeds — the add-more and selective-preview flows (#912).
 *
 * feeds-page.test.tsx covers list render, add, poll, delete and promote, but
 * stops before the two-step episode-selection paths, which left handleAddMore,
 * the addEpisodes mutation and handleAddOrPreview's branches uncovered.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@/components/FeedsListSection", () => ({
  __esModule: true,
  default: ({
    feeds,
    onAddMore,
  }: {
    feeds: { id: string; url: string; title: string | null }[];
    onAddMore?: (f: { id: string; url: string; title: string | null }) => void;
  }) => (
    <ul>
      {feeds.map((f) => (
        <li key={f.id}>
          {onAddMore && (
            <button data-testid={`add-more-${f.id}`} onClick={() => onAddMore(f)}>
              Add more
            </button>
          )}
        </li>
      ))}
    </ul>
  ),
}));

// The step-2 picker has its own tests; stub it so this suite drives the
// page's own handlers (toggle, submit, back) rather than the picker's UI.
jest.mock("@/app/feeds/_components/EpisodeSelectionStep", () => ({
  __esModule: true,
  default: ({
    preview,
    selectedGuids,
    existingGuids,
    addMoreMode,
    error,
    onToggleGuid,
    onToggleAll,
    onSubmit,
    onBackOrCancel,
  }: {
    preview: { episodes: { guid: string; title: string }[] };
    selectedGuids: Set<string>;
    existingGuids: Set<string>;
    addMoreMode: boolean;
    error: string | null;
    onToggleGuid: (g: string) => void;
    onToggleAll: (visibleGuids: string[]) => void;
    onSubmit: (e: React.FormEvent) => void;
    onBackOrCancel: () => void;
  }) => (
    <form onSubmit={onSubmit} data-testid="step2">
      <span data-testid="mode">{addMoreMode ? "add-more" : "selective"}</span>
      <span data-testid="selected">{Array.from(selectedGuids).sort().join(",")}</span>
      <span data-testid="existing">{Array.from(existingGuids).sort().join(",")}</span>
      {error && <p data-testid="error">{error}</p>}
      {preview.episodes.map((ep) => (
        <button key={ep.guid} type="button" data-testid={`t-${ep.guid}`} onClick={() => onToggleGuid(ep.guid)}>
          {ep.title}
        </button>
      ))}
      {/* #982: the real component passes the visible guids. Wiring this
          straight to onClick would hand toggleAll a MouseEvent instead. */}
      <button
        type="button"
        data-testid="toggle-all"
        onClick={() => onToggleAll(preview.episodes.map((e) => e.guid))}
      >
        All
      </button>
      <button type="submit" data-testid="submit">
        Submit
      </button>
      <button type="button" data-testid="back" onClick={onBackOrCancel}>
        Back
      </button>
    </form>
  ),
}));

import FeedsPage from "@/app/feeds/page";

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const FEED = {
  id: "f-1",
  url: "https://ex.com/feed.xml",
  title: "Show",
  mode: "selective",
  paused: false,
  last_polled_at: null,
  episode_count: 1,
};

const PREVIEW = {
  title: "Show",
  episodes: [
    { guid: "g-old", title: "Already have", published_at: null, duration: null },
    { guid: "g-new", title: "Brand new", published_at: null, duration: null },
  ],
};

interface Call {
  url: string;
  init?: RequestInit;
}

function installFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  const calls: Call[] = [];
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const path = url.split("?")[0];
    const h = handlers[path];
    if (!h) return Promise.resolve(json({ error: `no mock for ${path}` }, 500));
    return Promise.resolve(h(init));
  }) as unknown as typeof fetch;
  return calls;
}

async function openAddMore(calls: Call[]) {
  render(withQuery(<FeedsPage />));
  await waitFor(() => expect(screen.getByTestId("add-more-f-1")).toBeInTheDocument());
  await userEvent.click(screen.getByTestId("add-more-f-1"));
  await waitFor(() => expect(screen.getByTestId("step2")).toBeInTheDocument());
  return calls;
}

beforeEach(() => jest.clearAllMocks());

describe("/feeds — add-more flow", () => {
  test("preselects existing episodes and marks them as already present", async () => {
    const calls = installFetch({
      "/api/feeds": () => json([FEED]),
      "/api/feeds/preview": () => json(PREVIEW),
      "/api/feeds/f-1/episodes/guids": () => json(["g-old"]),
    });

    await openAddMore(calls);

    expect(screen.getByTestId("mode")).toHaveTextContent("add-more");
    expect(screen.getByTestId("existing")).toHaveTextContent("g-old");
    // Existing guids start selected so the picker can show them as checked.
    expect(screen.getByTestId("selected")).toHaveTextContent("g-old");
  });

  test("refuses to submit when nothing new was picked", async () => {
    const calls = installFetch({
      "/api/feeds": () => json([FEED]),
      "/api/feeds/preview": () => json(PREVIEW),
      "/api/feeds/f-1/episodes/guids": () => json(["g-old"]),
    });

    await openAddMore(calls);
    await userEvent.click(screen.getByTestId("submit"));

    expect(await screen.findByTestId("error")).toHaveTextContent(/at least one new episode/i);
    expect(calls.some((c) => c.url === "/api/feeds/f-1/episodes")).toBe(false);
  });

  test("POSTs only the newly selected guids", async () => {
    const calls = installFetch({
      "/api/feeds": () => json([FEED]),
      "/api/feeds/preview": () => json(PREVIEW),
      "/api/feeds/f-1/episodes/guids": () => json(["g-old"]),
      "/api/feeds/f-1/episodes": () => json({ added: 1 }, 202),
    });

    await openAddMore(calls);
    await userEvent.click(screen.getByTestId("t-g-new"));
    await userEvent.click(screen.getByTestId("submit"));

    await waitFor(() => {
      const post = calls.find((c) => c.url === "/api/feeds/f-1/episodes");
      expect(post).toBeDefined();
      // g-old is filtered out because the feed already has it.
      expect(JSON.parse(post!.init!.body as string)).toEqual({ selected_guids: ["g-new"] });
    });
  });

  test("surfaces the API detail when adding episodes fails", async () => {
    const calls = installFetch({
      "/api/feeds": () => json([FEED]),
      "/api/feeds/preview": () => json(PREVIEW),
      "/api/feeds/f-1/episodes/guids": () => json(["g-old"]),
      "/api/feeds/f-1/episodes": () => json({ detail: "feed is paused" }, 409),
    });

    await openAddMore(calls);
    await userEvent.click(screen.getByTestId("t-g-new"));
    await userEvent.click(screen.getByTestId("submit"));

    expect(await screen.findByTestId("error")).toHaveTextContent("feed is paused");
  });

  test("shows an error when the preview fetch fails", async () => {
    installFetch({
      "/api/feeds": () => json([FEED]),
      "/api/feeds/preview": () => json({ detail: "bad rss" }, 502),
      "/api/feeds/f-1/episodes/guids": () => json([]),
    });

    render(withQuery(<FeedsPage />));
    await waitFor(() => expect(screen.getByTestId("add-more-f-1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("add-more-f-1"));

    // Step 2 never opens; the dialog reports the failure instead.
    await waitFor(() => expect(screen.queryByTestId("step2")).not.toBeInTheDocument());
  });

  test("Back closes the add-more dialog", async () => {
    const calls = installFetch({
      "/api/feeds": () => json([FEED]),
      "/api/feeds/preview": () => json(PREVIEW),
      "/api/feeds/f-1/episodes/guids": () => json(["g-old"]),
    });

    await openAddMore(calls);
    await userEvent.click(screen.getByTestId("back"));

    await waitFor(() => expect(screen.queryByTestId("step2")).not.toBeInTheDocument());
  });

  test("toggle-all selects the episodes that are not already present", async () => {
    const calls = installFetch({
      "/api/feeds": () => json([FEED]),
      "/api/feeds/preview": () => json(PREVIEW),
      "/api/feeds/f-1/episodes/guids": () => json(["g-old"]),
    });

    await openAddMore(calls);
    await userEvent.click(screen.getByTestId("toggle-all"));

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("g-new"));
  });
});
