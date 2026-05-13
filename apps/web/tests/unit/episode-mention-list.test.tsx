/**
 * @jest-environment jsdom
 */
/**
 * Tests for EpisodeMentionList (#673). Drives the React Query fetch
 * stack to validate the loading skeleton, empty result message,
 * mention card rendering, the "Show more" expander on long snippets,
 * and the Play button → audio player wiring.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const playEpisode = jest.fn();
jest.mock("@/components/AudioPlayerContext", () => ({
  useAudioPlayer: () => ({ playEpisode }),
}));

jest.mock("next/link", () => {
  const Link = ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>;
  Link.displayName = "Link";
  return { __esModule: true, default: Link };
});

import EpisodeMentionList from "@/components/EpisodeMentionList";

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function jsonResp(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  playEpisode.mockReset();
});

describe("EpisodeMentionList", () => {
  it("renders a loading skeleton while the query is in flight", () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    const { container } = render(
      withQuery(
        <EpisodeMentionList
          query="climate"
          episodeId="ep-1"
          episodeTitle="t"
          feedTitle="f"
          audioLocalPath={null}
        />,
      ),
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
  });

  it("shows the no-mentions message when the API returns an empty list", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(jsonResp({ mentions: [] })),
    ) as unknown as typeof fetch;

    render(
      withQuery(
        <EpisodeMentionList
          query="climate"
          episodeId="ep-1"
          episodeTitle="t"
          feedTitle="f"
          audioLocalPath={null}
        />,
      ),
    );
    expect(await screen.findByText(/no mentions found/i)).toBeInTheDocument();
  });

  it("renders mention cards and toggles long snippets via Show more", async () => {
    const longSnippet = "a".repeat(600);
    global.fetch = jest.fn(() =>
      Promise.resolve(
        jsonResp({
          mentions: [
            {
              id: 1,
              startTime: 30,
              speakerDisplay: "Host",
              snippet: longSnippet,
              contextBefore: [],
              contextAfter: [],
            },
          ],
        }),
      ),
    ) as unknown as typeof fetch;

    render(
      withQuery(
        <EpisodeMentionList
          query="climate"
          episodeId="ep-1"
          episodeTitle="Climate"
          feedTitle="The Daily"
          audioLocalPath={null}
        />,
      ),
    );

    expect(await screen.findByText(/Mention 1 of 1/)).toBeInTheDocument();
    expect(screen.getByText("Host:")).toBeInTheDocument();

    const showMore = screen.getByRole("button", { name: /show more/i });
    await userEvent.click(showMore);
    expect(
      screen.getByRole("button", { name: /show less/i }),
    ).toBeInTheDocument();
  });

  it("calls playEpisode when Play is clicked on a card that has local audio", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        jsonResp({
          mentions: [
            {
              id: 1,
              startTime: 30,
              speakerDisplay: null,
              snippet: "short",
              contextBefore: [],
              contextAfter: [],
            },
          ],
        }),
      ),
    ) as unknown as typeof fetch;

    render(
      withQuery(
        <EpisodeMentionList
          query="climate"
          episodeId="ep-1"
          episodeTitle="Climate"
          feedTitle="The Daily"
          audioLocalPath="/data/audio/archive/ep-1/audio.mp3"
        />,
      ),
    );

    const playBtn = await screen.findByRole("button", { name: /play/i });
    await userEvent.click(playBtn);
    expect(playEpisode).toHaveBeenCalledWith(
      "ep-1",
      "audio.mp3",
      30,
      "Climate",
      "The Daily",
    );
  });
});
