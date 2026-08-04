/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { Segment } from "@/lib/types";

const mockPlayEpisode = jest.fn();
jest.mock("@/components/AudioPlayerContext", () => ({
  useAudioPlayer: () => ({ playEpisode: mockPlayEpisode }),
}));

import TranscriptView from "@/components/TranscriptView";

function seg(overrides: Partial<Segment>): Segment {
  return {
    id: 1,
    start_time: 0,
    end_time: 5,
    speaker_label: "HOST",
    display_name: "Host",
    inferred: false,
    confirmed_by_user: false,
    text: "text",
    ...overrides,
  } as Segment;
}

beforeEach(() => {
  mockPlayEpisode.mockClear();
});

describe("TranscriptView — activeSpeaker filter", () => {
  it("renders only the active speaker's segments", () => {
    const segments = [
      seg({ id: 1, start_time: 10, speaker_label: "HOST", display_name: "Host", text: "host line" }),
      seg({ id: 2, start_time: 20, speaker_label: "GUEST", display_name: "Guest", text: "guest line" }),
    ];

    render(
      <TranscriptView
        episodeId="ep-1"
        hasDiarization={true}
        status="done"
        segments={segments}
        audioLocalPath="/data/audio/archive/ep1.mp3"
        episodeTitle="Ep 1"
        feedTitle="Feed"
        activeSpeaker="HOST"
      />
    );

    expect(screen.getByText("host line")).toBeInTheDocument();
    expect(screen.queryByText("guest line")).not.toBeInTheDocument();
  });
});

describe("TranscriptView — timestamp playback", () => {
  it("plays from the clicked timestamp in the no-diarization layout", () => {
    const segments = [seg({ id: 1, start_time: 30, text: "plain line" })];

    render(
      <TranscriptView
        episodeId="ep-1"
        hasDiarization={false}
        status="done"
        segments={segments}
        audioLocalPath="/data/audio/archive/ep1.mp3"
        episodeTitle="Ep 1"
        feedTitle="Feed"
      />
    );

    fireEvent.click(screen.getByTitle("Play from here"));

    expect(mockPlayEpisode).toHaveBeenCalledWith("ep-1", "ep1.mp3", 30, "Ep 1", "Feed");
  });

  it("plays from both the group header and per-sentence timestamps when diarized", () => {
    const segments = [
      seg({ id: 1, start_time: 10, text: "first" }),
      seg({ id: 2, start_time: 20, text: "second" }),
    ];

    render(
      <TranscriptView
        episodeId="ep-1"
        hasDiarization={true}
        status="done"
        segments={segments}
        audioLocalPath="/data/audio/archive/ep1.mp3"
        episodeTitle="Ep 1"
        feedTitle="Feed"
      />
    );

    const buttons = screen.getAllByTitle("Play from here");
    // Header timestamp (firstSeg=10) + the j>0 per-sentence timestamp (20).
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    expect(mockPlayEpisode).toHaveBeenCalledWith("ep-1", "ep1.mp3", 10, "Ep 1", "Feed");
    expect(mockPlayEpisode).toHaveBeenCalledWith("ep-1", "ep1.mp3", 20, "Ep 1", "Feed");
  });
});

describe("TranscriptView — scroll-to-time event", () => {
  it("scrolls to the nearest segment on a podlog:scroll-to-time event", () => {
    const scrollIntoView = jest.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      render(
        <TranscriptView
          episodeId="ep-1"
          hasDiarization={false}
          status="done"
          segments={[seg({ id: 1, start_time: 120, text: "target" })]}
          audioLocalPath={null}
          episodeTitle="Ep 1"
          feedTitle="Feed"
        />
      );

      fireEvent(
        window,
        new CustomEvent("podlog:scroll-to-time", { detail: { secs: 120 } })
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
