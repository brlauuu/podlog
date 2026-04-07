/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { AudioPlayerProvider, useAudioPlayer } from "@/components/AudioPlayerContext";

function Harness() {
  const { state, audioRef, playEpisode, togglePlayPause, closePlayer } = useAudioPlayer();

  return (
    <div>
      <div data-testid="is-playing">{String(state.isPlaying)}</div>
      <div data-testid="state-src">{state.src ?? ""}</div>
      <button type="button" onClick={() => playEpisode("ep-1", "file name.mp3", 12, "Episode", "Feed")}>
        play-episode
      </button>
      <button type="button" onClick={togglePlayPause}>
        toggle
      </button>
      <button type="button" onClick={closePlayer}>
        close
      </button>
      <button
        type="button"
        onClick={() => {
          audioRef.current = {
            paused: true,
            play: jest.fn().mockResolvedValue(undefined),
            pause: jest.fn(),
            src: "audio-src",
          } as unknown as HTMLAudioElement;
        }}
      >
        attach-paused-audio
      </button>
      <button
        type="button"
        onClick={() => {
          audioRef.current = {
            paused: false,
            play: jest.fn().mockResolvedValue(undefined),
            pause: jest.fn(),
            src: "audio-src",
          } as unknown as HTMLAudioElement;
        }}
      >
        attach-playing-audio
      </button>
      <button
        type="button"
        onClick={() => {
          audioRef.current = null;
        }}
      >
        clear-audio
      </button>
    </div>
  );
}

describe("AudioPlayerContext", () => {
  it("builds encoded src and marks playing on playEpisode", () => {
    render(
      <AudioPlayerProvider>
        <Harness />
      </AudioPlayerProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "play-episode" }));

    expect(screen.getByTestId("state-src")).toHaveTextContent(
      "/api/audio/ep-1/file%20name.mp3"
    );
    expect(screen.getByTestId("is-playing")).toHaveTextContent("true");
  });

  it("no-ops togglePlayPause when no audio element is attached", () => {
    render(
      <AudioPlayerProvider>
        <Harness />
      </AudioPlayerProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("is-playing")).toHaveTextContent("false");
  });

  it("calls play and sets isPlaying=true when paused audio is toggled", () => {
    render(
      <AudioPlayerProvider>
        <Harness />
      </AudioPlayerProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "attach-paused-audio" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByTestId("is-playing")).toHaveTextContent("true");
  });

  it("calls pause and sets isPlaying=false when playing audio is toggled", () => {
    render(
      <AudioPlayerProvider>
        <Harness />
      </AudioPlayerProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "play-episode" }));
    fireEvent.click(screen.getByRole("button", { name: "attach-playing-audio" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByTestId("is-playing")).toHaveTextContent("false");
  });

  it("resets player state on closePlayer, including attached audio branch", () => {
    render(
      <AudioPlayerProvider>
        <Harness />
      </AudioPlayerProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "play-episode" }));
    fireEvent.click(screen.getByRole("button", { name: "attach-playing-audio" }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(screen.getByTestId("state-src")).toHaveTextContent("");
    expect(screen.getByTestId("is-playing")).toHaveTextContent("false");
  });
});
