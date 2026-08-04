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

  it("treats a non-array response as an empty speaker list", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
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
    expect(
      screen.getByText(/No confirmed speakers for selected sources/i)
    ).toBeInTheDocument();
  });

  it("shows the selected speaker's display name in the trigger", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ speaker_label: "Alice", display_name: "Alice Smith" }],
    });

    render(
      <SpeakerFilter
        feedIds={["feed-1"]}
        includeManualUploads={false}
        selectedSpeaker="Alice"
        onSelectionChange={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /speaker:/i })).toHaveTextContent("Alice Smith");
    });
  });

  it("clears the selection when 'All speakers' is clicked", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ speaker_label: "Alice", display_name: "Alice" }],
    });
    const onSelectionChange = jest.fn();

    render(
      <SpeakerFilter
        feedIds={["feed-1"]}
        includeManualUploads={false}
        selectedSpeaker="Alice"
        onSelectionChange={onSelectionChange}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /speaker:/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole("button", { name: /speaker:/i }));
    fireEvent.click(screen.getByRole("button", { name: "All speakers" }));
    expect(onSelectionChange).toHaveBeenCalledWith(null);
  });

  it("closes the dropdown on an outside click", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ speaker_label: "Alice", display_name: "Alice" }],
    });

    render(
      <div>
        <span data-testid="outside">outside</span>
        <SpeakerFilter
          feedIds={["feed-1"]}
          includeManualUploads={false}
          selectedSpeaker={null}
          onSelectionChange={jest.fn()}
        />
      </div>
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /speaker:/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole("button", { name: /speaker:/i }));
    expect(screen.getByText("All speakers")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByText("All speakers")).not.toBeInTheDocument();
  });

  it("shows an error with a working Retry when the fetch fails", async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({
        ok: true,
        json: async () => [{ speaker_label: "Alice", display_name: "Alice" }],
      });

    render(
      <SpeakerFilter
        feedIds={["feed-1"]}
        includeManualUploads={false}
        selectedSpeaker={null}
        onSelectionChange={jest.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /speaker:/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole("button", { name: /speaker:/i }));
    expect(screen.getByText(/Could not load speakers/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
