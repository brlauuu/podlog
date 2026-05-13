/**
 * Tests for apps/web/src/app/search/print/page.tsx (#671).
 *
 * The page renders a complete <html>...</html> document for the print
 * flow, so the suite uses renderToStaticMarkup and asserts on the
 * serialized HTML rather than mounting it into a jsdom document.
 *
 * @jest-environment node
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mockSearchGrouped = jest.fn();
const mockSearchMentions = jest.fn();
const mockNotFound = jest.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

jest.mock("@/lib/search", () => ({
  searchGrouped: (...args: unknown[]) => mockSearchGrouped(...args),
  searchMentions: (...args: unknown[]) => mockSearchMentions(...args),
}));
jest.mock("next/navigation", () => ({
  notFound: () => mockNotFound(),
}));
jest.mock("./../../src/app/search/print/PrintButton", () => ({
  __esModule: true,
  default: () => <button data-testid="print-btn">Print</button>,
}));

import PrintPage from "@/app/search/print/page";

beforeEach(() => {
  mockSearchGrouped.mockReset();
  mockSearchMentions.mockReset();
  mockNotFound.mockClear();
});

describe("/search/print", () => {
  it("404s when no query is provided", async () => {
    await expect(
      // @ts-expect-error — exercising the missing-q path
      PrintPage({ searchParams: {} }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("404s when the search returns zero matching feeds", async () => {
    mockSearchGrouped.mockResolvedValue({
      feeds: [],
      totalMentions: 0,
      totalEpisodes: 0,
    });

    await expect(PrintPage({ searchParams: { q: "nope" } })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("renders the print report with episode + mention markup", async () => {
    mockSearchGrouped.mockResolvedValue({
      feeds: [
        {
          feedTitle: "The Daily",
          episodes: [
            {
              episodeId: "ep-1",
              episodeTitle: "About climate",
              episodeUrl: "/episodes/ep-1",
              audioUrl: "https://cdn.example/a.mp3",
              mentionCount: 2,
            },
          ],
        },
      ],
      totalMentions: 2,
      totalEpisodes: 1,
    });
    mockSearchMentions.mockResolvedValue({
      mentions: [
        {
          startTime: 65,
          speakerDisplay: "Host",
          snippet: "We talked about <b>climate</b> change.",
          contextBefore: [
            {
              startTime: 60,
              speakerDisplay: "Guest",
              text: "Let me set this up.",
            },
          ],
          contextAfter: [
            {
              startTime: 70,
              speakerDisplay: "Host",
              text: "...and the implications.",
            },
          ],
        },
      ],
    });

    const node = await PrintPage({ searchParams: { q: "climate" } });
    const html = renderToStaticMarkup(node as React.ReactElement);

    // Top-of-page header carries the query and counts.
    expect(html).toContain("Podlog Search Report");
    expect(html).toContain("“climate”");
    expect(html).toContain("2 mentions across");
    expect(html).toContain("1");
    expect(html).toContain("episodes");

    // Per-episode block
    expect(html).toContain("About climate");
    expect(html).toContain("The Daily");
    expect(html).toContain(`href="/episodes/ep-1"`);
    expect(html).toContain(`href="https://cdn.example/a.mp3"`);

    // Mention card: matched snippet (with its <b> kept), and the
    // before/after context.
    expect(html).toContain("Mention 1");
    expect(html).toContain("We talked about <b>climate</b> change");
    expect(html).toContain("Let me set this up.");
    expect(html).toContain("...and the implications.");

    // PrintButton stub is mounted.
    expect(html).toContain('data-testid="print-btn"');
  });

  it("falls back to 'Speaker' when the mention has no display name", async () => {
    mockSearchGrouped.mockResolvedValue({
      feeds: [
        {
          feedTitle: "Show",
          episodes: [
            {
              episodeId: "ep-1",
              episodeTitle: "Untitled",
              episodeUrl: null,
              audioUrl: null,
              mentionCount: 1,
            },
          ],
        },
      ],
      totalMentions: 1,
      totalEpisodes: 1,
    });
    mockSearchMentions.mockResolvedValue({
      mentions: [
        {
          startTime: 0,
          speakerDisplay: null,
          snippet: "<b>hi</b>",
          contextBefore: [],
          contextAfter: [],
        },
      ],
    });

    const node = await PrintPage({ searchParams: { q: "hi" } });
    const html = renderToStaticMarkup(node as React.ReactElement);

    expect(html).toContain(">Speaker [");
  });
});
