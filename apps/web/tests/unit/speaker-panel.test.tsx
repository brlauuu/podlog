/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import SpeakerPanel from "@/components/SpeakerPanel";
import type { Segment } from "@/lib/types";

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 1,
    start_time: 0,
    end_time: 5,
    speaker_label: "SPEAKER_00",
    display_name: "Alice",
    inferred: false,
    confirmed_by_user: true,
    text: "hello",
    ...overrides,
  };
}

describe("SpeakerPanel", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  test("renames speaker on successful save", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const onRenamed = jest.fn();

    const segments: Segment[] = [
      makeSegment({ id: 1, speaker_label: "SPEAKER_00", display_name: "Alice" }),
      makeSegment({ id: 2, speaker_label: "SPEAKER_01", display_name: "Bob", start_time: 6, end_time: 10 }),
    ];

    render(
      <SpeakerPanel
        episodeId="ep-1"
        segments={segments}
        onRenamed={onRenamed}
        onMerged={jest.fn()}
        activeSpeaker={null}
        onFilterSpeaker={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit alice/i }));

    const input = await screen.findByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "Alice Cooper" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/episodes/ep-1/speakers",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
        })
      );
      expect(onRenamed).toHaveBeenCalledWith("SPEAKER_00", "Alice Cooper");
    });
  });

  test("confirms inferred speaker without requiring a name change", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const onRenamed = jest.fn();

    const segments: Segment[] = [
      makeSegment({
        id: 1,
        speaker_label: "SPEAKER_00",
        display_name: "Alice",
        inferred: true,
        confirmed_by_user: false,
      }),
    ];

    render(
      <SpeakerPanel
        episodeId="ep-1"
        segments={segments}
        onRenamed={onRenamed}
        onMerged={jest.fn()}
        activeSpeaker={null}
        onFilterSpeaker={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm alice/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/episodes/ep-1/speakers",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            speaker_label: "SPEAKER_00",
            display_name: "Alice",
          }),
        })
      );
      expect(onRenamed).toHaveBeenCalledWith("SPEAKER_00", "Alice");
    });
  });

  test("merges selected speakers via merge endpoint", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
    const onMerged = jest.fn();

    const segments: Segment[] = [
      makeSegment({ id: 1, speaker_label: "SPEAKER_00", display_name: "Alice" }),
      makeSegment({ id: 2, speaker_label: "SPEAKER_00", display_name: "Alice", start_time: 6, end_time: 10 }),
      makeSegment({ id: 3, speaker_label: "SPEAKER_01", display_name: "Bob", start_time: 11, end_time: 15 }),
    ];

    render(
      <SpeakerPanel
        episodeId="ep-1"
        segments={segments}
        onRenamed={jest.fn()}
        onMerged={onMerged}
        activeSpeaker={null}
        onFilterSpeaker={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /merge speakers/i }));
    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Bob"));
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/episodes/ep-1/speakers/merge",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_labels: ["SPEAKER_01"],
            target_label: "SPEAKER_00",
          }),
        })
      );
      expect(onMerged).toHaveBeenCalledWith(["SPEAKER_01"], "SPEAKER_00");
    });
  });
});
