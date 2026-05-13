/**
 * @jest-environment jsdom
 */
/**
 * Tests for FeedGroupCard (#673).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

jest.mock("next/link", () => {
  const Link = ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  );
  Link.displayName = "Link";
  return { __esModule: true, default: Link };
});

// EpisodeMentionList does its own network calls; replace with a stub so
// this suite stays focused on the card behavior.
jest.mock("@/components/EpisodeMentionList", () => ({
  __esModule: true,
  default: ({ episodeId }: { episodeId: string }) => (
    <div data-testid={`mentions-${episodeId}`}>mentions for {episodeId}</div>
  ),
}));

import FeedGroupCard from "@/components/FeedGroupCard";
import type { FeedGroup } from "@/lib/search";

const baseFeed: FeedGroup = {
  feedId: "f-1",
  feedTitle: "The Daily",
  feedMode: "full",
  mentionCount: 5,
  episodes: [
    {
      episodeId: "ep-1",
      episodeTitle: "Climate special",
      episodeUrl: "/episodes/ep-1",
      audioUrl: null,
      audioLocalPath: null,
      mentionCount: 3,
    },
    {
      episodeId: "ep-2",
      episodeTitle: "Politics roundup",
      episodeUrl: "/episodes/ep-2",
      audioUrl: null,
      audioLocalPath: null,
      mentionCount: 2,
    },
  ],
};

describe("FeedGroupCard", () => {
  it("renders the feed header with mention/episode counts", () => {
    render(<FeedGroupCard feed={baseFeed} query="climate" />);
    expect(screen.getByText("The Daily")).toBeInTheDocument();
    expect(screen.getByText(/5 mentions in 2 episodes/i)).toBeInTheDocument();
    expect(screen.queryByText(/Test/i)).not.toBeInTheDocument();
  });

  it("shows a Test badge for test-mode feeds and singular nouns when counts are 1", () => {
    render(
      <FeedGroupCard
        feed={{
          ...baseFeed,
          feedMode: "test",
          mentionCount: 1,
          episodes: [baseFeed.episodes[0]],
        }}
        query=""
      />,
    );
    expect(screen.getByText(/Test/)).toBeInTheDocument();
    expect(screen.getByText(/1 mention in 1 episode/i)).toBeInTheDocument();
  });

  it("toggles the per-episode mentions list on click", async () => {
    render(<FeedGroupCard feed={baseFeed} query="climate" />);
    expect(screen.queryByTestId("mentions-ep-1")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Climate special"));
    expect(screen.getByTestId("mentions-ep-1")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Climate special"));
    expect(screen.queryByTestId("mentions-ep-1")).not.toBeInTheDocument();
  });

  it("links to the episode page with the q= search context preserved", () => {
    render(<FeedGroupCard feed={baseFeed} query="climate change" />);
    const links = screen.getAllByTitle("Go to episode");
    expect(links[0]).toHaveAttribute(
      "href",
      "/episodes/ep-1?q=climate%20change",
    );
  });
});
