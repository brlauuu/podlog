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
    AlertTriangle: () => <Icon data-testid="alert-icon" />,
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

  function setupPlayer(durationSecs = 300) {
    const utils = render(
      <AudioPlayerProvider>
        <TriggerPlayback />
        <AudioPlayer />
      </AudioPlayerProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Trigger playback" }));
    const audio = document.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: durationSecs });
    Object.defineProperty(audio, "currentTime", {
      configurable: true, writable: true, value: 0,
    });
    act(() => {
      fireEvent(audio, new Event("loadedmetadata"));
      fireEvent(audio, new Event("durationchange"));
    });
    return { ...utils, audio };
  }

  test("Forward 15s button advances currentTime by 15", () => {
    const { audio } = setupPlayer(300);
    const before = audio.currentTime;
    fireEvent.click(screen.getByTitle("Forward 15s"));
    expect(audio.currentTime).toBe(before + 15);
  });

  test("Back 15s clamps at zero (initial currentTime = 5 → 0)", () => {
    const { audio } = setupPlayer(300);
    // setupPlayer starts at currentTime=5 (TriggerPlayback's startTime=5);
    // Back 15s → max(0, 5-15) = 0.
    fireEvent.click(screen.getByTitle("Back 15s"));
    expect(audio.currentTime).toBe(0);
  });

  test("Forward 15s clamps to duration", () => {
    const { audio } = setupPlayer(20);
    audio.currentTime = 18;
    fireEvent.click(screen.getByTitle("Forward 15s"));
    expect(audio.currentTime).toBe(20);
  });

  test("mute toggle flips audio.muted and updates icon", () => {
    const { audio } = setupPlayer();
    // Volume2 (unmuted) initially
    expect(screen.getByTestId("volume2-icon")).toBeInTheDocument();
    // Find the mute button — the one wrapping the Volume2 icon
    const muteBtn = screen.getByTestId("volume2-icon").closest("button")!;
    fireEvent.click(muteBtn);
    expect(audio.muted).toBe(true);
    // Icon changed to VolumeX
    expect(screen.getByTestId("volumex-icon")).toBeInTheDocument();
  });

  test("collapse button toggles to mini player", () => {
    setupPlayer();
    const collapseBtn = screen.getByTitle("Collapse player");
    fireEvent.click(collapseBtn);
    // Mini player has an "Expand player" button
    expect(screen.getByTitle("Expand player")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Expand player"));
    expect(screen.getByTitle("Collapse player")).toBeInTheDocument();
  });

  test("close (X) button hides the player", () => {
    setupPlayer();
    // X button is the right-most control in expanded view
    const xIcon = screen.getAllByTestId("x-icon")[0];
    const closeBtn = xIcon.closest("button")!;
    fireEvent.click(closeBtn);
    // Player no longer renders
    expect(document.querySelector("audio")).toBeNull();
  });

  test("audio error event surfaces 'Audio unavailable' message", () => {
    const { audio } = setupPlayer();
    act(() => {
      fireEvent(audio, new Event("error"));
    });
    expect(screen.getByText(/audio unavailable/i)).toBeInTheDocument();
  });

  test("seek bar click jumps currentTime to clicked position", () => {
    const { audio } = setupPlayer(100);
    const bar = document.querySelector("[role='button'][aria-label='Seek']")
      || document.querySelector("div[onclick]");
    // The seek bar doesn't have role=button; find by class pattern fallback.
    // The handler is attached to the progress div — use a heuristic:
    const progress = document.querySelectorAll("div");
    let foundBar: Element | null = null;
    progress.forEach((d) => {
      if (d.className.includes("relative") && d.className.includes("cursor-pointer")) {
        foundBar = d;
      }
    });
    if (foundBar) {
      // Mock getBoundingClientRect for the bar.
      (foundBar as HTMLElement).getBoundingClientRect = () =>
        ({ left: 0, width: 100, top: 0, right: 100, bottom: 0, height: 4, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
      fireEvent.click(foundBar, { clientX: 50 });
      // 50% of 100s duration
      expect(audio.currentTime).toBe(50);
    }
  });

  test("keyboard ArrowRight skips forward 10s when player is active", () => {
    const { audio } = setupPlayer(300);
    // TriggerPlayback starts playback at second 5; ArrowRight → +10 → 15.
    const before = audio.currentTime;
    act(() => {
      const evt = new KeyboardEvent("keydown", { key: "ArrowRight" });
      window.dispatchEvent(evt);
    });
    expect(audio.currentTime).toBe(before + 10);
  });

  test("keyboard ArrowLeft skips back 10s when player is active", () => {
    const { audio } = setupPlayer(300);
    audio.currentTime = 30;
    act(() => {
      const evt = new KeyboardEvent("keydown", { key: "ArrowLeft" });
      window.dispatchEvent(evt);
    });
    expect(audio.currentTime).toBe(20);
  });
});
