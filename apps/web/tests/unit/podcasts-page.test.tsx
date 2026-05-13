/**
 * @jest-environment jsdom
 */
/**
 * Tests for apps/web/src/app/podcasts/page.tsx (#670).
 *
 * Server component that runs two DB queries in parallel: getFeeds and
 * getUploadedEpisodes. The PodcastsList and UploadsSection children are
 * stubbed so this suite focuses on routing the query results into the
 * right branches (populated feeds, empty everything, uploads-only).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
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

jest.mock("@/components/PodcastsList", () => ({
  __esModule: true,
  default: ({ feeds }: { feeds: Array<{ id: string; title: string | null }> }) => (
    <ul data-testid="podcasts-list">
      {feeds.map((f) => (
        <li key={f.id}>{f.title ?? "(untitled)"}</li>
      ))}
    </ul>
  ),
}));

jest.mock("@/components/UploadsSection", () => ({
  __esModule: true,
  default: ({
    uploads,
    processed,
    total,
  }: {
    uploads: Array<{ id: string }>;
    processed: number;
    total: number;
  }) => (
    <section data-testid="uploads-section">
      <p data-testid="uploads-counts">{`${processed}/${total}`}</p>
      <ul>
        {uploads.map((u) => (
          <li key={u.id}>{u.id}</li>
        ))}
      </ul>
    </section>
  ),
}));

import SourcesPage from "@/app/podcasts/page";

beforeEach(() => {
  mockQuery.mockReset();
});

function setQueryResults(
  feedRows: unknown[],
  uploadRows: Array<{ id: string; status: string }>,
) {
  mockQuery
    // getFeeds: the SELECT ... FROM feeds ... is the first call
    .mockResolvedValueOnce({ rows: feedRows })
    // getUploadedEpisodes: the SELECT ... FROM episodes WHERE feed_id IS NULL is the second
    .mockResolvedValueOnce({ rows: uploadRows });
}

describe("SourcesPage (/podcasts)", () => {
  it("renders the populated podcasts list and uploads section", async () => {
    setQueryResults(
      [
        {
          id: "f-1",
          title: "Feed A",
          description: "",
          image_url: null,
          mode: "full",
          last_polled_at: null,
          episode_count: 5,
          processed_count: 4,
        },
        {
          id: "f-2",
          title: null,
          description: "",
          image_url: null,
          mode: "test",
          last_polled_at: null,
          episode_count: 1,
          processed_count: 1,
        },
      ],
      [
        { id: "u-1", status: "done" },
        { id: "u-2", status: "pending" },
      ],
    );

    const ui = await SourcesPage();
    render(ui);

    expect(screen.getByTestId("podcasts-list")).toBeInTheDocument();
    expect(screen.getByText("Feed A")).toBeInTheDocument();
    expect(screen.getByText("(untitled)")).toBeInTheDocument();

    // Uploads section sees the rows with the processed/total derived from status.
    expect(screen.getByTestId("uploads-counts")).toHaveTextContent("1/2");
    expect(screen.getByText("u-1")).toBeInTheDocument();
    expect(screen.getByText("u-2")).toBeInTheDocument();
  });

  it("shows the empty-everything CTA when there are no feeds and no uploads", async () => {
    setQueryResults([], []);

    const ui = await SourcesPage();
    render(ui);

    expect(screen.queryByTestId("podcasts-list")).not.toBeInTheDocument();
    expect(screen.getByText(/no sources yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /add your first rss feed/i }),
    ).toHaveAttribute("href", "/feeds");
    // Uploads section is still rendered (with zero rows) below the Separator.
    expect(screen.getByTestId("uploads-section")).toBeInTheDocument();
    expect(screen.getByTestId("uploads-counts")).toHaveTextContent("0/0");
  });

  it("renders just the uploads section when only manual uploads exist", async () => {
    setQueryResults(
      [],
      [
        { id: "u-only", status: "done" },
      ],
    );

    const ui = await SourcesPage();
    render(ui);

    expect(screen.queryByTestId("podcasts-list")).not.toBeInTheDocument();
    // The "No sources yet" CTA is suppressed once any source exists.
    expect(screen.queryByText(/no sources yet/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("uploads-counts")).toHaveTextContent("1/1");
  });
});
