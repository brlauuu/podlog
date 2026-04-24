/**
 * Tests for AudioUpload — file validation, metadata fields, and submit.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import AudioUpload from "@/components/AudioUpload";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function makeFile(name: string, type = "audio/mpeg", sizeBytes = 1024): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

describe("AudioUpload", () => {
  it("renders the dropzone with allowed extensions hint", () => {
    render(<AudioUpload />);
    expect(screen.getByText(/Drop an audio file here/i)).toBeInTheDocument();
    expect(screen.getByText(/MP3, M4A/)).toBeInTheDocument();
  });

  it("accepts a valid audio file and seeds the title from the filename", async () => {
    const user = userEvent.setup();
    const { container } = render(<AudioUpload />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, makeFile("my_great_episode.mp3"));

    const titleInput = screen.getByPlaceholderText("Episode title") as HTMLInputElement;
    // defaultTitle replaces `_` / `-` with spaces and drops the extension.
    expect(titleInput.value).toBe("my great episode");
    expect(screen.getByRole("button", { name: /upload and process/i })).toBeEnabled();
  });

  it("rejects a file with an unsupported extension", () => {
    const { container } = render(<AudioUpload />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    // fireEvent.change with Object.defineProperty bypasses the input's
    // accept= filter so the component's own validation runs.
    const badFile = makeFile("readme.txt", "text/plain");
    Object.defineProperty(input, "files", { value: [badFile] });
    fireEvent.change(input);

    expect(screen.getByText(/Unsupported file type/i)).toBeInTheDocument();
  });

  it("accepts a file by extension when MIME type is blank", async () => {
    const user = userEvent.setup();
    const { container } = render(<AudioUpload />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, makeFile("talk.flac", ""));

    // No error, title is seeded.
    expect(screen.queryByText(/Unsupported file type/i)).not.toBeInTheDocument();
  });

  it("clears the selection when the X button is clicked", async () => {
    const user = userEvent.setup();
    const { container } = render(<AudioUpload />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, makeFile("talk.mp3"));
    expect(screen.getByRole("button", { name: /upload and process/i })).toBeInTheDocument();

    // The X button has no accessible name, so find by icon container.
    const clearBtn = container.querySelector("button.ml-auto") as HTMLButtonElement;
    await user.click(clearBtn);

    expect(screen.queryByRole("button", { name: /upload and process/i })).not.toBeInTheDocument();
  });

  it("submits via POST /api/episodes/upload and calls onUploaded on success", async () => {
    const onUploaded = jest.fn();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ episode_id: "new-ep" }),
    });

    const user = userEvent.setup();
    const { container } = render(<AudioUpload onUploaded={onUploaded} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, makeFile("talk.mp3"));
    await user.click(screen.getByRole("button", { name: /upload and process/i }));

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith("new-ep");
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/episodes/upload",
      expect.objectContaining({ method: "POST" })
    );
    expect(screen.getByText(/Upload successful/i)).toBeInTheDocument();
  });

  it("shows the API error detail when the upload fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ detail: "File too large" }),
    });

    const user = userEvent.setup();
    const { container } = render(<AudioUpload />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, makeFile("talk.mp3"));
    await user.click(screen.getByRole("button", { name: /upload and process/i }));

    await waitFor(() => {
      expect(screen.getByText("File too large")).toBeInTheDocument();
    });
  });

  it("shows a generic connection error when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("ENETUNREACH"));

    const user = userEvent.setup();
    const { container } = render(<AudioUpload />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, makeFile("talk.mp3"));
    await user.click(screen.getByRole("button", { name: /upload and process/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your connection/i)).toBeInTheDocument();
    });
  });
});
