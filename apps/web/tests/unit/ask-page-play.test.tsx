/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockPlayEpisode = jest.fn();

jest.mock("@/components/AudioPlayerContext", () => ({
  useAudioPlayer: () => ({
    playEpisode: mockPlayEpisode,
  }),
}));

jest.mock("next/link", () => {
  function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  MockLink.displayName = "MockLink";
  return MockLink;
});

import AskPage from "@/app/ask/page";
import { saveAskSnapshot } from "@/lib/page-state";

type AskPageSnapshot = Parameters<typeof saveAskSnapshot>[0];

describe("Ask page source card actions", () => {
  beforeEach(() => {
    mockPlayEpisode.mockReset();
    sessionStorage.clear();

    const snapshot: AskPageSnapshot = {
      question: "What happened?",
      answer: "Here is an answer.",
      sources: [
        {
          chunk_id: 1,
          episode_id: "ep-42",
          episode_title: "Episode 42",
          speaker_label: "HOST",
          start_time: 125,
          end_time: 140,
          timestamp: "2:05",
          text: "Important excerpt",
          similarity: 0.95,
          audio_local_path: "/data/audio/archive/ep42.mp3",
        },
      ],
      status: "done",
      errorMsg: "",
      model: "qwen2.5:3b",
      selectedFeedIds: [],
    };
    saveAskSnapshot(snapshot, sessionStorage);

    global.fetch = jest.fn((url: string) => {
      if (url === "/api/feeds") {
        return Promise.resolve({
          json: async () => [],
        } as Response);
      }
      if (url === "/api/ask/coverage") {
        return Promise.resolve({
          json: async () => ({ processed: 1, total: 1, has_manual_uploads: false }),
        } as Response);
      }
      return Promise.resolve({ json: async () => ({}) } as Response);
    }) as jest.Mock;
  });

  test("play button starts embedded playback and title remains link to episode page", async () => {
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(<AskPage />);

    const episodeLink = screen.getByRole("link", { name: "Episode 42" });
    expect(episodeLink).toHaveAttribute("href", "/episodes/ep-42#t-125");

    fireEvent.click(screen.getByTitle("Play from this point"));

    expect(mockPlayEpisode).toHaveBeenCalledWith(
      "ep-42",
      "ep42.mp3",
      125,
      "Episode 42"
    );
    expect(openSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    openSpy.mockRestore();
  });
});
