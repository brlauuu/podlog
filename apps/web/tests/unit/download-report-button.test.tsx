/**
 * Tests for DownloadReportButton — dropdown of export actions.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import DownloadReportButton from "@/components/DownloadReportButton";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const mockOpen = jest.fn();
const origOpen = window.open;

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalAnchorClick = HTMLAnchorElement.prototype.click;

const createObjectURL = jest.fn(() => "blob:mock");
const revokeObjectURL = jest.fn();
const anchorClick = jest.fn();

beforeAll(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  HTMLAnchorElement.prototype.click = anchorClick;
  (window as { open: typeof mockOpen }).open = mockOpen;
});

afterAll(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  (window as { open: typeof origOpen }).open = origOpen;
});

beforeEach(() => {
  mockFetch.mockReset();
  mockOpen.mockClear();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  anchorClick.mockClear();
});

const sampleFlat = [
  {
    id: "seg-1",
    episodeId: "ep-1",
    episodeTitle: "Ep 1",
    feedTitle: "Feed A",
    episodeUrl: null,
    audioUrl: null,
    startTime: 10,
    endTime: 20,
    speakerLabel: "SPEAKER_00",
    speakerDisplay: "Host",
    snippet: "hello",
    text: "hello",
    rank: 1,
  },
];

describe("DownloadReportButton", () => {
  it("renders null when there are no results", () => {
    const { container } = render(
      <DownloadReportButton query="x" flatResults={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the export dropdown when flat results are present", async () => {
    render(<DownloadReportButton query="climate" flatResults={sampleFlat} />);
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("renders when grouped results have at least one feed", () => {
    render(
      <DownloadReportButton
        query="x"
        groupedResults={{
          feeds: [
            {
              feedId: "f1",
              feedTitle: "Feed",
              feedMode: "full",
              episodes: [],
              totalMentions: 0,
            },
          ],
          totalFeeds: 1,
          totalEpisodes: 0,
          totalMentions: 0,
          coverage: {
            totalFeedsIndexed: 0,
            totalEpisodesIndexed: 0,
            indexedSpeakerCount: 0,
            totalSegments: 0,
          },
        }}
      />
    );
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("print export opens the print route in a new window", async () => {
    const user = userEvent.setup();
    render(<DownloadReportButton query="climate" flatResults={sampleFlat} />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByText("Print / PDF"));

    expect(mockOpen).toHaveBeenCalledWith(
      "/search/print?q=climate",
      "_blank"
    );
  });

  it("markdown export fetches and downloads a .md blob", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: sampleFlat }),
    });

    const user = userEvent.setup();
    render(<DownloadReportButton query="climate" flatResults={sampleFlat} />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByText("Markdown (.md)"));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalled();
    });
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("q=climate"));
  });

  it("plain text export fetches and downloads a .txt blob", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: sampleFlat }),
    });

    const user = userEvent.setup();
    render(<DownloadReportButton query="climate" flatResults={sampleFlat} />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByText("Plain Text (.txt)"));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
    });
  });

  it("logs and does not crash when fetch throws during export", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("network"));

    const user = userEvent.setup();
    render(<DownloadReportButton query="climate" flatResults={sampleFlat} />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByText("Markdown (.md)"));

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Export failed:",
        expect.any(Error)
      );
    });
    consoleErrorSpy.mockRestore();
  });
});
