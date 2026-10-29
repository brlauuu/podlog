/**
 * The podcast page hands its feed to the feed controls and shows the mode
 * badges the controls depend on (#1090).
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockQuery = jest.fn();
const mockControls = jest.fn((_props?: unknown) => <div data-testid="feed-controls" />);

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("notFound");
  }),
}));

jest.mock("@/components/EpisodesList", () => ({
  __esModule: true,
  default: () => <div data-testid="episodes-list" />,
}));

jest.mock("@/components/PodcastFeedControls", () => ({
  __esModule: true,
  default: (props: unknown) => mockControls(props),
}));

import PodcastPage from "@/app/podcasts/[id]/page";

const FEED = {
  id: "feed-1",
  title: "Feed One",
  description: null,
  image_url: null,
  website_url: null,
  url: "https://ex.com/feed.xml",
  mode: "selective",
  paused: false,
};

async function renderPage(feed: typeof FEED) {
  mockQuery.mockResolvedValueOnce({ rows: [feed] }).mockResolvedValueOnce({ rows: [] });
  render(await PodcastPage({ params: Promise.resolve({ id: feed.id }) }));
}

describe("Podcast page feed controls", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockControls.mockClear();
  });

  it("reads the feed's url and paused state and passes the feed to the controls", async () => {
    await renderPage(FEED);

    expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringMatching(/\burl\b.*\bpaused\b/), ["feed-1"]);
    expect(screen.getByTestId("feed-controls")).toBeInTheDocument();
    expect(mockControls).toHaveBeenCalledWith(expect.objectContaining({ feed: FEED }));
  });

  it("shows the Selective badge for a selective feed", async () => {
    await renderPage(FEED);

    expect(screen.getByText("Selective")).toBeInTheDocument();
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
  });

  it("shows the Paused badge for a paused feed", async () => {
    await renderPage({ ...FEED, mode: "full", paused: true });

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByText("Selective")).not.toBeInTheDocument();
  });
});
