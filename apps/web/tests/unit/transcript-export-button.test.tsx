/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TranscriptExportButton from "@/components/TranscriptExportButton";

const baseProps = {
  episodeTitle: "Example Episode",
  feedTitle: "Example Podcast",
  publishedAt: "2026-01-02T00:00:00.000Z",
  durationSecs: 1800,
  description: "Episode description",
  feedUrl: "https://example.com/feed.xml",
  feedWebsiteUrl: "https://example.com",
  feedDescription: "Feed description",
  audioUrl: "https://cdn.example.com/audio.mp3",
  guid: "guid-1",
  segments: [
    {
      id: 1,
      start_time: 12,
      end_time: 15,
      speaker_label: "SPEAKER_00",
      display_name: "Host",
      inferred: false,
      confirmed_by_user: true,
      text: "Hello world",
    },
  ],
};

describe("TranscriptExportButton", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  const createObjectURL = jest.fn(() => "blob:mock");
  const revokeObjectURL = jest.fn();
  const anchorClick = jest.fn();
  const openSpy = jest.spyOn(window, "open");
  const appendSpy = jest.spyOn(document.body, "appendChild");
  const removeSpy = jest.spyOn(document.body, "removeChild");

  beforeEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    HTMLAnchorElement.prototype.click = anchorClick;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    anchorClick.mockClear();
    openSpy.mockReset();
    appendSpy.mockClear();
    removeSpy.mockClear();
  });

  afterAll(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    openSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("exports markdown as .md", async () => {
    const user = userEvent.setup();
    render(<TranscriptExportButton {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByText("Markdown (.md)"));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    });
  });

  it("exports plain text as .txt", async () => {
    const user = userEvent.setup();
    render(<TranscriptExportButton {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByText("Plain Text (.txt)"));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    });
  });

  it("opens print window for pdf export path", async () => {
    const user = userEvent.setup();
    const print = jest.fn();
    const focus = jest.fn();
    const docOpen = jest.fn();
    const docWrite = jest.fn();
    const docClose = jest.fn();
    openSpy.mockReturnValue({
      document: {
        open: docOpen,
        write: docWrite,
        close: docClose,
      },
      focus,
      print,
    } as unknown as Window);

    render(<TranscriptExportButton {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByText("Print / PDF"));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith("", "_blank");
      expect(docOpen).toHaveBeenCalled();
      expect(docWrite).toHaveBeenCalled();
      expect(docClose).toHaveBeenCalled();
      expect(focus).toHaveBeenCalled();
      expect(print).toHaveBeenCalled();
    });
  });
});
