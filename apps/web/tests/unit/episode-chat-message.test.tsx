/**
 * @jest-environment jsdom
 *
 * Tests for the EpisodeChat message-bubble component (split out of
 * EpisodeChat in #665, coverage gap closed in #765).
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import MessageBubble, { type Message } from "@/components/EpisodeChatMessage";
import type { Source } from "@/lib/citations";

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    chunk_id: 1,
    episode_id: "ep-1",
    start_time: 12.5,
    end_time: 20.0,
    timestamp: "[00:00:12]",
    speaker_label: "SPEAKER_00",
    text: "Hello world this is a test source citation that runs a bit long.",
    ...overrides,
  } as Source;
}

describe("<MessageBubble>", () => {
  it("renders a user message in the right-aligned bubble", () => {
    const msg: Message = { role: "user", content: "What did Jane say?" };
    render(<MessageBubble message={msg} isStreaming={false} />);
    const text = screen.getByText("What did Jane say?");
    expect(text).toBeInTheDocument();
    // Right-aligned wrapper class
    expect(text.closest('.justify-end')).not.toBeNull();
  });

  it("renders an assistant message with the markdown answer", () => {
    const msg: Message = { role: "assistant", content: "Sure — here's the answer." };
    render(<MessageBubble message={msg} isStreaming={false} />);
    expect(screen.getByText(/here's the answer/)).toBeInTheDocument();
  });

  it("shows the 'Thinking...' placeholder when streaming with no content yet", () => {
    const msg: Message = { role: "assistant", content: "" };
    render(<MessageBubble message={msg} isStreaming={true} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("renders nothing for an empty assistant message that isn't streaming", () => {
    const msg: Message = { role: "assistant", content: "" };
    render(<MessageBubble message={msg} isStreaming={false} />);
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  it("renders a 1-source label when exactly one source is attached", () => {
    const msg: Message = {
      role: "assistant",
      content: "Answer with one source.",
      sources: [makeSource()],
    };
    render(<MessageBubble message={msg} isStreaming={false} />);
    expect(screen.getByText("1 source")).toBeInTheDocument();
  });

  it("renders a plural N-sources label and at most 3 source rows", () => {
    const msg: Message = {
      role: "assistant",
      content: "Answer with many sources.",
      sources: [
        makeSource({ chunk_id: 1, timestamp: "[00:00:01]" }),
        makeSource({ chunk_id: 2, timestamp: "[00:00:02]" }),
        makeSource({ chunk_id: 3, timestamp: "[00:00:03]" }),
        makeSource({ chunk_id: 4, timestamp: "[00:00:04]" }),
        makeSource({ chunk_id: 5, timestamp: "[00:00:05]" }),
      ],
    };
    render(<MessageBubble message={msg} isStreaming={false} />);
    expect(screen.getByText("5 sources")).toBeInTheDocument();
    // The trimmed list shows the first 3 only.
    expect(screen.getByText(/\[00:00:01\]/)).toBeInTheDocument();
    expect(screen.getByText(/\[00:00:02\]/)).toBeInTheDocument();
    expect(screen.getByText(/\[00:00:03\]/)).toBeInTheDocument();
    expect(screen.queryByText(/\[00:00:04\]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[00:00:05\]/)).not.toBeInTheDocument();
  });

  it("dispatches a scroll-to-time event with floored seconds when a source row is clicked", () => {
    const handler = jest.fn();
    window.addEventListener("podlog:scroll-to-time", handler as EventListener);
    const msg: Message = {
      role: "assistant",
      content: "Answer.",
      sources: [makeSource({ start_time: 42.9 })],
    };
    render(<MessageBubble message={msg} isStreaming={false} />);
    fireEvent.click(screen.getByRole("button"));
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ secs: 42 });
    window.removeEventListener("podlog:scroll-to-time", handler as EventListener);
  });

  it("omits the speaker_label parenthetical when no label is set", () => {
    const msg: Message = {
      role: "assistant",
      content: "Answer.",
      sources: [makeSource({ speaker_label: undefined })],
    };
    render(<MessageBubble message={msg} isStreaming={false} />);
    // The button text should not include the closing paren that wraps speaker
    const btn = screen.getByRole("button");
    expect(btn.textContent).not.toMatch(/\(SPEAKER/);
  });
});
