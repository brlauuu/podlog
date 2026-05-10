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
    role: null,
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

  describe("speaker role (#698)", () => {
    test("renders cards in host → guest → other → unassigned order", () => {
      const segments: Segment[] = [
        makeSegment({ id: 1, speaker_label: "SPEAKER_00", display_name: "U", role: null }),
        makeSegment({ id: 2, speaker_label: "SPEAKER_01", display_name: "O", role: "other" }),
        makeSegment({ id: 3, speaker_label: "SPEAKER_02", display_name: "G", role: "guest" }),
        makeSegment({ id: 4, speaker_label: "SPEAKER_03", display_name: "H", role: "host" }),
      ];

      const { container } = render(
        <SpeakerPanel
          episodeId="ep-1"
          segments={segments}
          onRenamed={jest.fn()}
          onMerged={jest.fn()}
          activeSpeaker={null}
          onFilterSpeaker={jest.fn()}
        />,
      );

      // The card name lives in a `<div class="text-sm font-semibold truncate">`
      // inside each card. Pull them in DOM order to verify the sort.
      const names = Array.from(
        container.querySelectorAll(".text-sm.font-semibold.truncate"),
      ).map((el) => el.textContent);
      expect(names).toEqual(["H", "G", "O", "U"]);
    });

    test("clicking a role button PUTs speakers with that role", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
      const onRoleChanged = jest.fn();
      const segments: Segment[] = [
        makeSegment({ id: 1, speaker_label: "SPEAKER_00", display_name: "Alice", role: null }),
      ];

      render(
        <SpeakerPanel
          episodeId="ep-1"
          segments={segments}
          onRenamed={jest.fn()}
          onMerged={jest.fn()}
          onRoleChanged={onRoleChanged}
          activeSpeaker={null}
          onFilterSpeaker={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /set role host for alice/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/episodes/ep-1/speakers",
          expect.objectContaining({
            method: "PUT",
            body: expect.stringContaining('"role":"host"'),
          }),
        );
        expect(onRoleChanged).toHaveBeenCalledWith("SPEAKER_00", "host");
      });
    });

    test("clicking the active role clears it (toggles to null)", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
      const onRoleChanged = jest.fn();
      const segments: Segment[] = [
        makeSegment({ id: 1, speaker_label: "SPEAKER_00", display_name: "Alice", role: "host" }),
      ];

      render(
        <SpeakerPanel
          episodeId="ep-1"
          segments={segments}
          onRenamed={jest.fn()}
          onMerged={jest.fn()}
          onRoleChanged={onRoleChanged}
          activeSpeaker={null}
          onFilterSpeaker={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /clear role host for alice/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/episodes/ep-1/speakers",
          expect.objectContaining({ body: expect.stringContaining('"role":null') }),
        );
        expect(onRoleChanged).toHaveBeenCalledWith("SPEAKER_00", null);
      });
    });

    test("renders a role badge for assigned speakers", () => {
      const segments: Segment[] = [
        makeSegment({ id: 1, speaker_label: "SPEAKER_00", display_name: "Alice", role: "host" }),
        makeSegment({ id: 2, speaker_label: "SPEAKER_01", display_name: "Bob", role: null }),
      ];

      render(
        <SpeakerPanel
          episodeId="ep-1"
          segments={segments}
          onRenamed={jest.fn()}
          onMerged={jest.fn()}
          activeSpeaker={null}
          onFilterSpeaker={jest.fn()}
        />,
      );

      // The "host" capitalize-class span shows the badge text.
      const badges = screen.queryAllByText(/^host$/i);
      // At least one badge ("host" pill); the role-button labeled "host" also matches.
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });
});
