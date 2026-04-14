/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import SpeakerFilter from "@/components/SpeakerFilter";

describe("SpeakerFilter", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("shows loading label instead of disappearing while speakers are loading", () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(
      <SpeakerFilter
        feedIds={[]}
        includeManualUploads={false}
        selectedSpeaker={null}
        onSelectionChange={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /speaker:/i })).toHaveTextContent("Loading...");
  });

  it("renders confirmed speakers and applies selection", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        { speaker_label: "Alice", display_name: "Alice" },
        { speaker_label: "Bob", display_name: "Bob" },
      ],
    });
    const onSelectionChange = jest.fn();

    render(
      <SpeakerFilter
        feedIds={["feed-1"]}
        includeManualUploads={false}
        selectedSpeaker={null}
        onSelectionChange={onSelectionChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /speaker:/i })).toHaveTextContent("All");
    });

    fireEvent.click(screen.getByRole("button", { name: /speaker:/i }));
    fireEvent.click(screen.getByRole("button", { name: "Alice" }));
    expect(onSelectionChange).toHaveBeenCalledWith("Alice");
  });

  it("shows no-confirmed-speakers message for empty results", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(
      <SpeakerFilter
        feedIds={["feed-1"]}
        includeManualUploads={false}
        selectedSpeaker={null}
        onSelectionChange={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /speaker:/i })).toHaveTextContent("All");
    });

    fireEvent.click(screen.getByRole("button", { name: /speaker:/i }));
    expect(screen.getByText(/No confirmed speakers for selected sources/i)).toBeInTheDocument();
  });
});
