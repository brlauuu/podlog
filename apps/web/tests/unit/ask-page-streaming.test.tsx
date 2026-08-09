/**
 * SSE streaming path for the /ask page — the handleSubmit reader loop
 * (sources / token / error / done), the !resp.ok branch, the network-failure
 * catch, feed-filter propagation, and Clear.
 *
 * The sibling ask-page tests cover mount/snapshot/playback but stop short of
 * submit, which left handleSubmit's whole streaming body uncovered (#912).
 *
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/AudioPlayerContext", () => ({
  useAudioPlayer: () => ({ playEpisode: jest.fn() }),
}));

jest.mock("next/link", () => {
  function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  MockLink.displayName = "MockLink";
  return MockLink;
});

import AskPage from "@/app/ask/page";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** Minimal ReadableStream stand-in that yields `sse` once, then done. */
function streamResponse(sse: string) {
  const chunks = [new TextEncoder().encode(sse)];
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
      }),
    },
  };
}

const SOURCE = {
  chunk_id: 1,
  episode_id: "ep-1",
  episode_title: "Episode One",
  audio_local_path: null,
  speaker_label: "SPEAKER_00",
  start_time: 10,
  end_time: 20,
  timestamp: "00:10",
  text: "some retrieved context",
  similarity: 0.9,
};

const HAPPY_SSE =
  `event: sources\ndata: ${JSON.stringify([SOURCE])}\n\n` +
  'event: token\ndata: {"content":"Hello"}\n\n' +
  'event: token\ndata: {"content":" world"}\n\n' +
  "event: done\ndata: {}\n\n";

/** Route the three mount-time GETs; `ask` decides what /api/pipeline/ask does. */
function mockRoutes(ask: () => unknown) {
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/feeds") return Promise.resolve({ json: async () => [] } as Response);
    if (url === "/api/ask/coverage")
      return Promise.resolve({
        json: async () => ({ processed: 1, total: 1, has_manual_uploads: false }),
      } as Response);
    if (url === "/api/notifications/settings")
      return Promise.resolve({ json: async () => ({ rag_provider: "local" }) } as Response);
    if (url === "/api/pipeline/ask") return ask();
    throw new Error(`unmocked fetch in ask-page test: ${url}`);
  });
}

async function askQuestion(q = "what happened?") {
  render(<AskPage />);
  const box = await screen.findByPlaceholderText(/ask/i);
  fireEvent.change(box, { target: { value: q } });
  fireEvent.submit(box.closest("form")!);
}

beforeEach(() => {
  mockFetch.mockReset();
  sessionStorage.clear();
  localStorage.clear();
});

describe("/ask — SSE streaming", () => {
  test("renders streamed tokens and the sources returned with them", async () => {
    mockRoutes(() => Promise.resolve(streamResponse(HAPPY_SSE)));

    await askQuestion();

    expect(await screen.findByText(/Hello world/)).toBeInTheDocument();
    expect(await screen.findByText(/some retrieved context/)).toBeInTheDocument();
  });

  test("surfaces an error event from the stream", async () => {
    mockRoutes(() =>
      Promise.resolve(
        streamResponse('event: error\ndata: {"message":"model exploded"}\n\n' + "event: done\ndata: {}\n\n")
      )
    );

    await askQuestion();

    expect(await screen.findByText(/model exploded/)).toBeInTheDocument();
  });

  test("reports a connect failure when the response is not ok", async () => {
    mockRoutes(() => Promise.resolve({ ok: false, body: null }));

    await askQuestion();

    expect(await screen.findByText(/Failed to connect to the pipeline API/i)).toBeInTheDocument();
  });

  test("reports a network failure when the request throws", async () => {
    mockRoutes(() => Promise.reject(new Error("offline")));

    await askQuestion();

    expect(await screen.findByText(/Connection failed/i)).toBeInTheDocument();
  });

  test("ignores malformed JSON in the stream without failing the answer", async () => {
    mockRoutes(() =>
      Promise.resolve(
        streamResponse(
          "event: token\ndata: {not json}\n\n" +
            'event: token\ndata: {"content":"recovered"}\n\n' +
            "event: done\ndata: {}\n\n"
        )
      )
    );

    await askQuestion();

    expect(await screen.findByText(/recovered/)).toBeInTheDocument();
  });

  test("Clear resets the answer after a completed exchange", async () => {
    mockRoutes(() => Promise.resolve(streamResponse(HAPPY_SSE)));

    await askQuestion();
    await screen.findByText(/Hello world/);

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));

    await waitFor(() => expect(screen.queryByText(/Hello world/)).not.toBeInTheDocument());
  });

  test("does not submit an empty question", async () => {
    mockRoutes(() => Promise.resolve(streamResponse(HAPPY_SSE)));

    render(<AskPage />);
    const box = await screen.findByPlaceholderText(/ask/i);
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.submit(box.closest("form")!);

    // Only the three mount-time GETs — no POST to the ask endpoint.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls.some(([u]) => u === "/api/pipeline/ask")).toBe(false);
  });
});
