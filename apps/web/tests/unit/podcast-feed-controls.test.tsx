/**
 * Feed actions on the podcast page (#1090).
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import PodcastFeedControls from "@/components/PodcastFeedControls";

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

interface Call {
  url: string;
  init?: RequestInit;
}

function installFetch(handlers: Record<string, () => Response>) {
  const calls: Call[] = [];
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const h = handlers[url.split("?")[0]];
    return Promise.resolve(h ? h() : json({ error: "no mock" }, 500));
  }) as unknown as typeof fetch;
  return calls;
}

const BASE = { id: "f-1", url: "https://ex.com/feed.xml", title: "Show", paused: false };
const SELECTIVE = { ...BASE, mode: "selective" };
const FULL = { ...BASE, mode: "full" };

let confirmSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => confirmSpy.mockRestore());

describe("PodcastFeedControls", () => {
  test("a selective feed offers Add episodes and Promote, not poll/pause/delete", () => {
    render(withQuery(<PodcastFeedControls feed={SELECTIVE} />));
    const controls = screen.getByTestId("podcast-feed-controls");

    expect(within(controls).getByRole("button", { name: /add episodes/i })).toBeInTheDocument();
    expect(within(controls).getByRole("button", { name: /promote to full/i })).toBeInTheDocument();
    expect(screen.queryByTitle("Poll now")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Pause ingestion")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Remove feed")).not.toBeInTheDocument();
  });

  test("a full feed offers Make selective, Poll and Pause, but never Delete", () => {
    render(withQuery(<PodcastFeedControls feed={FULL} />));

    expect(screen.getByRole("button", { name: /make selective/i })).toBeInTheDocument();
    expect(screen.getByTitle("Poll now")).toBeInTheDocument();
    expect(screen.getByTitle("Pause ingestion")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /promote to full/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Remove feed")).not.toBeInTheDocument();
  });

  test("Add episodes opens the picker for this feed and refreshes the page after adding", async () => {
    const calls = installFetch({
      "/api/feeds/preview": () =>
        json({
          title: "Show",
          episodes: [
            { guid: "g-old", title: "Already have", published_at: null, duration_secs: null, audio_url: "a" },
            { guid: "g-new", title: "Brand new", published_at: null, duration_secs: null, audio_url: "b" },
          ],
        }),
      "/api/feeds/f-1/episodes/guids": () => json(["g-old"]),
      "/api/feeds/f-1/episodes": () => json({ added: 1 }, 202),
    });
    render(withQuery(<PodcastFeedControls feed={SELECTIVE} />));

    await userEvent.click(screen.getByRole("button", { name: /add episodes/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Add episodes — Show");
    await userEvent.click(await within(dialog).findByText("Brand new"));
    await userEvent.click(within(dialog).getByRole("button", { name: /add 1 episode/i }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    const post = calls.find((c) => c.url === "/api/feeds/f-1/episodes");
    expect(JSON.parse(post!.init!.body as string)).toEqual({ selected_guids: ["g-new"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("Promote asks first, posts full mode, then refreshes the page", async () => {
    const calls = installFetch({ "/api/feeds": () => json({ id: "f-1" }) });
    render(withQuery(<PodcastFeedControls feed={SELECTIVE} />));

    await userEvent.click(screen.getByRole("button", { name: /promote to full/i }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalled();
    const post = calls.find((c) => c.url === "/api/feeds");
    expect(JSON.parse(post!.init!.body as string)).toEqual({ url: SELECTIVE.url, mode: "full" });
  });

  test("a declined confirm sends nothing", async () => {
    confirmSpy.mockReturnValue(false);
    const calls = installFetch({});
    render(withQuery(<PodcastFeedControls feed={FULL} />));

    await userEvent.click(screen.getByRole("button", { name: /make selective/i }));

    expect(calls).toHaveLength(0);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test("Pause PATCHes the feed and refreshes the page", async () => {
    const calls = installFetch({ "/api/feeds/f-1": () => json({ id: "f-1", paused: true }) });
    render(withQuery(<PodcastFeedControls feed={FULL} />));

    await userEvent.click(screen.getByTitle("Pause ingestion"));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(patch!.init!.body as string)).toEqual({ paused: true });
  });
});
