/**
 * @jest-environment jsdom
 */
/**
 * Tests for the SearchResult card (#673).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

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

import SearchResult from "@/components/SearchResult";
import type { SearchResult as SearchResultType } from "@/lib/search";

function baseResult(overrides: Partial<SearchResultType> = {}): SearchResultType {
  return {
    id: 1,
    episodeId: "ep-1",
    feedTitle: "The Daily",
    feedMode: "full",
    episodeTitle: "Climate special",
    speakerDisplay: "Host",
    startTime: 75,
    snippet: "Short snippet",
    audioLocalPath: null,
    audioUrl: null,
    hasDiarization: true,
    ...overrides,
  } as SearchResultType;
}

beforeEach(() => {
  playEpisode.mockReset();
});

describe("SearchResult", () => {
  it("renders feed + episode title and speaker timestamp", () => {
    render(<SearchResult result={baseResult()} />);
    expect(screen.getByText("The Daily")).toBeInTheDocument();
    expect(screen.getByText("Climate special")).toBeInTheDocument();
    expect(screen.getByText(/Host · 1:15/i)).toBeInTheDocument();
  });

  it("shows the Test badge for test-mode feeds and No-labels badge when diarization is missing", () => {
    render(
      <SearchResult
        result={baseResult({ feedMode: "test", hasDiarization: false })}
      />,
    );
    expect(screen.getByText(/Test/)).toBeInTheDocument();
    expect(screen.getByText(/No labels/i)).toBeInTheDocument();
  });

  it("expands a long snippet via Show more", async () => {
    render(
      <SearchResult result={baseResult({ snippet: "a".repeat(600) })} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(
      screen.getByRole("button", { name: /show less/i }),
    ).toBeInTheDocument();
  });

  it("renders Play and triggers playEpisode when local audio is present", async () => {
    render(
      <SearchResult
        result={baseResult({
          audioLocalPath: "/data/audio/archive/ep-1/audio.mp3",
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(playEpisode).toHaveBeenCalledWith(
      "ep-1",
      "audio.mp3",
      75,
      "Climate special",
      "The Daily",
    );
  });

  it("renders the RSS audio link when audioUrl is provided", () => {
    render(
      <SearchResult
        result={baseResult({ audioUrl: "https://cdn.example/a.mp3" })}
      />,
    );
    const link = screen.getByTitle("Listen on RSS audio at this timestamp");
    expect(link).toHaveAttribute(
      "href",
      "https://cdn.example/a.mp3#t=75",
    );
  });
});
