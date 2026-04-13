/**
 * @jest-environment jsdom
 */
import React from "react";

const mockQuery = jest.fn();
const mockEpisodesList = jest.fn((_props?: unknown) => <div data-testid="episodes-list" />);

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
  default: (props: unknown) => mockEpisodesList(props),
}));

import PodcastPage from "@/app/podcasts/[id]/page";

describe("Podcast page speaker metadata", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEpisodesList.mockClear();
  });

  it("filters speaker_name_tags to labels that still exist in episode segments", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "feed-1", title: "Feed One", image_url: null, website_url: null, mode: "live" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await PodcastPage({ params: Promise.resolve({ id: "feed-1" }) });

    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("FROM speaker_names sn"), ["feed-1"]);
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("EXISTS ("), ["feed-1"]);
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("s2.speaker_label = sn.speaker_label"), ["feed-1"]);
  });
});
