/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/AudioPlayerContext", () => ({
  useAudioPlayer: () => ({
    playEpisode: jest.fn(),
  }),
}));

import AskPage from "@/app/ask/page";

describe("Ask page helpbox behavior", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    global.fetch = jest.fn((url: string) => {
      if (url === "/api/feeds") {
        return Promise.resolve({
          json: async () => [],
        } as Response);
      }
      if (url === "/api/ask/coverage") {
        return Promise.resolve({
          json: async () => ({ processed: 195, total: 392, has_manual_uploads: false }),
        } as Response);
      }
      return Promise.resolve({ json: async () => ({}) } as Response);
    }) as jest.Mock;
  });

  test("moves explanatory copy into a helpbox that opens on hover and click", async () => {
    render(<AskPage />);

    expect(
      screen.queryByText(/Retrieval-augmented analysis across your transcripts/i)
    ).toBeNull();

    const helpTrigger = screen.getByRole("button", { name: "Ask help" });
    fireEvent.mouseEnter(helpTrigger);
    expect(
      await screen.findByText(/Retrieval-augmented analysis across your transcripts/i)
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Analyzing 195 processed episodes \(197 still processing\)/i)
    ).toBeInTheDocument();

    fireEvent.click(helpTrigger);
    fireEvent.mouseLeave(helpTrigger);
    expect(
      screen.getByText(/Retrieval-augmented analysis across your transcripts/i)
    ).toBeInTheDocument();
  });

  test("closes helpbox on outside click", async () => {
    render(<AskPage />);

    const helpTrigger = screen.getByRole("button", { name: "Ask help" });
    fireEvent.click(helpTrigger);
    expect(
      await screen.findByText(/Retrieval-augmented analysis across your transcripts/i)
    ).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByText(/Retrieval-augmented analysis across your transcripts/i)
    ).toBeNull();
  });

  test("uses foreground-colored spinner bars while processing", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === "/api/feeds") {
        return Promise.resolve({ json: async () => [] } as Response);
      }
      if (url === "/api/ask/coverage") {
        return Promise.resolve({
          json: async () => ({ processed: 195, total: 392, has_manual_uploads: false }),
        } as Response);
      }
      if (url === "/api/pipeline/ask") {
        return new Promise(() => undefined);
      }
      return Promise.resolve({ json: async () => ({}) } as Response);
    });

    const { container } = render(<AskPage />);
    const input = screen.getByPlaceholderText("Ask about your transcripts...");
    fireEvent.change(input, {
      target: { value: "What did they say?" },
    });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(await screen.findByText("Searching transcripts...")).toBeInTheDocument();
    expect(container.querySelector(".bg-foreground.animate-\\[eqBar_1\\.4s_ease-in-out_infinite\\]")).toBeInTheDocument();
  });
});
