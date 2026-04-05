import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";

jest.mock("lucide-react", () => {
  const Icon = ({ "data-testid": testId }: { "data-testid"?: string }) => (
    <svg data-testid={testId} />
  );

  return {
    Play: () => <Icon data-testid="play-icon" />,
    Pause: () => <Icon data-testid="pause-icon" />,
    Volume2: () => <Icon data-testid="volume2-icon" />,
    VolumeX: () => <Icon data-testid="volumex-icon" />,
    ChevronUp: () => <Icon data-testid="chevronup-icon" />,
    ChevronDown: () => <Icon data-testid="chevrondown-icon" />,
    SkipBack: () => <Icon data-testid="skipback-icon" />,
    SkipForward: () => <Icon data-testid="skipforward-icon" />,
    X: () => <Icon data-testid="x-icon" />,
  };
});

import AudioPlayer from "@/components/AudioPlayer";
import { AudioPlayerProvider, useAudioPlayer } from "@/components/AudioPlayerContext";

function TriggerPlayback() {
  const { playEpisode } = useAudioPlayer();

  return (
    <button
      onClick={() => playEpisode("ep-1", "episode.mp3", 5, "Episode 1", "Podcast 1")}
      type="button"
    >
      Trigger playback
    </button>
  );
}

describe("AudioPlayer", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: jest.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value: jest.fn(),
    });
  });

  test("shows elapsed time and duration after playback is triggered", async () => {
    render(
      <AudioPlayerProvider>
        <TriggerPlayback />
        <AudioPlayer />
      </AudioPlayerProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger playback" }));

    const audio = document.querySelector("audio");
    expect(audio).not.toBeNull();

    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 125,
    });

    await act(async () => {
      fireEvent(audio!, new Event("loadedmetadata"));
    });

    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      writable: true,
      value: 65,
    });

    act(() => {
      fireEvent(audio!, new Event("durationchange"));
      fireEvent(audio!, new Event("timeupdate"));
    });

    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();
  });

  test("uses symmetric 15 second seek controls", () => {
    render(
      <AudioPlayerProvider>
        <TriggerPlayback />
        <AudioPlayer />
      </AudioPlayerProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger playback" }));

    expect(screen.getByTitle("Back 15s")).toBeInTheDocument();
    expect(screen.getByTitle("Forward 15s")).toBeInTheDocument();
  });
});
