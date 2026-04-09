/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/AudioPlayerContext", () => ({
  useAudioPlayer: () => ({
    playEpisode: jest.fn(),
  }),
}));

const requestAnimationFrameMock = jest.fn((cb: FrameRequestCallback) => {
  cb(0);
  return 1;
});

beforeEach(() => {
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: requestAnimationFrameMock,
  });
  requestAnimationFrameMock.mockClear();
  window.history.replaceState({}, "", "/episodes/ep-42#t-125");
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

import TranscriptView from "@/components/TranscriptView";
import type { Segment } from "@/lib/types";

describe("TranscriptView deep link handling", () => {
  test("scrolls to the nearest segment when loaded with a timestamp hash", async () => {
    const scrollIntoView = jest.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const segments: Segment[] = [
      {
        id: 1,
        start_time: 120,
        end_time: 130,
        speaker_label: "HOST",
        display_name: "Host",
        inferred: false,
        confirmed_by_user: false,
        text: "First segment",
      },
      {
        id: 2,
        start_time: 150,
        end_time: 160,
        speaker_label: "HOST",
        display_name: "Host",
        inferred: false,
        confirmed_by_user: false,
        text: "Second segment",
      },
    ];

    try {
      render(
        <TranscriptView
          episodeId="ep-42"
          hasDiarization={true}
          status="done"
          segments={segments}
          audioLocalPath="/data/audio/archive/ep42.mp3"
          episodeTitle="Episode 42"
          feedTitle="Feed One"
        />
      );

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
      });
      expect(document.getElementById("t-120")).toBeTruthy();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
