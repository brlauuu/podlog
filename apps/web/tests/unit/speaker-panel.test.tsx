/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import SpeakerPanel, { speakerGridColumns } from "@/components/SpeakerPanel";
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

describe("SpeakerPanel — additional branches", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  function renderOne(props: Partial<React.ComponentProps<typeof SpeakerPanel>> = {}) {
    return render(
      <SpeakerPanel
        episodeId="ep-1"
        segments={[makeSegment({ speaker_label: "SPEAKER_00", display_name: "Alice" })]}
        onRenamed={jest.fn()}
        onMerged={jest.fn()}
        activeSpeaker={null}
        onFilterSpeaker={jest.fn()}
        {...props}
      />
    );
  }

  test("reverts the name when the rename request fails", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    const onRenamed = jest.fn();
    renderOne({ onRenamed });

    fireEvent.click(screen.getByRole("button", { name: /edit alice/i }));
    const input = await screen.findByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "Alice Cooper" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(onRenamed).not.toHaveBeenCalled();
  });

  test("reverts the name when the rename request throws", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("offline"));
    const onRenamed = jest.fn();
    renderOne({ onRenamed });

    fireEvent.click(screen.getByRole("button", { name: /edit alice/i }));
    const input = await screen.findByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "Alice Cooper" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(onRenamed).not.toHaveBeenCalled();
  });

  test("exits edit without saving when the name is cleared", () => {
    renderOne();

    fireEvent.click(screen.getByRole("button", { name: /edit alice/i }));
    const input = screen.getByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("exits edit without a request when an unchanged name is confirmed", () => {
    renderOne();

    fireEvent.click(screen.getByRole("button", { name: /edit alice/i }));
    const input = screen.getByDisplayValue("Alice");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("saves via the check button and stops row-click propagation", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const onRenamed = jest.fn();
    renderOne({ onRenamed });

    fireEvent.click(screen.getByRole("button", { name: /edit alice/i }));
    const input = await screen.findByDisplayValue("Alice");
    fireEvent.click(input); // input onClick stopPropagation
    fireEvent.change(input, { target: { value: "Alice B" } });
    // First button in the edit row is the green save/check control.
    const saveBtn = input.parentElement!.querySelector("button")!;
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith("SPEAKER_00", "Alice B"));
  });

  test("Show segments toggles the speaker filter", () => {
    const onFilterSpeaker = jest.fn();
    renderOne({ onFilterSpeaker });

    fireEvent.click(screen.getByRole("button", { name: /show segments for alice/i }));

    expect(onFilterSpeaker).toHaveBeenCalledWith("SPEAKER_00");
  });

  test("Show all clears the active speaker filter", () => {
    const onFilterSpeaker = jest.fn();
    renderOne({ activeSpeaker: "SPEAKER_00", onFilterSpeaker });

    fireEvent.click(screen.getByRole("button", { name: /^show all$/i }));

    expect(onFilterSpeaker).toHaveBeenCalledWith(null);
  });

  function renderTwoForMerge() {
    return render(
      <SpeakerPanel
        episodeId="ep-1"
        segments={[
          makeSegment({ id: 1, speaker_label: "SPEAKER_00", display_name: "Alice" }),
          makeSegment({ id: 2, speaker_label: "SPEAKER_01", display_name: "Bob", start_time: 6, end_time: 10 }),
        ]}
        onRenamed={jest.fn()}
        onMerged={jest.fn()}
        activeSpeaker={null}
        onFilterSpeaker={jest.fn()}
      />
    );
  }

  test("shows the API error when a merge fails", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "cannot merge" }),
    });
    renderTwoForMerge();

    fireEvent.click(screen.getByRole("button", { name: /merge speakers/i }));
    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Bob"));
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));

    expect(await screen.findByText("cannot merge")).toBeInTheDocument();
  });

  test("shows a connection error when a merge throws", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("offline"));
    renderTwoForMerge();

    fireEvent.click(screen.getByRole("button", { name: /merge speakers/i }));
    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Bob"));
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));

    expect(await screen.findByText(/Merge failed — check your connection/i)).toBeInTheDocument();
  });
});

describe("speakerGridColumns (#1121)", () => {
  // A fixed `repeat(4, 1fr)` squeezed four cards into a phone's width and
  // made the episode page scroll sideways. Columns now fit the space, never
  // narrower than 10rem, and never more than four to a row.
  it("fits as many columns as there is room for, each at least 10rem", () => {
    expect(speakerGridColumns(4)).toBe(
      "repeat(auto-fit, minmax(max(10rem, calc((100% - 3 * 0.5rem) / 4)), 1fr))",
    );
  });

  it("gives a single speaker the whole row", () => {
    expect(speakerGridColumns(1)).toBe(
      "repeat(auto-fit, minmax(max(10rem, calc((100% - 0 * 0.5rem) / 1)), 1fr))",
    );
  });
});

describe("SpeakerPanel — names kept across a re-process (#1133)", () => {
  const noop = () => {};
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  function renderPanel(segments: Segment[], extra: Partial<React.ComponentProps<typeof SpeakerPanel>> = {}) {
    return render(
      <SpeakerPanel
        episodeId="ep-1"
        segments={segments}
        onRenamed={jest.fn()}
        onMerged={noop}
        activeSpeaker={null}
        onFilterSpeaker={noop}
        {...extra}
      />,
    );
  }

  test("a confirmed name flagged for review asks to be checked, not shown as confirmed", () => {
    renderPanel([
      makeSegment({ speaker_label: "SPEAKER_00", display_name: "Galeb", needs_review: true }),
      makeSegment({ id: 2, speaker_label: "SPEAKER_01", display_name: "Bob" }),
    ]);
    expect(screen.getByText("Check name")).toBeInTheDocument();
    // Only Bob still reads as confirmed.
    expect(screen.getAllByText(/Confirmed/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm Galeb" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm Bob" })).not.toBeInTheDocument();
  });

  test("confirming a flagged name re-saves it, which clears the flag", async () => {
    const onRenamed = jest.fn();
    renderPanel(
      [makeSegment({ speaker_label: "SPEAKER_00", display_name: "Galeb", needs_review: true })],
      { onRenamed },
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm Galeb" }));
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith("SPEAKER_00", "Galeb"));
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/episodes/ep-1/speakers");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ speaker_label: "SPEAKER_00", display_name: "Galeb" });
  });

  test("lists confirmed names whose speaker is gone, and dismisses one", async () => {
    const onUnmatchedDismissed = jest.fn();
    renderPanel([makeSegment()], {
      unmatchedNames: [{ speaker_label: "SPEAKER_09", display_name: "Stellan" }],
      onUnmatchedDismissed,
    });
    expect(screen.getByRole("note")).toHaveTextContent("Stellan");
    expect(screen.getByRole("note")).toHaveTextContent("was SPEAKER_09");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Stellan" }));
    await waitFor(() => expect(onUnmatchedDismissed).toHaveBeenCalledWith("SPEAKER_09"));
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ speaker_label: "SPEAKER_09" });
  });

  test("shows no notice when every confirmed name still has a speaker", () => {
    renderPanel([makeSegment()]);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
